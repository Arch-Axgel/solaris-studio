"""Install the PyTorch build that can actually use this machine's GPU.

    python scripts/setup_gpu.py              pick, install and prove the right build
    python scripts/setup_gpu.py --dry-run    print the plan and the exact commands; change nothing
    python scripts/setup_gpu.py --cpu        the CPU-only build (a VPS with no GPU, or to undo)
    python scripts/setup_gpu.py --index cu126   force one wheel index
    python scripts/setup_gpu.py --json       one JSON object per line, for the desktop app

Why this exists rather than a line in requirements.txt: which CUDA PyTorch is
built for is chosen by the INDEX it is installed from, and requirements.txt
cannot say that. Plain `pip install torch` is CPU-only on Windows, and no
single GPU build covers every card — measured from the published 2.14.1 wheels
(`torch.cuda.get_arch_list()` as compiled into torch_python.dll):

    cu126          sm_50 sm_60 sm_61 sm_70 sm_75 sm_80 sm_86 sm_90
    cu130, cu132   sm_75 sm_80 sm_86 sm_90 sm_100 sm_120

So a GTX 10-series / Quadro P (Pascal, sm_61) needs cu126, an RTX 50-series
(Blackwell, sm_120) needs cu130+, and everything from Turing to Hopper runs on
either. core.gpu.recommend_torch_index() holds that table; this script turns
its shortlist into wheels for THIS Python and platform, installs the first,
and then proves it in a fresh process by running a kernel on the card
(core.gpu.cuda_usable() plus a torchvision op). A build that installs but
cannot run is not kept: the next candidate is tried, and if none works the CPU
build goes back in with the reason said out loud.

It never imports torch itself. On Windows a loaded DLL cannot be deleted, and
the engine (which has torch loaded) runs this as a separate process for the
same reason; afterwards Solaris Studio has to be restarted to load the new
build.

Standard library only, plus the pip of the Python running it (so run it with
the project's venv Python). Exit codes: 0 done (or nothing to do), 1 no GPU
build worked (CPU build restored), 2 cannot run here (bad arguments, wrong
Python, offline, no disk space), 3 the packaged app, 4 files locked by a
running program.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import platform as _platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_ROOT = "https://download.pytorch.org/whl"
SCRIPT = Path(__file__).resolve()

# torchaudio is deliberately not installed: nothing in the app imports it
# (analysis/voice_turns.py reimplements the one fbank it needed, and
# tests/test_packaging.py keeps it that way), so it would be a few hundred MB
# for nothing.
PACKAGES = ("torch", "torchvision")

EXIT_OK, EXIT_FAILED, EXIT_CANNOT, EXIT_FROZEN, EXIT_LOCKED = 0, 1, 2, 3, 4

# What pip prints when Windows refuses to replace a file another process has
# open. Moving a loaded DLL aside works on Windows (pip does that, then fails
# only to delete it and says so as a warning), so this is the case where even
# that failed: an older pip, or a program holding the folder itself open.
_LOCKED = re.compile(r"WinError 5\b|WinError 32\b|Access is denied|being used by another process"
                     r"|PermissionError: \[Errno 13\]", re.I)

_INDEX_NAME = re.compile(r"^(cpu|cu\d{3})$")


# ---------------------------------------------------------------------------
# Output: plain lines for a person, JSON lines for the desktop app.
# ---------------------------------------------------------------------------
class Reporter:
    def __init__(self, as_json: bool, stream=None):
        self.as_json = as_json
        self.stream = stream or sys.stdout
        self.pct = 0

    def __call__(self, stage: str, msg: str, pct: float | None = None, **extra) -> None:
        if pct is not None:
            # Progress never runs backwards on screen, even when a later stage
            # (restoring the CPU build) restarts its own count.
            self.pct = max(self.pct, int(pct))
        if self.stream is None:
            return
        try:
            if self.as_json:
                line = {"stage": stage, "pct": self.pct, "msg": msg, **extra}
                self.stream.write(json.dumps(line, default=str) + "\n")
            else:
                self.stream.write(msg + "\n")
            self.stream.flush()
        except (OSError, ValueError):
            # Whoever was reading went away (the engine quit or was killed
            # mid-install, closing our stdout pipe). Stop talking but keep
            # going: dying here, between pip and the verify/restore steps, is
            # the one way this script could leave the venv without a working
            # PyTorch.
            self.stream = None


# ---------------------------------------------------------------------------
# The GPU, from the driver alone (no torch).
# ---------------------------------------------------------------------------
def _smi_exe() -> str | None:
    found = shutil.which("nvidia-smi")
    if found:
        return found
    # Not always on PATH: the Windows driver keeps it in System32 (NVSMI on old
    # drivers), WSL with the passed-through driver libraries.
    if os.name == "nt":
        candidates = [
            os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe"),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                         "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
        ]
    else:
        candidates = ["/usr/bin/nvidia-smi", "/usr/lib/wsl/lib/nvidia-smi"]
    return next((c for c in candidates if os.path.isfile(c)), None)


def run_smi(args: list[str]) -> str | None:
    """nvidia-smi's stdout, or None when there is no nvidia-smi or it fails.
    The one place the script touches the driver, so tests replace it."""
    exe = _smi_exe()
    if not exe:
        return None
    try:
        result = subprocess.run([exe, *args], capture_output=True, text=True, timeout=20,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def _version_pair(text) -> tuple[int, int] | None:
    m = re.match(r"\s*(\d+)\.(\d+)", str(text or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def detect_gpus() -> dict:
    """`{"gpus": [{name, compute_capability, driver}], "driver": str|None,
    "driver_cuda": (12, 8)|None}` from nvidia-smi. Empty on a machine with no
    NVIDIA driver, which is every GPU-less VPS."""
    out = run_smi(["--query-gpu=name,compute_cap,driver_version", "--format=csv,noheader"])
    gpus, driver = [], None
    if out is None:
        # compute_cap arrived in driver 510's nvidia-smi; an older one fails
        # the whole query over the unknown field instead of leaving it blank.
        out = run_smi(["--query-gpu=name,driver_version", "--format=csv,noheader"])
        rows = [(r[0], None, r[1] if len(r) > 1 else None)
                for r in (_csv(line) for line in (out or "").splitlines()) if r and r[0]]
    else:
        rows = [(r[0], r[1] if len(r) > 1 else None, r[2] if len(r) > 2 else None)
                for r in (_csv(line) for line in out.splitlines()) if r and r[0]]
    for name, cap, drv in rows:
        gpus.append({"name": name, "compute_capability": _version_pair(cap), "driver": drv})
        driver = driver or drv
    if gpus and any(g["compute_capability"] is None for g in gpus):
        _fill_caps_from_nvml(gpus)
    driver_cuda = None
    if gpus:
        m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", run_smi([]) or "")
        driver_cuda = (int(m.group(1)), int(m.group(2))) if m else None
    return {"gpus": gpus, "driver": driver, "driver_cuda": driver_cuda}


def _csv(line: str) -> list[str]:
    return [p.strip() for p in line.split(",")] if line.strip() else []


def _fill_caps_from_nvml(gpus: list[dict]) -> None:
    """Compute capability from NVML when nvidia-smi is too old to print it.
    Optional: pynvml is in requirements.txt, but a bare Python may not have it."""
    try:
        import pynvml

        pynvml.nvmlInit()
        try:
            for i, gpu in enumerate(gpus):
                if gpu["compute_capability"] is None:
                    handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                    gpu["compute_capability"] = tuple(pynvml.nvmlDeviceGetCudaComputeCapability(handle))
        finally:
            pynvml.nvmlShutdown()
    except Exception:
        pass


def _sm(cap) -> str:
    return f"sm_{cap[0]}{cap[1]}" if cap else "an unknown compute capability"


# ---------------------------------------------------------------------------
# Which indexes to try: core.gpu's table, for every card in the machine.
# ---------------------------------------------------------------------------
def _recommender():
    """core.gpu.recommend_torch_index, imported only when needed: core.gpu is
    pure at import (no torch), but a broken checkout should fail here with a
    sentence rather than at the top of the file with a traceback."""
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    try:
        from core.gpu import recommend_torch_index
    except ImportError as e:
        raise SetupError(
            f"core/gpu.py has no recommend_torch_index ({e}). This script needs the Solaris Studio "
            f"checkout it ships with; update the whole folder, not just scripts/.", EXIT_CANNOT) from e
    return recommend_torch_index


def candidate_indexes(found: dict, plat: str | None = None) -> tuple[list[str], str]:
    """Indexes to try in order, and why. `["cpu"]` when no GPU build fits.

    Every card has to be covered, since one PyTorch serves all of them: the
    shortlist is what fits every GPU, in the order the first card prefers.
    A pair nothing covers (a GTX 1080 beside an RTX 5090) falls back to the
    first card, which is the one CUDA numbers 0, and says so.
    """
    recommend = _recommender()
    gpus = found["gpus"]
    if not gpus:
        return ["cpu"], "No NVIDIA GPU found (no driver, or a machine without one)."
    lists = [recommend(g["compute_capability"], found["driver_cuda"], plat) for g in gpus]
    shared = [i for i in lists[0] if all(i in other for other in lists[1:])]
    first = gpus[0]
    if len(gpus) > 1 and not shared:
        return lists[0], (f"No single PyTorch build covers all {len(gpus)} GPUs here; "
                          f"choosing for {first['name']} ({_sm(first['compute_capability'])}).")
    shared = shared or lists[0]
    names = ", ".join(f"{g['name']} ({_sm(g['compute_capability'])})" for g in gpus)
    drv = found["driver_cuda"]
    drv_text = f"driver {found['driver']} supports CUDA {drv[0]}.{drv[1]}" if drv else \
        f"driver {found['driver'] or 'unknown'}"
    if shared == ["cpu"]:
        return shared, f"{names}, {drv_text}: {_no_gpu_build_reason(first, drv, recommend, plat)}"
    return shared, f"{names}, {drv_text}."


def _no_gpu_build_reason(gpu: dict, driver_cuda, recommend, plat) -> str:
    cap = gpu["compute_capability"]
    if cap is None:
        return "its compute capability could not be read, so no GPU build can be chosen safely."
    if driver_cuda and recommend(cap, None, plat) != ["cpu"]:
        return ("no PyTorch GPU build runs on a driver this old. Update the NVIDIA driver "
                "(https://www.nvidia.com/drivers), then run this again.")
    if (plat or sys.platform).startswith(("win", "linux")):
        return (f"no published PyTorch GPU build supports {_sm(cap)}. Processing runs on the CPU; "
                "a newer graphics card is the only way to the GPU here.")
    return "PyTorch has no CUDA builds for this operating system."


# ---------------------------------------------------------------------------
# Which wheels: what the index actually serves for this Python and platform.
# ---------------------------------------------------------------------------
class SetupError(Exception):
    def __init__(self, message: str, code: int = EXIT_FAILED):
        super().__init__(message)
        self.code = code


def fetch(url: str, timeout: float = 60) -> str:
    """A small text page (an index listing, wheel metadata)."""
    req = urllib.request.Request(url, headers={"User-Agent": "solaris-studio-setup-gpu"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            # The server answered: this index (or package) does not exist, e.g.
            # a forced --index cu999. Not an offline machine, so the caller
            # skips this candidate instead of blaming the connection.
            raise SetupError(f"{url} does not exist (HTTP 404); there is no such PyTorch index.") from e
        raise SetupError(f"{url} answered HTTP {e.code}. Try again later.", EXIT_CANNOT) from e
    except (urllib.error.URLError, OSError) as e:
        raise SetupError(f"Could not reach {url} ({e}). Check the internet connection and try again.",
                         EXIT_CANNOT) from e


def head_size(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "solaris-studio-setup-gpu"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return int(resp.headers.get("Content-Length") or 0) or None
    except Exception:
        return None


_ANCHOR = re.compile(r'<a\s+([^>]*)>([^<]+)</a>', re.I)
_ATTR = re.compile(r'([\w-]+)="([^"]*)"')
_WHEEL = re.compile(r"^(?P<name>[A-Za-z0-9_]+)-(?P<version>[^-]+)-(?P<py>[^-]+)-(?P<abi>[^-]+)-(?P<plat>[^-]+)\.whl$")


def parse_index(page: str, base_url: str) -> list[dict]:
    """Wheels listed on a PEP 503 page: `[{file, url, sha256, metadata, name,
    version, py, abi, plat}]`."""
    out = []
    for attrs, text in _ANCHOR.findall(page):
        fname = html.unescape(text.strip())
        m = _WHEEL.match(fname)
        if not m:
            continue
        a = dict(_ATTR.findall(attrs))
        href = html.unescape(a.get("href", ""))
        url, _, frag = urllib.parse.urljoin(base_url, href).partition("#")
        sha = frag.split("=", 1)[1] if frag.startswith("sha256=") else None
        has_meta = bool(a.get("data-dist-info-metadata") or a.get("data-core-metadata"))
        out.append({"file": fname, "url": url, "sha256": sha,
                    "metadata": (url + ".metadata") if has_meta else None, **m.groupdict()})
    return out


def platform_tags(plat: str | None = None, machine: str | None = None,
                  glibc: tuple[int, int] | None = None) -> callable:
    """A predicate for wheel platform tags this machine can install."""
    plat = plat or sys.platform
    machine = (machine or _platform.machine() or "").lower()
    if plat.startswith("win"):
        want = {"amd64": "win_amd64", "x86_64": "win_amd64", "arm64": "win_arm64"}.get(machine, "win_amd64")
        return lambda tag: tag == want
    if plat.startswith("linux"):
        arch = {"amd64": "x86_64", "arm64": "aarch64"}.get(machine, machine or "x86_64")
        if glibc is None:
            lib, ver = _platform.libc_ver()
            glibc = _version_pair(ver) if lib == "glibc" else None

        def ok(tag: str) -> bool:
            for one in tag.split("."):
                if one == f"linux_{arch}":
                    return True
                m = re.fullmatch(rf"manylinux_(\d+)_(\d+)_{arch}", one)
                legacy = {"manylinux1": (2, 5), "manylinux2010": (2, 12), "manylinux2014": (2, 17)}
                need = (int(m.group(1)), int(m.group(2))) if m else next(
                    (v for k, v in legacy.items() if one == f"{k}_{arch}"), None)
                # Unknown glibc (musl, or libc_ver() failing): assume the
                # common case rather than refusing every wheel.
                if need and (glibc is None or glibc >= need):
                    return True
            return False
        return ok
    if plat == "darwin":
        return lambda tag: tag.startswith("macosx_")
    return lambda tag: False


def _base(version: str) -> tuple[int, ...] | None:
    """`"2.14.1+cu126"` -> `(2, 14, 1)`; None for pre-releases and dev builds,
    which this never installs."""
    base = version.split("+", 1)[0]
    return tuple(int(p) for p in base.split(".")) if re.fullmatch(r"\d+(\.\d+)*", base) else None


def _local(version: str) -> str:
    return version.split("+", 1)[1] if "+" in version else ""


def compatible(wheels: list[dict], index: str, py=None, tag_ok=None) -> list[dict]:
    py = py or f"cp{sys.version_info[0]}{sys.version_info[1]}"
    tag_ok = tag_ok or platform_tags()
    out = []
    for w in wheels:
        if w["py"] != py or w["abi"] != py or not tag_ok(w["plat"]):
            continue  # also skips free-threaded cp311t wheels
        if _base(w["version"]) is None:
            continue
        # The index pages also list wheels without a local label, mirrored from
        # PyPI. Insisting on "+cu126" is what guarantees the CUDA flavour; it
        # is also what stops pip from deciding an installed 2.14.1+cpu already
        # satisfies "2.14.1".
        if _local(w["version"]) != index:
            continue
        out.append(w)
    return out


def installed_version(name: str) -> str | None:
    """From the package metadata, never by importing: importing torch here
    would lock the very DLLs pip is about to replace."""
    try:
        from importlib.metadata import PackageNotFoundError, version
    except ImportError:  # pragma: no cover - Python < 3.8
        return None
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def required_spec(requirements: Path = ROOT / "requirements.txt") -> str | None:
    """The torch specifier requirements.txt asks for, if it names torch at all.
    Today it does not (torch arrives through ultralytics), and then the
    installed version line is what the project runs on."""
    try:
        text = requirements.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        m = re.match(r"^torch(?![\w-])\s*(\[[^\]]*\])?\s*([<>=!~][^;]*)?", line, re.I)
        if m:
            return (m.group(2) or "").strip() or None
    return None


def _spec_allows(spec: str | None, version: str) -> bool:
    if not spec:
        return True
    try:
        from pip._vendor.packaging.specifiers import SpecifierSet
        from pip._vendor.packaging.version import Version
    except ImportError:
        return True  # no pip to ask; the install itself will refuse a bad pin
    return Version(version.split("+")[0]) in SpecifierSet(spec)


def _torchvision_requires(wheel: dict) -> str | None:
    """The torch specifier a torchvision wheel declares, from its metadata file
    (a few KB): "==2.14.1" on older releases, but only ">=2.14.0" on the
    2.14 line (measured: torchvision 0.29.1+cu126 says `torch (>=2.14.0)`).
    So the metadata can rule a pairing OUT but, unless it is an exact pin,
    cannot rule one in: torchvision's compiled ops only load with the torch
    minor they were built for, whatever the specifier allows."""
    if not wheel.get("metadata"):
        return None
    try:
        text = fetch(wheel["metadata"], timeout=30)
    except SetupError:
        return None
    m = re.search(r"^Requires-Dist:\s*torch\s*\(?\s*([^;)\n]*)", text, re.M | re.I)
    return re.sub(r"\s+", "", m.group(1)) if m and m.group(1).strip() else None


def _exact_pin(spec: str | None) -> str | None:
    m = re.fullmatch(r"===?([\w.+]+)", spec or "")
    return m.group(1) if m else None


def choose_wheels(index: str, *, want_line: tuple[int, int] | None, spec: str | None,
                  pages: dict | None = None, py=None, tag_ok=None, check_metadata: bool = True) -> dict:
    """`{"index", "torch": wheel, "torchvision": wheel}` for one index.

    Keeps the version line already installed (the one this checkout runs on)
    when the index has it, and otherwise takes the newest the index offers
    that requirements.txt allows: an old card's only build can be an older
    line (cu126 stops after 2.14), and an older PyTorch that runs beats a
    current one that does not.
    """
    pages = pages if pages is not None else {}
    found = {}
    for name in PACKAGES:
        url = f"{INDEX_ROOT}/{index}/{name}/"
        page = pages[name] if name in pages else fetch(url)
        found[name] = compatible(parse_index(page, url), index, py=py, tag_ok=tag_ok)
    torches = sorted((w for w in found["torch"] if _spec_allows(spec, w["version"])),
                     key=lambda w: _base(w["version"]), reverse=True)
    if not torches:
        py_name = py or f"cp{sys.version_info[0]}{sys.version_info[1]}"
        raise SetupError(f"download.pytorch.org/whl/{index} has no torch wheel for this Python ({py_name}) "
                         f"and platform{f' within {spec}' if spec else ''}.")
    if want_line:
        same = [w for w in torches if _base(w["version"])[:2] == tuple(want_line)]
        torches = same + [w for w in torches if w not in same]
    for torch_wheel in torches:
        tv = _pair_torchvision(torch_wheel, found["torchvision"], check_metadata)
        if tv:
            return {"index": index, "torch": torch_wheel, "torchvision": tv}
    raise SetupError(f"download.pytorch.org/whl/{index} has torch but no matching torchvision "
                     f"for this Python and platform.")


def _pair_torchvision(torch_wheel: dict, visions: list[dict], check_metadata: bool) -> dict | None:
    tb = _base(torch_wheel["version"])
    # torch 2.N ships with torchvision 0.(N+15) — true from 2.0/0.15 through
    # 2.14/0.29. Used to shortlist; the wheel's own metadata has the last word.
    guess = [w for w in visions if _base(w["version"])[:2] == (0, tb[1] + 15)] if tb[0] == 2 else []
    rest = [w for w in visions if w not in guess]
    for w in sorted(guess, key=lambda w: _base(w["version"]), reverse=True) + \
            sorted(rest, key=lambda w: _base(w["version"]), reverse=True):
        spec = _torchvision_requires(w) if check_metadata else None
        pin = _exact_pin(spec)
        if pin is not None:
            if _base(pin) == tb:
                return w
            continue
        if w in guess and (spec is None or _spec_allows(spec, torch_wheel["version"])):
            # The naming rule says this pair was built together, and a loose
            # specifier (">=2.14.0") or none does not contradict it.
            return w
    return None


# ---------------------------------------------------------------------------
# Doing it.
# ---------------------------------------------------------------------------
def _quote(parts: list[str]) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline(parts)
    return " ".join(shlex.quote(p) for p in parts)


def pip_command(python: str, index: str, files: list[str], repair: bool = False) -> list[str]:
    # Exact wheel files, so pip cannot substitute another build, and the
    # index only for torch's own dependencies (on Linux the nvidia-* CUDA
    # libraries). PyTorch's index on its own, as PyTorch documents it: adding
    # PyPI as an extra index is the dependency-confusion setup of the 2022
    # torchtriton incident. No --force-reinstall: that would also reinstall
    # numpy, pillow and the rest for nothing.
    #
    # repair: the exact versions are already installed but do not load (an
    # interrupted install, deleted files). pip would call them "already
    # satisfied" and do nothing, so they are reinstalled -- with --no-deps,
    # because the same versions need the dependencies that are already there.
    extra = ["--force-reinstall", "--no-deps"] if repair else []
    return [python, "-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", *extra,
            "--index-url", f"{INDEX_ROOT}/{index}/", *files]


VERIFY = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
out = {"usable": False, "loads": False}
try:
    import torch
    out["torch"] = torch.__version__
    out["cuda"] = getattr(torch.version, "cuda", None)
    # torchvision is half of the pair: a torchvision built for another torch
    # imports, then fails on its first compiled op ("operator torchvision::nms
    # does not exist"), so the CPU op is run too. Without it the app's
    # detection is broken even on the CPU, and that is "does not load".
    import torchvision
    out["torchvision"] = torchvision.__version__
    boxes = torch.tensor([[0, 0, 10, 10], [1, 1, 10, 10], [50, 50, 60, 60]], dtype=torch.float32)
    keep = torchvision.ops.nms(boxes, torch.tensor([0.9, 0.8, 0.7]), 0.5)
    assert keep.tolist() == [0, 2], keep.tolist()
    out["loads"] = True
    out["archs"] = torch.cuda.get_arch_list()
    from core.gpu import cuda_usable
    ok, reason = cuda_usable()
    out["reason"] = reason
    if ok:
        # cuda_usable() already ran a kernel; this also proves torchvision's
        # compiled CUDA ops match the build (detection runs nms on the GPU).
        x = torch.arange(1024, device="cuda", dtype=torch.float32)
        assert float((x * 2).sum().item()) == 1047552.0
        boxes = torch.tensor([[0, 0, 10, 10], [1, 1, 10, 10], [50, 50, 60, 60]],
                             dtype=torch.float32, device="cuda")
        keep = torchvision.ops.nms(boxes, torch.tensor([0.9, 0.8, 0.7], device="cuda"), 0.5)
        torch.cuda.synchronize()
        assert keep.tolist() == [0, 2], keep.tolist()
        out["usable"] = True
except BaseException as e:
    out["usable"] = False
    out["reason"] = f"{type(e).__name__}: {e}"[:400]
print("SOLARIS_VERIFY " + json.dumps(out, default=str))
"""


