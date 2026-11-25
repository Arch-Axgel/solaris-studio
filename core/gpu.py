"""Whether CUDA can actually run here, as opposed to merely being present.

`torch.cuda.is_available()` is the obvious check and it is not enough. It
answers "is there a driver and a device", not "was this build compiled for that
device". A GPU outside the shipped build's architecture list passes it, accepts
`.to("cuda")` without complaint — moving weights launches no kernel — and then
dies at the first inference with:

    CUDA error: no kernel image is available for execution on the device

That was issue #83: an RTX 5070 Ti (Blackwell, sm_120) against a CUDA 12.6
build whose newest architecture is sm_90.

This is a check rather than a one-off version bump because no build covers
every card, so the same failure arrives from the other end too: CUDA 13 gains
Blackwell and drops Maxwell, Pascal and Volta. Whatever we ship, somebody's GPU
is outside it, and the honest answer is to run on CPU and say so rather than to
crash halfway through their video.

The other half of this module names the hardware WITHOUT PyTorch (NVML, then
nvidia-smi). A CPU-only PyTorch build — what a plain `pip install torch` gives
on Windows — sees no GPU at all, and asking only torch reported a real Quadro
P3200 as "no CUDA GPU detected", which sends someone to check hardware that is
fine. The same probes feed gpu_report(), which states every GPU consumer's view
side by side (PyTorch, CTranslate2/Whisper, ONNX Runtime, FFmpeg encoders),
because those can and do disagree: on that same Quadro, Whisper and NVENC could
use the card while PyTorch could not.

Every probe here is optional, time-limited and exception-safe. A GPU-less VPS,
an AMD/Intel-only PC and a machine with a broken driver must all land on the
CPU quietly, never on a traceback.
"""

import functools
import os
import re
import shutil
import subprocess
import sys
import threading


# The one reason callers need to tell apart from the rest: having no GPU and
# having one this build cannot use both mean "running on CPU", but the first is
# a hardware fact and the second is our problem to fix in a release. Compared
# by identity rather than by matching on prose, which would rot.
NO_GPU = "no CUDA GPU detected"

# The marker phrases the other verdicts carry. Preflight picks its advice by
# these, the same way gpu_too_old() reads "older than"; they are defined once
# here so the sentence and the test for it cannot drift apart.
_CPU_ONLY = "CPU-only PyTorch build"
_UPDATE_DRIVER = "update the NVIDIA driver"
_KERNEL_FAILED = "failed a test computation"

# Long enough for a cold NVML init or nvidia-smi on a busy machine, short
# enough that a hung driver costs preflight seconds rather than the session.
PROBE_TIMEOUT_S = 5.0

# The whole PyTorch verdict - CUDA init plus one tiny kernel - gets far longer
# than a driver query: a cold CUDA context on Windows takes seconds, and lazy
# module loading can add more on a big card. But not forever: a wedged driver
# hangs CUDA init the same way it hangs nvidia-smi, and preflight, the tracker
# and the GPU report all wait on this answer.
VERDICT_TIMEOUT_S = 90.0

_DEVICE: str | None = None
# Set once the verdict has timed out. The abandoned thread still holds
# PyTorch's CUDA init lock, so asking again would only hang again; every later
# caller gets this reason at once and stays on the CPU.
_HUNG: str | None = None


def gpu_too_old(reason: str) -> bool:
    """Whether `reason` describes a card BELOW the build's oldest architecture.

    The two unusable cases need opposite advice. A card newer than the build is
    ours to fix in a release; a card older than it never will be, because the
    CUDA that gains new architectures is the same one that drops old ones.
    Telling a GTX 1060 owner to wait for a newer build is telling them to wait
    for the thing that would remove their card entirely.
    """
    return "older than" in reason


def cpu_only_build(reason: str) -> bool:
    """Whether `reason` says the GPU is real but PyTorch was built without CUDA.

    The fix is an install, not hardware and not a release: the right PyTorch
    wheel for the card (see recommend_torch_index)."""
    return _CPU_ONLY in reason


def driver_too_old(reason: str) -> bool:
    """Whether `reason` blames the NVIDIA driver being older than the CUDA
    this PyTorch build needs — fixed by a driver update, nothing else."""
    return _UPDATE_DRIVER in reason


def kernel_failed(reason: str) -> bool:
    """Whether a card the build supports failed the test computation. Neither
    "too old" nor "too new": reinstalling the same build will not help, a
    driver update or a restart usually does."""
    return _KERNEL_FAILED in reason