def verify(python: str) -> dict:
    """Load the installed build in a FRESH process and prove a kernel runs.
    Fresh because this process must never import torch (see the module
    docstring), and because only a new process sees the new files."""
    try:
        result = subprocess.run([python, "-c", VERIFY, str(ROOT)], capture_output=True, text=True,
                                timeout=600, cwd=str(ROOT),
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        return {"usable": False, "reason": "the test took over 10 minutes and was stopped"}
    except OSError as e:
        return {"usable": False, "reason": f"could not start Python ({e})"}
    for line in (result.stdout or "").splitlines():
        if line.startswith("SOLARIS_VERIFY "):
            try:
                return json.loads(line[len("SOLARIS_VERIFY "):])
            except ValueError:
                break
    tail = ((result.stderr or "") + (result.stdout or "")).strip().splitlines()[-3:]
    return {"usable": False, "reason": "PyTorch crashed while loading: " + " | ".join(tail)[-400:]}


def download(wheel: dict, folder: Path, say, lo: float, hi: float, size_hint: int | None) -> Path:
    """Stream one wheel to `folder` with real progress, resuming a cut
    connection, and check its SHA-256 against the index. pip's own progress
    bar is not readable from a pipe, and 2.6 GB with no progress looks hung."""
    target = folder / wheel["file"]
    total = size_hint or 0
    for attempt in range(1, 6):
        have = target.stat().st_size if target.exists() else 0
        headers = {"User-Agent": "solaris-studio-setup-gpu"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(wheel["url"], headers=headers),
                                        timeout=60) as resp:
                if have and resp.status != 206:
                    have = 0  # the server ignored the range: start over
                mode = "ab" if have else "wb"
                length = int(resp.headers.get("Content-Length") or 0)
                total = total or (have + length)
                done, last = have, 0.0
                with open(target, mode) as f:
                    while True:
                        chunk = resp.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        now = time.monotonic()
                        if now - last > 1.0:
                            last = now
                            frac = done / total if total else 0
                            say("download", f"Downloading {wheel['file']}: {done / 1e9:.2f} of "
                                            f"{total / 1e9:.2f} GB", lo + (hi - lo) * frac,
                                bytes=done, total=total)
            break
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            if attempt == 5:
                raise SetupError(f"Downloading {wheel['file']} failed five times ({e}). "
                                 f"Check the connection and run this again.", EXIT_CANNOT) from e
            say("download", f"Connection dropped ({e}); resuming ({attempt}/5)…")
            time.sleep(min(30, 2 ** attempt))
    if wheel.get("sha256"):
        digest = hashlib.sha256()
        with open(target, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 22), b""):
                digest.update(chunk)
        if digest.hexdigest() != wheel["sha256"]:
            target.unlink(missing_ok=True)
            raise SetupError(f"{wheel['file']} arrived damaged (its SHA-256 does not match the index). "
                             f"Run this again.", EXIT_CANNOT)
    return target


def run_pip(cmd: list[str], say, lo: float, hi: float) -> tuple[int, str]:
    say("install", "Installing — the old build is moved aside first, so a failure leaves it in place.", lo,
        command=_quote(cmd))
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "PIP_NO_INPUT": "1"}
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace", env=env,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except OSError as e:
        return 1, f"could not start pip: {e}"
    lines = []
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        lines.append(line)
        pct = hi - 1 if line.startswith("Successfully installed") else \
            (lo + hi) / 2 if line.startswith("Installing collected packages") else None
        say("install", line, pct)
    proc.wait()
    return proc.returncode, "\n".join(lines)


def _site_packages() -> Path | None:
    try:
        import sysconfig

        return Path(sysconfig.get_paths()["purelib"])
    except Exception:
        return None


# pip names its stash "~" + characters from its LEADING_CHARS ("-~.=%0123456789")
# + the rest of the name (pip/_internal/utils/temp_dir.py), so "~orch",
# "~-rch", "~.rch" and "~0rch" are all the same leftover.
_STASH = re.compile(r"^~[-~.=%0-9]*(?:t?o?r?ch(?:vision|gen)?|f?u?n?c?torch)(?:-[\w.+]+\.dist-info)?$")


def clean_stale_stashes() -> int:
    """Remove what an earlier run had to leave behind on Windows.

    pip replaces a loaded DLL by moving the old one aside into a folder named
    like `~orch` and then fails to delete it, because the engine still had it
    mapped. Harmless, but each one is the size of a PyTorch build and pip
    warns about it forever ("Ignoring invalid distribution ~orch"). Once
    Solaris Studio has restarted nothing holds them.
    """
    site = _site_packages()
    if not site or not site.is_dir():
        return 0
    removed = 0
    for entry in site.iterdir():
        if entry.is_dir() and _STASH.match(entry.name):
            shutil.rmtree(entry, ignore_errors=True)
            removed += not entry.exists()
    return removed