def _parse_arch(arch: str) -> tuple[int, int] | None:
    """`"sm_86"` -> `(8, 6)`. The last digit is the minor version and
    everything before it is the major, which is the only reading that gets
    both `sm_86` (8.6) and `sm_120` (12.0) right."""
    if not arch.startswith("sm_"):
        return None  # ignore "compute_*" PTX entries; see cuda_usable()
    digits = arch[3:]
    if not digits.isdigit() or len(digits) < 2:
        return None
    return int(digits[:-1]), int(digits[-1])


def _runs_on(arch: tuple[int, int], device: tuple[int, int]) -> bool:
    """Whether code compiled for `arch` runs on a device of capability
    `device`.

    Same major version, at or below the device's minor. CUDA is forward
    compatible within a major version but not across one: an RTX 4090 (sm_89)
    runs happily on sm_86 kernels, while an sm_120 card runs on nothing below
    sm_120. Testing for an exact match instead would quietly demote every 4090
    to CPU.
    """
    return arch[0] == device[0] and arch[1] <= device[1]


def _sm(cap: tuple[int, int]) -> str:
    return f"sm_{cap[0]}{cap[1]}"


def _parse_version(text) -> tuple[int, int] | None:
    """`"12.6"` -> `(12, 6)`; None for a CPU build's `torch.version.cuda`."""
    m = re.match(r"\s*(\d+)\.(\d+)", str(text or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


# ---------------------------------------------------------------------------
# The hardware, named without PyTorch.
# ---------------------------------------------------------------------------
def _timed(fn, timeout: float = PROBE_TIMEOUT_S):
    """`fn()`, or None if it raised or ran past `timeout`.

    A daemon thread rather than a signal, because signals do not exist on
    Windows and only work on the main thread elsewhere. A probe that hangs is
    abandoned, not killed — acceptable for a read-only driver query, and far
    better than a preflight that never returns.
    """
    box: dict = {}

    def run():
        try:
            box["value"] = fn()
        except Exception:
            pass  # a failed probe is "unknown", which every caller handles

    t = threading.Thread(target=run, daemon=True, name="gpu-probe")
    t.start()
    t.join(timeout)
    return None if t.is_alive() else box.get("value")


def _text(value) -> str:
    # Older pynvml returns bytes for names and versions, newer returns str.
    return value.decode(errors="replace") if isinstance(value, bytes) else str(value)


def _driver_cuda(value: int) -> tuple[int, int] | None:
    """NVML's packed CUDA version: 12080 -> (12, 8)."""
    return (value // 1000, (value % 1000) // 10) if value and value > 0 else None


def _nvml_query() -> dict:
    import pynvml  # nvidia-ml-py; absent or driverless is the normal no-GPU case

    pynvml.nvmlInit()
    try:
        out: dict = {"gpus": [], "driver": None, "driver_cuda": None, "source": "nvml"}
        try:
            out["driver"] = _text(pynvml.nvmlSystemGetDriverVersion())
        except Exception:
            pass
        for getter in ("nvmlSystemGetCudaDriverVersion_v2", "nvmlSystemGetCudaDriverVersion"):
            try:
                out["driver_cuda"] = _driver_cuda(getattr(pynvml, getter)())
                break
            except Exception:
                continue
        for i in range(pynvml.nvmlDeviceGetCount()):
            h = pynvml.nvmlDeviceGetHandleByIndex(i)
            gpu: dict = {"index": i, "name": _text(pynvml.nvmlDeviceGetName(h)),
                         "compute_capability": None, "vram_bytes": None,
                         "uuid": None, "pci_bus_id": None}
            # Each field on its own: an old driver missing one query must not
            # cost the rest of what is known about the card.
            try:
                major, minor = pynvml.nvmlDeviceGetCudaComputeCapability(h)
                gpu["compute_capability"] = (int(major), int(minor))
            except Exception:
                pass
            try:
                gpu["vram_bytes"] = int(pynvml.nvmlDeviceGetMemoryInfo(h).total)
            except Exception:
                pass
            try:
                gpu["uuid"] = _text(pynvml.nvmlDeviceGetUUID(h))
            except Exception:
                pass
            try:
                gpu["pci_bus_id"] = _text(pynvml.nvmlDeviceGetPciInfo(h).busId)
            except Exception:
                pass
            out["gpus"].append(gpu)
        return out
    finally:
        try:
            pynvml.nvmlShutdown()  # reference-counted, so other users' init survives
        except Exception:
            pass


def _smi_exe() -> str | None:
    found = shutil.which("nvidia-smi")
    if found:
        return found
    # Not always on PATH: the Windows driver puts it in System32 (or NVSMI on
    # older drivers), WSL keeps it with the passed-through driver libraries.
    candidates = ["/usr/lib/wsl/lib/nvidia-smi", "/usr/bin/nvidia-smi"]
    if os.name == "nt":
        candidates = [
            os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "nvidia-smi.exe"),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"),
                         "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
        ]
    return next((c for c in candidates if os.path.isfile(c)), None)


def _smi(args: list[str]) -> str | None:
    exe = _smi_exe()
    if not exe:
        return None
    try:
        result = subprocess.run(
            [exe, *args], capture_output=True, text=True, timeout=PROBE_TIMEOUT_S,
            # No console window flashing up from the packaged app on Windows.
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
        )
    except Exception:
        return None
    return result.stdout if result.returncode == 0 else None


def _smi_query() -> dict | None:
    fields = ["index", "name", "compute_cap", "memory.total", "driver_version", "pci.bus_id", "uuid"]
    out = _smi([f"--query-gpu={','.join(fields)}", "--format=csv,noheader,nounits"])
    if out is None:
        # compute_cap only exists in nvidia-smi from driver 510 on, and an
        # unknown field fails the whole query rather than leaving a blank.
        fields.remove("compute_cap")
        out = _smi([f"--query-gpu={','.join(fields)}", "--format=csv,noheader,nounits"])
    if not out:
        return None
    gpus, driver = [], None
    for line in out.strip().splitlines():
        row = dict(zip(fields, (p.strip() for p in line.split(","))))
        if not row.get("name"):
            continue
        cap = _parse_version(row.get("compute_cap"))
        try:
            vram = int(float(row.get("memory.total", ""))) * 1024 * 1024
        except ValueError:
            vram = None
        gpus.append({"index": int(row["index"]) if row.get("index", "").isdigit() else len(gpus),
                     "name": row["name"], "compute_capability": cap, "vram_bytes": vram,
                     "uuid": row.get("uuid") or None, "pci_bus_id": row.get("pci.bus_id") or None})
        driver = driver or row.get("driver_version") or None
    banner = _smi([]) or ""
    m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", banner)
    return {"gpus": gpus, "driver": driver,
            "driver_cuda": (int(m.group(1)), int(m.group(2))) if m else None,
            "source": "nvidia-smi"}


@functools.lru_cache(maxsize=1)
def _nvidia_probe() -> dict:
    """Every NVIDIA GPU the driver reports, with no PyTorch involved.

    NVML first (in-process, milliseconds), nvidia-smi as the fallback for an
    install whose pynvml is missing or too old. Cached: the hardware does not
    change inside one process, and preflight, the report and the stats poll all
    ask.
    """
    nvml = _timed(_nvml_query)
    if nvml and nvml["gpus"]:
        if nvml["driver_cuda"] is None:
            smi = _timed(_smi_query, PROBE_TIMEOUT_S * 3)
            if smi:
                nvml["driver_cuda"] = smi["driver_cuda"]
        return nvml
    smi = _timed(_smi_query, PROBE_TIMEOUT_S * 3)
    if smi and smi["gpus"]:
        return smi
    return {"gpus": [], "driver": None, "driver_cuda": None, "source": None}


def nvidia_gpus() -> list[dict]:
    """`[{index, name, compute_capability, vram_bytes, uuid, pci_bus_id}]` in
    NVML (PCI bus) order; empty on a machine with no NVIDIA GPU or driver."""
    return list(_nvidia_probe()["gpus"])


_warming = threading.Lock()
_warm_thread: threading.Thread | None = None


def nvidia_gpus_nowait() -> list[dict] | None:
    """nvidia_gpus() if the probe has already answered, else None - with the
    probe started in the background.

    For the stats endpoint, which the UI polls: the first probe can take up to
    PROBE_TIMEOUT_S per witness on a broken driver, and a polled request must
    never be the one that pays it (each blocked poll also holds one of the
    server's worker threads)."""
    global _warm_thread
    if _nvidia_probe.cache_info().currsize:
        return nvidia_gpus()
    with _warming:
        if _warm_thread is None or not _warm_thread.is_alive():
            _warm_thread = threading.Thread(target=_nvidia_probe, daemon=True, name="gpu-probe-warm")
            _warm_thread.start()
    return None


def driver_cuda_version() -> tuple[int, int] | None:
    """The newest CUDA the installed driver supports, e.g. `(12, 8)`."""
    return _nvidia_probe()["driver_cuda"]


def _best(gpus: list[dict]) -> dict | None:
    """The card to name and advise for: most memory, then newest. On a laptop
    or workstation with two NVIDIA cards that is the one doing the work."""
    if not gpus:
        return None
    return max(gpus, key=lambda g: (g.get("vram_bytes") or 0, g.get("compute_capability") or (0, 0)))


def nvidia_gpu_name() -> str | None:
    best = _best(nvidia_gpus())
    return best["name"] if best else None


def clear_cache() -> None:
    """Forget every cached probe (tests; a driver installed mid-session)."""
    global _DEVICE, _HUNG
    _DEVICE = None
    _HUNG = None
    _nvidia_probe.cache_clear()
    _ct2_info.cache_clear()


# ---------------------------------------------------------------------------
# PyTorch: can it actually run a kernel on this card?
# ---------------------------------------------------------------------------
def _kernel_check(torch, index: int) -> str | None:
    """None if a tiny computation on `cuda:index` gives the right answer, else
    why not.

    The arch list is what the build CLAIMS; this is proof. A driver too old for
    the build, a card in exclusive-process mode held by something else, or a
    broken install all pass the arch check and fail here — at preflight, rather
    than thousands of frames into someone's video.
    """
    try:
        value = (torch.ones(8, device=f"cuda:{index}") * 2).sum().item()
        if value != 16:
            return f"wrong result from the GPU ({value})"
        return None
    except Exception as e:
        first = (str(e).strip().splitlines() or [""])[0][:160]
        return first or type(e).__name__


def _driver_message(name: str, built: tuple[int, int] | None) -> str | None:
    """The driver-too-old verdict when it applies, else None."""
    have = driver_cuda_version()
    if built and have and have < built:
        return (f"{name} found, but its NVIDIA driver supports CUDA up to "
                f"{have[0]}.{have[1]} and this PyTorch build needs CUDA "
                f"{built[0]}.{built[1]} — {_UPDATE_DRIVER}")
    return None


def _verdict(torch) -> tuple[bool, str, int | None]:
    """`(usable, reason, torch device index)` for an imported torch."""
    archs = [a for a in (_parse_arch(a) for a in torch.cuda.get_arch_list()) if a]
    version = getattr(torch, "version", None)

    # ROCm builds answer through torch.cuda too, but their arch list is gfx*
    # names, which would otherwise read as "CPU-only". No table to check them
    # against, so the kernel is the whole test.
    if getattr(version, "hip", None):
        if not torch.cuda.is_available():
            return False, "this is a ROCm (AMD) PyTorch build and it found no usable AMD GPU", None
        name = torch.cuda.get_device_name(0)
        err = _kernel_check(torch, 0)
        return (True, name, 0) if err is None else (
            False, f"{name} failed a test computation on the GPU ({err})", None)

    # No architectures at all means a CPU-only build, which on Windows is what
    # a plain `pip install torch` gives you. Checked BEFORE is_available(),
    # which a CPU-only build always answers False: asking it first reported a
    # real Quadro P3200 as "no CUDA GPU detected". The GPU is named from the
    # driver instead, because torch cannot see it.
    built = _parse_version(getattr(version, "cuda", None))
    # ...except that PyTorch before 2.4 answered get_arch_list() with [] for a
    # CUDA build whenever is_available() was False, so a laptop whose driver
    # is older than the build's CUDA looked exactly like the CPU wheel and was
    # told to reinstall PyTorch. A build that names its CUDA version and cannot
    # start CUDA goes on to that verdict below instead.
    if not archs and not (built and not _available(torch)):
        name = nvidia_gpu_name()
        if not name:
            try:
                name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
            except Exception:
                name = None
        if name:
            return False, f"{name} found, but this is a {_CPU_ONLY}", None
        return False, NO_GPU, None

    if not torch.cuda.is_available():
        name = nvidia_gpu_name()
        if not name:
            return False, NO_GPU, None
        hidden = os.environ.get("CUDA_VISIBLE_DEVICES")
        if hidden is not None and hidden.strip() in ("", "-1", "NoDevFiles"):
            # Common in containers and on shared servers, and otherwise
            # reported as a driver problem on a driver that is fine.
            return False, (f"{name} found, but CUDA_VISIBLE_DEVICES={hidden.strip()!r} hides "
                           f"it from PyTorch — unset it to use the GPU"), None
        return False, _driver_message(name, built) or (
            f"{name} found, but PyTorch could not start CUDA on it — reinstall "
            f"or {_UPDATE_DRIVER}"), None

    try:
        count = int(torch.cuda.device_count())
    except Exception:
        count = 1
    devices = []
    for i in range(max(count, 1)):
        cap = tuple(torch.cuda.get_device_capability(i))
        try:
            memory = int(torch.cuda.get_device_properties(i).total_memory)
        except Exception:
            memory = 0
        devices.append({"index": i, "name": torch.cuda.get_device_name(i), "cap": cap,
                        "memory": memory, "fits": any(_runs_on(a, cap) for a in archs)})

    fitting = [d for d in devices if d["fits"]]
    if not fitting:
        # WHICH SIDE the card falls on decides what the user should do, so the
        # message has to say. Reporting only the ceiling reads as nonsense for
        # an old card — a GTX 1060 owner is told "sm_61, build goes up to
        # sm_120", concludes 61 < 120 so it should work, and reports a bug.
        # The number that excludes them is the FLOOR.
        d = devices[0]
        name, device, here = d["name"], d["cap"], _sm(d["cap"])
        if device < min(archs):
            return False, (
                f"{name} is compute capability {here}, which is older than the "
                f"oldest this PyTorch build supports ({_sm(min(archs))})"
            ), None
        return False, (
            f"{name} is compute capability {here}, and this "
            f"PyTorch build only goes up to {_sm(max(archs))}"
        ), None

    # Best card first (most memory, then newest, then the lower index), and
    # the first that actually computes wins: one dead card in a multi-GPU box
    # should not demote the whole job to CPU.
    fitting.sort(key=lambda d: (-d["memory"], tuple(-c for c in d["cap"]), d["index"]))
    first_error = None
    for d in fitting:
        err = _kernel_check(torch, d["index"])
        if err is None:
            return True, d["name"], d["index"]
        first_error = first_error or (d["name"], err)
    name, err = first_error
    return False, _driver_message(name, built) or (
        f"{name} passed the compatibility check but {_KERNEL_FAILED} "
        f"on the GPU ({err})"), None


def _available(torch) -> bool:
    try:
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def _cuda_verdict(timeout: float | None = None) -> tuple[bool, str, int | None]:
    global _HUNG
    if _HUNG:
        return False, _HUNG, None
    try:
        # Outside the time limit: importing PyTorch is slow (antivirus
        # scanning its DLLs on a first run can take a minute), but it is not a
        # GPU probe and does not hang on a broken driver.
        import torch
    except Exception as e:
        return False, f"PyTorch did not load ({type(e).__name__})", None

    box: dict = {}

    def run():
        try:
            box["verdict"] = _verdict(torch)
        except Exception as e:
            box["error"] = e

    limit = VERDICT_TIMEOUT_S if timeout is None else timeout
    t = threading.Thread(target=run, daemon=True, name="gpu-verdict")
    t.start()
    t.join(limit)
    if t.is_alive():
        _HUNG = (f"the NVIDIA GPU did not respond within {limit:.0f} seconds (a hung "
                 f"driver) — restart the PC, or reinstall or {_UPDATE_DRIVER}")
        return False, _HUNG, None
    if "error" in box:
        # Never let a diagnostic take the caller down: an unreadable GPU is a
        # reason to use the CPU, not a reason to fail.
        return False, f"could not check the GPU ({type(box['error']).__name__})", None
    return box["verdict"]


def cuda_usable() -> tuple[bool, str]:
    """`(usable, reason)` — whether CUDA work will actually run.

    The reason is always worth showing: "no CUDA GPU detected" and "your GPU is
    newer than this build" both mean "running on CPU" but have completely
    different fixes, and conflating them is how someone concludes their new
    graphics card is broken.
    """
    usable, reason, _index = _cuda_verdict()
    return usable, reason


def torch_device() -> str:
    """`"cuda"` (or `"cuda:N"`) or `"cpu"` — the device every model and
    inference call must use.

    Exists because "don't move the model to CUDA" turned out not to be enough.
    Ultralytics rebuilds its predictor on each call with
    `select_device(self.args.device)`, and that default "auto-selects the first
    available GPU" — so a model deliberately left on the CPU was silently put
    back on a GPU this build has no kernels for, and died at the first frame.
    A GTX 1060 owner hit exactly that, at the reactions stage, after preflight
    had already told him he was running on CPU.

    Passing this explicitly at every call site removes the dependency on a
    third-party default that can change under us, which is the real lesson.

    `"cuda:N"` only when the best usable card is not device 0 (a multi-GPU box
    whose first card is the weaker or unsupported one). Every caller hands the
    string to torch's `.to()` / `map_location` or to ultralytics' `device=`,
    which both take a torch index, and it is also made the current device so
    any bare `"cuda"` left in a library lands on the same card.

    Cached: cuda_usable() imports torch and queries the driver, and this is
    called per frame. The answer cannot change inside one process.
    """
    global _DEVICE
    if _DEVICE is None:
        usable, _reason, index = _cuda_verdict()
        if not usable:
            _DEVICE = "cpu"
        elif not index:
            _DEVICE = "cuda"
        else:
            try:
                import torch

                torch.cuda.set_device(index)
            except Exception:
                pass  # the explicit index below is what callers use anyway
            _DEVICE = f"cuda:{index}"
    return _DEVICE


def demote_to_cpu() -> None:
    """Make torch_device() answer "cpu" for the rest of the process.

    For a caller whose own warm-up inference failed on a card that passed
    every check here: without this, the next `predict(device=torch_device())`
    puts the model straight back on the GPU that just failed."""
    global _DEVICE
    _DEVICE = "cpu"


def nvml_index() -> int:
    """The NVML index of the NVIDIA card doing the work, for VRAM/usage stats.

    NVML numbers cards in PCI bus order, CUDA (and so torch) fastest-first,
    and CUDA_VISIBLE_DEVICES renumbers torch on top of that — so torch's
    device 0 is not necessarily NVML's. Matched by UUID, then PCI bus id.

    Only consults torch if it is already loaded and has already picked a
    device: the stats endpoint polls this, and importing torch there would
    stall it for seconds. Otherwise the best card by memory, which is also what
    Whisper and NVENC land on in the single-GPU case that is nearly everyone.
    """
    gpus = nvidia_gpus()
    if not gpus:
        return 0
    if _DEVICE and _DEVICE.startswith("cuda") and "torch" in sys.modules:
        try:
            torch = sys.modules["torch"]
            index = int(_DEVICE.split(":")[1]) if ":" in _DEVICE else 0
            props = torch.cuda.get_device_properties(index)
            uuid = str(getattr(props, "uuid", "") or "").lower()
            bus = getattr(props, "pci_bus_id", None)
            for g in gpus:
                if uuid and uuid in str(g.get("uuid") or "").lower():
                    return g["index"]
            for g in gpus:
                pci = str(g.get("pci_bus_id") or "")
                if bus is not None and re.search(rf":{int(bus):02x}:\d\d\.\d$", pci, re.IGNORECASE):
                    return g["index"]
        except Exception:
            pass  # fall through to the best card
    return _best(gpus)["index"]


# ---------------------------------------------------------------------------
# CTranslate2 (faster-whisper): its own CUDA, its own rules.
# ---------------------------------------------------------------------------
# faster-whisper's fastest type first. float16 needs tensor-core-era hardware
# (compute 7.0+, plus 6.0/6.2); a Pascal consumer/Quadro card (6.1) offers only
# float32/int8/int8_float32 and refuses float16 outright — hard-coding float16
# made Whisper fall back to the CPU on a GPU that could run it.
CUDA_COMPUTE_PREFERENCE = ("float16", "int8_float16", "int8_float32", "int8", "float32")


def cuda_compute_type(supported) -> str | None:
    """The best CTranslate2 compute type out of `supported`, or None."""
    have = set(supported or ())
    return next((t for t in CUDA_COMPUTE_PREFERENCE if t in have), None)


@functools.lru_cache(maxsize=1)
def _ct2_info() -> dict:
    def query():
        import ctranslate2

        count = int(ctranslate2.get_cuda_device_count())
        types = sorted(ctranslate2.get_supported_compute_types("cuda")) if count else []
        return {"version": getattr(ctranslate2, "__version__", "?"), "cuda_devices": count,
                "compute_types": types, "chosen": cuda_compute_type(types)}

    info = _timed(query, PROBE_TIMEOUT_S * 3)
    return info or {"version": None, "cuda_devices": 0, "compute_types": [], "chosen": None}


def whisper_cuda_compute_type() -> str | None:
    """The compute type Whisper should use on CUDA here, or None when
    CTranslate2 sees no CUDA device (no NVIDIA GPU, no driver, a VPS)."""
    return _ct2_info()["chosen"]


# ---------------------------------------------------------------------------
# Which PyTorch to install.
# ---------------------------------------------------------------------------
# Coverage per wheel index: (CUDA version, oldest sm, newest major). Measured
# from the published wheels of the 2.x line, not CUDA's own support matrix:
# cu126 is the last carrying Maxwell/Pascal/Volta (sm_50..sm_90); the CUDA 12.8+
# and 13 wheels start at Turing (sm_75) and add Blackwell (sm_100/sm_120).
TORCH_INDEXES: dict[str, tuple[tuple[int, int], tuple[int, int], int]] = {
    "cu118": ((11, 8), (5, 0), 9),
    "cu126": ((12, 6), (5, 0), 9),
    "cu128": ((12, 8), (7, 5), 12),
    "cu129": ((12, 9), (7, 5), 12),
    "cu130": ((13, 0), (7, 5), 12),
    "cu132": ((13, 2), (7, 5), 12),
}

# What download.pytorch.org actually publishes for torch 2.14.x (checked
# 2026-11 against https://download.pytorch.org/whl/torch/): cu126, cu130 and
# cu132 for both win_amd64 and manylinux x86_64/aarch64 — no cu118 or cu128 on
# this line any more.
PUBLISHED_INDEXES: dict[str, tuple[str, ...]] = {
    "win32": ("cu126", "cu130", "cu132"),
    "linux": ("cu126", "cu130", "cu132"),
}


def recommend_torch_index(compute_capability, driver_cuda, platform: str | None = None,
                          available=None) -> list[str]:
    """Wheel indexes to try for this card, best first; `["cpu"]` if none fit.

    Pure, so the setup script imports it without importing torch. It is a
    shortlist, not a verdict: the table above is our reading of what each
    index ships, and the setup script VERIFIES each candidate (installs it,
    then proves a kernel runs via cuda_usable()) before keeping it, moving on
    to the next candidate if not. That is the point of returning a list.

    Constrained by the driver: a wheel needs a driver of at least its CUDA
    major version (minor-version compatibility covers the rest within a
    major), and indexes the driver fully supports are ranked first, newest
    first. `driver_cuda=None` means unknown and does not constrain.
    """
    plat = (platform or sys.platform).lower()
    if plat.startswith("win"):
        plat = "win32"
    elif plat.startswith("linux"):
        plat = "linux"
    else:
        return ["cpu"]  # macOS has no CUDA; its default wheel already uses MPS
    cap = tuple(compute_capability) if compute_capability else None
    if not cap:
        return ["cpu"]
    names = available if available is not None else PUBLISHED_INDEXES.get(plat, ())

    fits = []
    for name in names:
        if name not in TORCH_INDEXES:
            continue
        cuda, oldest, newest_major = TORCH_INDEXES[name]
        if not (oldest <= cap and cap[0] <= newest_major):
            continue
        if driver_cuda and cuda[0] > tuple(driver_cuda)[0]:
            continue
        full = not driver_cuda or tuple(driver_cuda) >= cuda
        fits.append((not full, tuple(-v for v in cuda), name))
    return [name for *_key, name in sorted(fits)] or ["cpu"]


def _installed(dist: str) -> str | None:
    """The public version of an installed distribution ("2.14.1" for
    "2.14.1+cpu"), read from metadata so torch is never imported for it."""
    try:
        from importlib.metadata import version

        return version(dist).split("+")[0]
    except Exception:
        return None


def torch_install_commands(index: str) -> list[str]:
    """The command that swaps the installed PyTorch for `index`'s build.

    ONE command, pinned with the index's local label (`torch==2.14.1+cu126`):
    an installed 2.14.1+cpu does not satisfy that, so pip replaces it, and if
    the index does not publish that exact version pip stops before touching
    anything. The earlier "uninstall, then install" pair left a venv with no
    PyTorch at all whenever the second step failed - the installed version
    missing from the index (torch 2.15 is not on cu126), or the network
    dropping. Not `--force-reinstall`, which re-resolves every dependency from
    the PyTorch index and can move numpy off the version requirements.txt
    pinned. Pinned to the installed versions so torchvision stays matched to
    torch; scripts/setup_gpu.py does the same with a version it has checked
    the index actually publishes, which is why preflight points there first.
    """
    label = "" if index == "cpu" else f"+{index}"
    pkgs = [n for n in ("torch", "torchvision") if n == "torch" or _installed(n)]
    pinned = " ".join(f"{n}=={_installed(n)}{label}" if _installed(n) else n for n in pkgs)
    return [f"python -m pip install {pinned} --index-url https://download.pytorch.org/whl/{index}"]


def _recommendation(best: dict | None, driver_cuda, torch_usable: bool) -> dict:
    if not best:
        return {"needed": False, "candidates": ["cpu"],
                "why": "No NVIDIA GPU here, so the CPU build of PyTorch is the right one."}
    cap = best.get("compute_capability")
    candidates = recommend_torch_index(cap, driver_cuda)
    rec: dict = {"needed": not torch_usable, "candidates": candidates}
    if candidates == ["cpu"]:
        if cap and driver_cuda and recommend_torch_index(cap, None) != ["cpu"]:
            rec["why"] = (f"{best['name']} needs a newer NVIDIA driver (it supports CUDA "
                          f"{driver_cuda[0]}.{driver_cuda[1]}) before any GPU build of PyTorch "
                          f"can use it — {_UPDATE_DRIVER}.")
        else:
            rec["why"] = f"No published GPU build of PyTorch supports {best['name']}."
        return rec
    first = candidates[0]
    rec["index"] = first
    rec["pip_commands"] = torch_install_commands(first)
    rec["pip"] = ", then ".join(rec["pip_commands"])
    rec["why"] = (f"{best['name']} is {_sm(cap) if cap else 'an NVIDIA GPU'}; "
                  f"PyTorch's {first} wheels include it"
                  + (" and the installed driver supports them." if driver_cuda else "."))
    return rec


# ---------------------------------------------------------------------------
# The whole picture.
# ---------------------------------------------------------------------------
def _torch_report() -> dict:
    out: dict = {"version": None, "cuda_build": None, "archs": [], "arch_range": None,
                 "usable": False, "reason": None, "device": "cpu"}
    try:
        import torch
    except Exception as e:
        out["reason"] = f"PyTorch did not load ({type(e).__name__})"
        return out
    try:
        out["version"] = str(torch.__version__)
        out["cuda_build"] = getattr(torch.version, "cuda", None)
        archs = [a for a in torch.cuda.get_arch_list() if _parse_arch(a)]
        out["archs"] = archs
        if archs:
            parsed = sorted(_parse_arch(a) for a in archs)
            out["arch_range"] = f"{_sm(parsed[0])}..{_sm(parsed[-1])}"
    except Exception:
        pass
    usable, reason, _index = _cuda_verdict()
    out["usable"], out["reason"] = usable, reason
    out["device"] = torch_device()
    return out


def _onnx_report() -> dict:
    def query():
        import onnxruntime

        return {"version": onnxruntime.__version__,
                "providers": list(onnxruntime.get_available_providers())}

    info = _timed(query) or {"version": None, "providers": []}
    info["gpu"] = any(p in info["providers"] for p in
                      ("CUDAExecutionProvider", "TensorrtExecutionProvider",
                       "DmlExecutionProvider", "ROCMExecutionProvider"))
    return info


def _cublas12() -> str | None:
    """Where Whisper's cuBLAS 12 loaded from ("." when the system loader found
    it by name), or None when it is missing — a CUDA device alone does not
    put Whisper on the GPU."""
    try:
        from transcription.transcriber import _cuda12_blas

        found = _cuda12_blas()
        return None if found is None else str(found)
    except Exception:
        return None


def _encoder_report() -> dict:
    try:
        from video.encoding import probe_hardware_encoders

        return probe_hardware_encoders()
    except Exception as e:
        return {"error": f"could not probe ({type(e).__name__})"}


def gpu_report(encoders: bool = True) -> dict:
    """Every GPU consumer's view of this machine, in one JSON-able dict.

    For bug reports, the setup script and preflight: a "GPU not detected"
    report is only diagnosable with the card, the driver, the PyTorch build
    and what Whisper and FFmpeg can use, side by side. `encoders=False` skips
    the FFmpeg test encodes (a few hundred milliseconds each).
    """
    probe = _nvidia_probe()
    gpus = []
    for g in probe["gpus"]:
        cap = g.get("compute_capability")
        gpus.append({
            "index": g["index"], "name": g["name"],
            "compute_capability": f"{cap[0]}.{cap[1]}" if cap else None,
            "vram_gb": round(g["vram_bytes"] / 1024 ** 3, 1) if g.get("vram_bytes") else None,
            "uuid": g.get("uuid"), "pci_bus_id": g.get("pci_bus_id"),
        })
    drv = probe["driver_cuda"]
    torch_info = _torch_report()
    ct2 = _ct2_info()
    # Only looked for when CTranslate2 has a CUDA device: on a GPU-less VPS it
    # is irrelevant, and "missing" there would read as a fault.
    cublas = _cublas12() if ct2.get("cuda_devices") else None
    report = {
        "platform": sys.platform,
        "frozen": bool(getattr(sys, "frozen", False)),
        "nvidia": {"gpus": gpus, "driver": probe["driver"],
                   "driver_max_cuda": f"{drv[0]}.{drv[1]}" if drv else None,
                   "source": probe["source"]},
        "torch": torch_info,
        "ctranslate2": {**ct2, "cublas12": cublas},
        # True/False where it matters, None where it does not (no CUDA device
        # for Whisper). The GPU page reads this instead of guessing per OS.
        "whisper_cublas12": (cublas is not None) if ct2.get("cuda_devices") else None,
        "onnxruntime": _onnx_report(),
        "ffmpeg_encoders": _encoder_report() if encoders else None,
        "recommendation": _recommendation(_best(probe["gpus"]), drv, bool(torch_info["usable"])),
    }
    return report


if __name__ == "__main__":  # python -m core.gpu: print the report
    import json

    print(json.dumps(gpu_report(), indent=2, default=str))