def free_bytes(path: Path) -> int:
    try:
        return shutil.disk_usage(path).free
    except OSError:
        return 1 << 62  # cannot tell: do not block on it


def terminal_command(args: list[str]) -> str:
    return _quote([sys.executable, str(SCRIPT), *args])


# ---------------------------------------------------------------------------
# The plan, and carrying it out.
# ---------------------------------------------------------------------------
def build_plan(args, say) -> dict:
    found = detect_gpus()
    gpus = found["gpus"]
    if gpus:
        for g in gpus:
            say("detect", f"GPU: {g['name']} ({_sm(g['compute_capability'])}), driver {g['driver'] or '?'}"
                          + (f", CUDA {found['driver_cuda'][0]}.{found['driver_cuda'][1]} or older"
                             if found["driver_cuda"] else ""), 3)
    else:
        say("detect", "No NVIDIA GPU found (nvidia-smi is missing or reports none).", 3)

    if args.cpu:
        candidates, why = ["cpu"], "Asked for the CPU-only build."
    elif args.index:
        candidates, why = [args.index], f"Asked for the {args.index} index."
    else:
        candidates, why = candidate_indexes(found)
    say("plan", why, 5)

    current = installed_version("torch")
    spec = required_spec()
    plan = {"gpus": gpus, "driver": found["driver"], "driver_cuda": found["driver_cuda"],
            "current": current, "current_torchvision": installed_version("torchvision"),
            "requirement": spec, "candidates": candidates, "why": why, "steps": [], "skipped": []}
    return plan


def resolve_wheels(plan: dict, say) -> dict:
    """Fill in the wheel files for each candidate index. Separate from
    build_plan so "nothing to change" is decided without the network."""
    current, spec = plan["current"], plan["requirement"]
    want_line = _base(current)[:2] if current and _base(current) else None
    for index in plan["candidates"]:
        try:
            choice = choose_wheels(index, want_line=want_line, spec=spec)
        except SetupError as e:
            if e.code == EXIT_CANNOT:
                raise
            plan["skipped"].append({"index": index, "reason": str(e)})
            say("plan", f"Skipping {index}: {e}", 6)
            continue
        for key in PACKAGES:
            choice[key]["size"] = head_size(choice[key]["url"])
        plan["steps"].append(choice)
    if not plan["steps"]:
        raise SetupError("None of the candidate indexes has wheels for this Python and platform: "
                         + "; ".join(s["reason"] for s in plan["skipped"]), EXIT_CANNOT)
    return plan


def describe(plan: dict, say) -> None:
    py = sys.executable
    tmp = "<download folder>"
    for n, step in enumerate(plan["steps"], 1):
        t, v = step["torch"], step["torchvision"]
        size = sum(step[k].get("size") or 0 for k in PACKAGES)
        label = "Then, if that one cannot run here" if n > 1 else "Install"
        say("plan", f"{label}: torch {t['version']} + torchvision {v['version']} from "
                    f"{INDEX_ROOT}/{step['index']}/ ({size / 1e9:.2f} GB download"
                    + (", plus NVIDIA's CUDA libraries from the same index" if
                       sys.platform.startswith("linux") and step["index"] != "cpu" else "") + ")")
        for key in PACKAGES:
            say("plan", f"  download {step[key]['url']}  (sha256 {step[key]['sha256'] or 'not listed'})")
        cmd = pip_command(py, step["index"], [f"{tmp}/{step[k]['file']}" for k in PACKAGES])
        say("plan", "  " + _quote(cmd), command=_quote(cmd))
        what = "<check the build loads>" if step["index"] == "cpu" else             "<run a kernel and torchvision nms on the GPU>"
        say("plan", f"  verify: {_quote([py, '-c', what, str(ROOT)])}")
    if plan["candidates"] != ["cpu"]:
        say("plan", "If no build passes the test, the CPU build is put back.")


def carry_out(plan: dict, args, say) -> dict:
    """Install the planned builds in order until one proves itself. Returns
    the result dict; raises SetupError for the locked-files case."""
    removed = clean_stale_stashes()
    if removed:
        say("prepare", f"Removed {removed} folder(s) an earlier install left behind.", 8)
    tried = []
    steps = plan["steps"]
    span = 85 / max(1, len(steps))
    work = Path(tempfile.mkdtemp(prefix="solaris-gpu-"))
    # Whether pip has replaced PyTorch yet in this run. Once it has, every way
    # out of here must either keep a build that passed the test or put a CPU
    # build back: a later candidate failing to download is no reason to leave
    # an earlier candidate that could not even load.
    state = {"changed": False}
    try:
        for n, step in enumerate(steps):
            lo = 10 + span * n
            try:
                ok, info = _install_step(step, work, args, say, lo, lo + span,
                                         verify_gpu=step["index"] != "cpu", state=state)
            except SetupError as e:
                if e.code == EXIT_LOCKED or not state["changed"]:
                    e.changed = state["changed"]
                    raise
                ok, info = False, {"reason": str(e)}
            tried.append({"index": step["index"], **info})
            if ok:
                gpu = info.get("reason") or "the GPU"
                if step["index"] == "cpu":
                    msg = (f"Installed PyTorch {info.get('torch')} (CPU-only)."
                           " Restart Solaris Studio to use it.")
                else:
                    msg = (f"PyTorch {info.get('torch')} can use {gpu}: a test ran on it. "
                           "Restart Solaris Studio to use the GPU.")
                return {"ok": True, "gpu": step["index"] != "cpu", "index": step["index"],
                        "torch": info.get("torch"), "changed": True, "restart": True,
                        "message": msg, "tried": tried}
            say("verify", f"{step['index']} installed but cannot run here: {info.get('reason')}", lo + span)
        reasons = "; ".join(f"{t['index']}: {t.get('reason')}" for t in tried)
        if not state["changed"]:
            # pip never replaced anything (every candidate failed before or
            # inside pip, and pip rolls its own failures back): the build that
            # was there is still there, so there is nothing to restore.
            return {"ok": False, "gpu": False, "index": None, "torch": plan["current"], "changed": False,
                    "restart": False, "tried": tried,
                    "message": f"No build could be installed ({reasons}). PyTorch was left as it was."}
        if steps[-1]["index"] == "cpu":
            # The CPU build was the last thing tried and it did not load:
            # installing it again would fail the same way.
            restored = None
        else:
            # Nothing worked: leave a CPU build that certainly loads.
            say("restore", "No GPU build passed the test; putting the CPU build back.", 96)
            restored = None
            try:
                cpu = choose_wheels("cpu", want_line=_base(steps[0]["torch"]["version"])[:2],
                                    spec=plan["requirement"])
                ok, info = _install_step(cpu, work, args, say, 96, 99, verify_gpu=False, state=state)
                restored = info.get("torch") if ok else None
                if not ok:
                    say("restore", f"The CPU build did not load either: {info.get('reason')}")
            except SetupError as e:
                if e.code == EXIT_LOCKED:
                    e.changed = True
                    raise
                say("restore", f"Could not restore the CPU build: {e}")
        lead = ("The CPU build did not load" if steps == [] or steps[0]["index"] == "cpu"
                else "No GPU build of PyTorch could run on this machine")
        msg = (f"{lead} ({reasons}). "
               + (f"PyTorch {restored} (CPU-only) is installed instead, so processing runs on the CPU. "
                  if restored else "The CPU build could not be put back either; run "
                                   + terminal_command(["--cpu"]) + " with Solaris Studio closed. ")
               + "Restart Solaris Studio.")
        return {"ok": False, "gpu": False, "index": "cpu" if restored else None, "torch": restored,
                "changed": True, "restart": True, "message": msg, "tried": tried}
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _install_step(step: dict, work: Path, args, say, lo: float, hi: float,
                  verify_gpu: bool = True, state: dict | None = None) -> tuple[bool, dict]:
    state = state if state is not None else {"changed": False}
    size = sum(step[k].get("size") or 0 for k in PACKAGES)
    # Room for the download and the unpacked copy beside the old one, which
    # pip keeps until the new one is in.
    need = int(size * 3.2) + (1 << 30)
    if sys.platform.startswith("linux") and step["index"] != "cpu":
        # On Linux the torch wheel is under 1 GB, but pip then fetches
        # NVIDIA's CUDA libraries (cuBLAS, cuDNN, NCCL, ...) from the same
        # index: roughly 3 GB more to download and about twice that unpacked.
        need += 7 << 30
    for where in {work, _site_packages() or work}:
        if free_bytes(where) < need:
            raise SetupError(f"Not enough disk space on {where}: this needs about {need / 1e9:.1f} GB free "
                             f"and there is {free_bytes(where) / 1e9:.1f} GB.", EXIT_CANNOT)
    files = []
    dl_span = (hi - lo) * 0.6
    total = size or 1
    start = lo
    for key in PACKAGES:
        part = (step[key].get("size") or 0) / total * dl_span
        files.append(str(download(step[key], work, say, start, start + part, step[key].get("size"))))
        start += part
    repair = all(installed_version(k) == step[k]["version"] for k in PACKAGES)
    code, output = run_pip(pip_command(sys.executable, step["index"], files, repair=repair), say,
                           lo + dl_span, lo + (hi - lo) * 0.85)
    for f in files:
        Path(f).unlink(missing_ok=True)  # 2.6 GB is worth giving back now
    if code == 0 or "Installing collected packages" in output:
        # pip rolls back its own failures, but once it has started moving
        # files a crash in the middle is not guaranteed to be undone; counting
        # it as a change means the run ends with a build that passed a test
        # or with the CPU build put back, never with "whatever pip left".
        state["changed"] = True
    if code != 0:
        if _LOCKED.search(output):
            before = ("An earlier build from this run is installed, but it did not pass the test."
                      if state.get("installed") else "PyTorch was left as it was.")
            raise SetupError(
                "Windows would not let pip replace PyTorch's files because a running program has them "
                f"open — almost always Solaris Studio itself, or another Python using this folder. {before} "
                "Close Solaris Studio completely, then run this in a terminal:\n    "
                + terminal_command(_rerun_args(args, step["index"])), EXIT_LOCKED)
        tail = " | ".join(output.strip().splitlines()[-3:])[-500:]
        return False, {"reason": f"pip failed (exit {code}): {tail}"}
    state["installed"] = True
    say("verify", "Testing the new build on the GPU…" if verify_gpu else "Checking the build loads…",
        lo + (hi - lo) * 0.9)
    result = verify(sys.executable)
    if not verify_gpu:
        # "Loads" means torch AND torchvision import and run an op; torch
        # alone importing is how a mismatched torchvision slips through.
        loaded = bool(result.get("loads"))
        return loaded, {"torch": result.get("torch"),
                        "reason": None if loaded else result.get("reason")}
    return bool(result.get("usable")), result


def _rerun_args(args, index: str) -> list[str]:
    if args.cpu or index == "cpu":
        return ["--cpu"]
    return ["--index", index] if args.index else []


def _current_works(say) -> dict | None:
    """The installed build's own verdict, when there is one to ask."""
    if not installed_version("torch"):
        return None
    say("detect", "Checking whether the installed PyTorch can already use the GPU…", 2)
    return verify(sys.executable)


def refuse_frozen() -> str:
    return ("This is the installed Solaris Studio app, which carries its own PyTorch inside it; "
            "that copy cannot be swapped from here. Its GPU support is fixed when the app is built "
            "(the Storage & health page says which cards it covers). To choose a PyTorch build for "
            "this machine yourself, run Solaris Studio from source and run "
            "`python scripts/setup_gpu.py` in that checkout.")


def wrong_python() -> str | None:
    """Installing into a Python the app does not run on would succeed and change
    nothing — the classic `pip` that belongs to some other Python."""
    venv = ROOT / "venv"
    if not venv.is_dir():
        return None  # no project venv (Docker, conda, a system install): use this Python
    try:
        here = Path(sys.prefix).resolve()
        if here == venv.resolve():
            return None
    except OSError:
        return None
    exe = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return (f"This is not the project's Python ({sys.executable}). Run it with the one Solaris Studio "
            f"uses, so the install lands where the app looks:\n    {_quote([str(exe), str(SCRIPT), *sys.argv[1:]])}")


def main(argv: list[str] | None = None, stream=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--cpu", action="store_true", help="install the CPU-only build")
    group.add_argument("--index", metavar="cuXXX", help="force one wheel index, e.g. cu126 or cu130")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and the exact commands; change nothing")
    ap.add_argument("--json", action="store_true", help="one JSON object per line: {stage, pct, msg}")
    args = ap.parse_args(argv)
    say = Reporter(args.json, stream)

    def finish(result: dict, code: int, stage: str | None = None) -> int:
        say(stage or ("done" if code == EXIT_OK else "error"), result["message"], 100, result=result)
        return code

    if args.index and not _INDEX_NAME.match(args.index):
        return finish({"ok": False, "message": f"--index takes a PyTorch wheel index such as cu126, "
                                               f"cu130 or cpu, not {args.index!r}."}, EXIT_CANNOT)
    if args.index == "cpu":
        args.cpu, args.index = True, None
    if getattr(sys, "frozen", False):
        return finish({"ok": False, "frozen": True, "message": refuse_frozen()}, EXIT_FROZEN, "refused")
    problem = wrong_python()
    if problem:
        return finish({"ok": False, "message": problem}, EXIT_CANNOT)

    try:
        plan = build_plan(args, say)
        if not args.cpu and not args.index:
            loads = None
            if plan["candidates"] == ["cpu"] and plan["current"]:
                # Only the metadata says PyTorch is installed; an interrupted
                # earlier install can leave the dist-info behind with half the
                # files. Ask the build itself before calling it fine.
                say("detect", "Checking that the installed PyTorch loads…", 4)
                loads = verify(sys.executable)
            if plan["candidates"] == ["cpu"] and plan["current"] and loads.get("loads"):
                # A GPU-less machine with any working PyTorch is already fine:
                # every build runs on the CPU. Swapping a working install for a
                # smaller one is the user's call (--cpu), not ours.
                msg = (f"{plan['why']} The installed PyTorch {plan['current']} runs on the CPU, so there "
                       f"is nothing to change. (--cpu swaps it for the smaller CPU-only build.)")
                if not args.dry_run:
                    return finish({"ok": True, "gpu": False, "changed": False, "restart": False,
                                   "message": msg, "plan": _public(plan)}, EXIT_OK)
                say("plan", msg)
            elif plan["candidates"] == ["cpu"] and plan["current"]:
                say("detect", f"The installed PyTorch ({plan['current']}) does not load: {loads.get('reason')}. "
                              f"Installing the CPU build.", 4)
                plan["current"] = plan["current_torchvision"] = None  # never "already installed"
            elif plan["candidates"] != ["cpu"]:
                now = _current_works(say)
                if now and now.get("usable"):
                    msg = (f"PyTorch {now.get('torch')} already runs on {now.get('reason')}: nothing to change.")
                    return finish({"ok": True, "gpu": True, "changed": False, "restart": False,
                                   "message": msg, "plan": _public(plan)}, EXIT_OK)
                if now:
                    say("detect", f"The installed PyTorch ({now.get('torch') or plan['current']}) cannot use the "
                                  f"GPU: {now.get('reason')}", 4)
        resolve_wheels(plan, say)
        first = plan["steps"][0]
        if (args.cpu and plan["current"] == first["torch"]["version"]
                and plan["current_torchvision"] == first["torchvision"]["version"]
                # --cpu is also the recovery command this script hands out, so
                # "already installed" has to mean "installed and loads".
                and verify(sys.executable).get("loads")):
            return finish({"ok": True, "gpu": False, "changed": False, "restart": False,
                           "message": f"PyTorch {plan['current']} (CPU-only) is already installed.",
                           "plan": _public(plan)}, EXIT_OK)
        describe(plan, say)
        if args.dry_run:
            return finish({"ok": True, "dry_run": True, "changed": False, "restart": False,
                           "message": "Dry run: nothing was downloaded or changed.",
                           "plan": _public(plan)}, EXIT_OK)
        result = carry_out(plan, args, say)
        return finish(result, EXIT_OK if result["ok"] else EXIT_FAILED)
    except SetupError as e:
        changed = bool(getattr(e, "changed", False))
        result = {"ok": False, "message": str(e), "locked": e.code == EXIT_LOCKED,
                  "changed": changed, "restart": changed}
        if e.code == EXIT_LOCKED:
            result["command"] = str(e).rsplit("\n", 1)[-1].strip()
        return finish(result, e.code)
    except KeyboardInterrupt:
        # Ctrl+C reaches pip too, and pip rolls back the package it was on;
        # but an earlier candidate may already be in. Running again (or with
        # --cpu) always ends with a tested build.
        return finish({"ok": False, "changed": True, "restart": True,
                       "message": "Stopped before finishing. PyTorch may be half-changed: run "
                                  + terminal_command(_rerun_args(args, args.index or "")) + " again "
                                  "(or with --cpu) before using Solaris Studio."}, EXIT_FAILED)


def _public(plan: dict) -> dict:
    """The plan without the parts that are only noise in a JSON result."""
    steps = [{"index": s["index"],
              **{k: {"version": s[k]["version"], "url": s[k]["url"], "size": s[k].get("size"),
                     "sha256": s[k]["sha256"]} for k in PACKAGES}} for s in plan["steps"]]
    return {"gpus": [{**g, "compute_capability": _sm(g["compute_capability"]) if g["compute_capability"] else None}
                     for g in plan["gpus"]],
            "driver": plan["driver"],
            "driver_cuda": ".".join(map(str, plan["driver_cuda"])) if plan["driver_cuda"] else None,
            "current": plan["current"], "candidates": plan["candidates"], "why": plan["why"],
            "steps": steps, "skipped": plan["skipped"]}


if __name__ == "__main__":
    sys.exit(main())
