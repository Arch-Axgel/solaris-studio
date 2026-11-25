"""Is this install actually able to make a clip?

An installed copy has more ways to be half-ready than a dev checkout: FFmpeg
might not have shipped, the AI runtime might not have started, the model might
not be pulled, the transcription weights might be absent, the disk might be
full. Each of those used to surface as a stack trace somewhere deep in a
pipeline stage, twenty minutes into a video.

This checks them up front and says which one is wrong in words a creator can
act on. The setup wizard runs it on first launch; the app can run it any time
something looks broken.

Nothing here raises — a check that itself fails is reported as a failed check.
"""

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from core.binaries import bundled_whisper_sizes, ffmpeg, ffprobe, has_bundled_ollama

# Below this a single long video can fill the disk part-way through rendering.
MIN_FREE_GB = 20

# Where local AI cannot run, the recommended cloud path, on the user's own key.
_CLOUD_HINT = "Or, if this PC can't run AI, use your own OpenRouter key in Settings → AI."


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    fix: str = ""          # what the user should do; empty when ok
    blocking: bool = True  # False = degraded but still usable


@dataclass
class Preflight:
    checks: list[Check] = field(default_factory=list)

    @property
    def ready(self) -> bool:
        """True when nothing BLOCKING is wrong. Degraded checks (no GPU, low
        disk) don't stop a creator from making a clip."""
        return all(c.ok or not c.blocking for c in self.checks)

    def as_dict(self) -> dict:
        return {
            "ready": self.ready,
            "checks": [
                {"name": c.name, "ok": c.ok, "detail": c.detail,
                 "fix": c.fix, "blocking": c.blocking}
                for c in self.checks
            ],
        }


def _binary_version(path: str, label: str) -> str:
    """First line of `<binary> -version`, or "" if it won't run."""
    try:
        out = subprocess.run([path, "-version"], capture_output=True, text=True,
                             timeout=30, encoding="utf-8", errors="replace")
        first = (out.stdout or "").splitlines()
        return first[0].replace(f"{label} version ", "") if first else ""
    except Exception:
        return ""


def check_ffmpeg() -> list[Check]:
    checks = []
    for label, path in (("ffmpeg", ffmpeg()), ("ffprobe", ffprobe())):
        # A bare name means nothing resolved it — not bundled, not on PATH.
        resolved = path != label or shutil.which(label) is not None
        version = _binary_version(path, label) if resolved else ""
        checks.append(Check(
            name=label,
            ok=bool(version),
            detail=version or "not found",
            fix="" if version else
                "This should ship with Solaris Studio. Reinstall the app, or "
                "install FFmpeg and put it on your PATH.",
        ))
    return checks


def check_ollama(host: str, model: str) -> list[Check]:
    """Ollama serves the LLM.

    Installed copies ship their own and Electron starts it, so this failing is
    a bug rather than an errand. A checkout borrows whatever Ollama the
    developer runs, where it means the familiar thing — so the advice given
    depends on which of the two this is.
    """
    import requests

    try:
        r = requests.get(f"{host.rstrip('/')}/api/tags", timeout=5)
        r.raise_for_status()
        installed = [m.get("name", "") for m in (r.json().get("models") or [])]
    except Exception as e:
        return [Check(
            name="ollama",
            ok=False,
            detail=f"not reachable at {host} ({type(e).__name__})",
            fix="The AI runtime that ships with Solaris Studio did not start. "
                "Restarting the app usually fixes it. If it keeps happening, "
                f"please report it — this one is not your fault. {_CLOUD_HINT}"
                if has_bundled_ollama() else
                "Install Ollama from https://ollama.com and let it run in the "
                "background. Solaris Studio uses it for the AI that picks and "
                f"titles clips. {_CLOUD_HINT}",
        )]

    checks = [Check(name="ollama", ok=True,
                    detail=f"running, {len(installed)} model(s) installed")]

    # Ask whether a model can be used, NOT whether one particular model is
    # present. Demanding the configured tag failed Store certification: setup
    # downloads the model it recommends for your hardware, which on a machine
    # with no graphics card is not the one settings.yaml ships with, so a
    # reviewer watched gemma3:4b reach 100% and still be told gemma:7b was
    # missing. "The recommended model is absent" and "there is no AI at all"
    # are completely different situations and only the second is a failure.
    from llm.manager import model_is_installed, resolve_usable_model

    usable = (
        model.split("/")[-1]
        if model and model_is_installed(model, installed)
        else resolve_usable_model(host, model)
    )
    checks.append(Check(
        name="model",
        ok=bool(usable),
        detail=f"{usable} installed" if usable else "no AI model installed",
        # No `ollama pull` hint for an installed copy: the bundled runtime has
        # its own port and its own model folder, so a command typed into a
        # terminal would download into a store this app never reads.
        fix="" if usable else
            f"Download a model from the Models page. {_CLOUD_HINT}" if has_bundled_ollama() else
            f"Download one from the Models page, or run: ollama pull gemma3:4b. {_CLOUD_HINT}",
    ))
    return checks


def check_cloud_ai(provider: str, model: str, data_dir) -> Check:
    """A cloud model on the user's own key: is one chosen, and is the key saved?

    No network call. Whether the key still works is what Test connection in
    Settings → AI answers; a check that ran on every page load would spend the
    user's rate limit to repeat it.
    """
    from llm.providers.catalog import get
    from llm.providers.keys import has_key
    from llm.signin import catalog as signin

    if signin.is_signin(provider):
        # A plan signed in to instead of a key: asks only what it already knows.
        plan = signin.get(provider, data_dir)
        if plan is None or not plan.available():
            return Check(name="ai", ok=False, detail="ChatGPT plan: not installed in this version",
                         fix="Choose another AI in Settings → AI.")
        if not model:
            return Check(name="ai", ok=False, detail=f"{plan.label}: no model chosen",
                         fix=f"Choose a {plan.label} model in Settings → AI.")
        if not plan.status().get("signed_in"):
            return Check(name="ai", ok=False, detail=f"{plan.label}: not signed in",
                         fix="Sign in with ChatGPT in Settings → AI.")
        return Check(name="ai", ok=True, detail=f"{plan.label} · {model} (signed in)")

    spec = get(provider)
    if spec is None:
        return Check(name="ai", ok=False, detail=f"unknown AI provider '{provider}'",
                     fix="Choose an AI model in Settings → AI.")
    if not model:
        return Check(name="ai", ok=False, detail=f"{spec.label}: no model chosen",
                     fix=f"Choose a {spec.label} model in Settings → AI.")
    if not has_key(data_dir, provider):
        return Check(name="ai", ok=False, detail=f"{spec.label}: no API key saved",
                     fix=f"Add your own {spec.key_label} in Settings → AI.")
    return Check(name="ai", ok=True, detail=f"{spec.label} · {model} (your API key)")


def check_cloud_transcription(provider: str, data_dir) -> Check:
    """Online transcription on the user's own key: is the key saved?"""
    from llm.providers.catalog import get
    from llm.providers.keys import has_key

    spec = get(provider)
    if spec is None or not spec.stt:
        return Check(name="transcription", ok=False, detail=f"'{provider}' can't transcribe",
                     fix="Choose where transcription runs in Settings → AI.")
    if not has_key(data_dir, provider):
        return Check(name="transcription", ok=False, detail=f"{spec.label}: no API key saved",
                     fix=f"Add your own {spec.key_label} in Settings → AI.")
    return Check(name="transcription", ok=True, detail=f"online with {spec.label} (your API key)")


def check_whisper(configured: str) -> Check:
    """Transcription weights.

    Not blocking, because faster-whisper can still fetch them from Hugging
    Face and produce a correct transcript. But that fetch happens with no
    progress and no explanation, several minutes into a job, and looks exactly
    like a hang — so it is worth saying up front that it is going to happen.
    """
    have = bundled_whisper_sizes()
    if not have:
        return Check(
            name="whisper",
            ok=False,
            blocking=False,
            detail="no transcription weights bundled",
            fix="The first video will pause to download them (1-2 GB). That "
                "is a one-off, and it works — it just looks like nothing is "
                "happening while it runs.",
        )

    # "auto" resolves at load time by device, so both sizes have to be there
    # for it to be satisfied whichever machine this turns out to be.
    wanted = ("large-v3-turbo", "small") if configured == "auto" else (configured,)
    absent = [size for size in wanted if size not in have]
    return Check(
        name="whisper",
        ok=not absent,
        blocking=False,
        detail=f"{', '.join(have)} bundled",
        fix="" if not absent else
            f"{' and '.join(absent)} will be downloaded on first use, which "
            f"pauses that video for a few minutes.",
    )


def _gpu_side_channels() -> list[str]:
    """What can still use the NVIDIA card when PyTorch cannot.

    Whisper (CTranslate2) and NVENC carry their own CUDA and do not care which
    PyTorch is installed — on a Quadro P3200 with a CPU-only PyTorch both
    still ran on the GPU. Saying so stops "GPU: not used" reading as "the GPU
    does nothing", which would be untrue and sends people hunting."""
    notes = []
    try:
        from core.gpu import whisper_cuda_compute_type

        compute = whisper_cuda_compute_type()
        if compute:
            from transcription.transcriber import _cuda12_blas

            # A CUDA device is half of it; CTranslate2 also loads cuBLAS 12 by
            # name at its first GPU run. Claiming the GPU without it would be
            # the same false promise this check exists to stop making.
            if _cuda12_blas() is not None:
                notes.append(f"transcription still runs on the GPU ({compute})")
            else:
                import os

                # Named the way this OS names it, so a Linux user is not sent
                # looking for a .dll.
                lib = "cublas64_12.dll" if os.name == "nt" else "libcublas.so.12"
                notes.append(f"transcription could use the GPU but cuBLAS 12 ({lib}) is missing")
    except Exception:
        pass
    try:
        from video.encoding import probe_hardware_encoders

        nvenc = probe_hardware_encoders().get("nvenc", {})
        if nvenc.get("ok"):
            notes.append("video encoding still uses NVENC")
        elif "driver" in str(nvenc.get("error", "")).lower():
            # The bundled FFmpeg's NVENC wants a minimum driver, and the
            # encoder says which; a Quadro P3200 on driver 572 fell to Intel
            # QSV for exactly this, with h264_nvenc listed as present.
            import re

            m = re.search(r"driver for nvenc is ([\d.]+)", str(nvenc["error"]), re.IGNORECASE)
            notes.append(f"NVENC video encoding needs NVIDIA driver {m.group(1)} or newer"
                         if m else "NVENC video encoding needs a newer NVIDIA driver")
    except Exception:
        pass
    return notes


def _recommendation() -> dict:
    """core.gpu's advice for the best NVIDIA card here, or {} if unknown."""
    try:
        from core.gpu import _best, _recommendation as rec, driver_cuda_version, nvidia_gpus

        return rec(_best(nvidia_gpus()), driver_cuda_version(), False)
    except Exception:
        return {}


def _torch_install_hint() -> str:
    """The exact install that fixes a CPU-only or wrong-CUDA PyTorch, for a
    copy run from source. The packaged app carries its own PyTorch, so there
    the answer is a different build of the app, not a pip command.

    scripts/setup_gpu.py first: it checks the index really publishes the
    version it installs, downloads with progress, proves the build runs a
    kernel on this card and restores the CPU build if no GPU build does. The bare pip
    command is the fallback for a copy without the script. When no GPU build
    fits until the driver is updated (an RTX 50-series on a CUDA 12.8 driver),
    that is the hint, rather than the packaged app's "nothing to do"."""
    import sys

    if getattr(sys, "frozen", False):
        return ""
    rec = _recommendation()
    if rec.get("pip"):
        script = Path(__file__).resolve().parent.parent / "scripts" / "setup_gpu.py"
        if script.is_file():
            return (f' Install GPU support: "{sys.executable}" "{script}" (it picks the right '
                    f"PyTorch for this card — {rec.get('index') or 'a CUDA build'} here — proves it "
                    f"runs before keeping it, and goes back to the CPU build if none does; "
                    f"`python -m core.gpu` shows the full report).")
        return (f" Install GPU support: {rec['pip']} (the right build for this "
                f"card; `python -m core.gpu` shows the full report).")
    if rec.get("needed") and "driver" in str(rec.get("why", "")).lower():
        return f" {rec['why']}"
    return ""


def check_gpu() -> Check:
    """Not blocking: the app works on CPU, just slowly. Worth saying so
    plainly rather than letting someone conclude it's broken."""
    from core.gpu import (NO_GPU, cpu_only_build, cuda_usable, driver_too_old, gpu_too_old,
                          kernel_failed)

    usable, reason = cuda_usable()

    if usable:
        try:
            import torch

            from core.gpu import torch_device

            index = int(torch_device().partition(":")[2] or 0)
            vram = torch.cuda.get_device_properties(index).total_memory / 1e9
            return Check(name="gpu", ok=True, detail=f"{reason} ({vram:.0f} GB)",
                         blocking=False)
        except Exception:
            # The GPU works; only the size lookup failed. Not worth a warning.
            return Check(name="gpu", ok=True, detail=reason, blocking=False)

    # A GPU that is present but unusable used to be reported here as ok=True,
    # so someone with a card newer than the bundled PyTorch was told their GPU
    # was fine right up until the job crashed on it. It is still not blocking —
    # CPU genuinely works — but it is not "fine", and the cases share no
    # remedy at all.
    if reason == NO_GPU:
        fix = ("Solaris Studio works without a GPU, but processing is much "
               "slower. An NVIDIA GPU gives the biggest speed-up.")
    elif cpu_only_build(reason):
        # The card and driver are fine; the PyTorch wheel was built without
        # CUDA (a plain `pip install torch` on Windows). Before this branch it
        # was reported as "no CUDA GPU detected" — hardware advice for an
        # install problem.
        fix = ("AI processing runs on the CPU, which works but is slower: the "
               "installed PyTorch has no GPU support." + (_torch_install_hint() or
               " This copy needs a Solaris Studio build with GPU support."))
    elif driver_too_old(reason):
        fix = ("AI processing runs on the CPU until the NVIDIA driver is updated. "
               "Install the latest driver for this card from nvidia.com (or your "
               "distribution's driver package on Linux), then restart Solaris Studio.")
        # A laptop whose maker ships the drivers can be stuck on an old one.
        # Run from source, a PyTorch built for an older CUDA is the other way
        # out, so say so when one fits the installed driver - but only when
        # that build is older than the installed one: the same build again
        # changes nothing (a 12.4 driver with cu126 is fixed by the driver
        # alone), and a hung driver is not a version problem.
        import re

        from core.gpu import TORCH_INDEXES

        needs = re.search(r"build needs CUDA (\d+)\.(\d+)", reason)
        index = _recommendation().get("index")
        hint = _torch_install_hint()   # "" in the packaged app: nothing to swap there
        if (needs and index in TORCH_INDEXES and hint.startswith(" Install GPU support")
                and TORCH_INDEXES[index][0] < (int(needs.group(1)), int(needs.group(2)))):
            fix += (" If the driver can't be updated, a PyTorch build for this driver "
                    "also works." + hint)
    elif "CUDA_VISIBLE_DEVICES" in reason:
        fix = ("Processing will run on the CPU. The CUDA_VISIBLE_DEVICES setting "
               "in this environment hides the graphics card; remove it (or list the "
               "card's number in it) and restart Solaris Studio.")
    elif kernel_failed(reason):
        # The build supports the card and CUDA started, but a computation
        # failed: a driver fault, a card in exclusive mode held by another
        # program, a dying card. Reinstalling the same PyTorch fixes none of
        # them, and "wait for a newer build" would be false.
        fix = ("Processing will run on the CPU, which works but is slower. The "
               "graphics card is supported but failed a test computation: restart "
               "the PC, close other programs using the GPU, and update the NVIDIA "
               "driver if it keeps happening.")
    elif gpu_too_old(reason):
        # Told to wait for a newer build, a GTX 10-series owner would be
        # waiting for the release that removes their card: the CUDA that adds
        # Blackwell is the same one that dropped Maxwell, Pascal and Volta.
        # Saying "permanent" is kinder than an upgrade that never arrives.
        hint = _torch_install_hint()
        if hint:
            # ...for the packaged build. Run from source, the older wheel that
            # still carries the card is one install away, and "permanent"
            # would be false.
            fix = ("Processing will run on the CPU, which works but is slower. "
                   "This PyTorch build dropped this graphics card, but an older "
                   "one still supports it." + hint)
        else:
            fix = ("Processing will run on the CPU, which works but is slower. "
                   "This is permanent for this graphics card — the CUDA versions "
                   "that support newer cards dropped support for this one, so a "
                   "future release will not change it.")
    else:
        hint = _torch_install_hint()
        if hint:
            fix = ("Processing will run on the CPU, which works but is slower. "
                   "The installed PyTorch cannot run on this graphics card." + hint)
        else:
            fix = ("Processing will run on the CPU, which works but is slower. "
                   "Nothing to do on your end: this needs a Solaris Studio build "
                   "made against a newer CUDA, which a future release will carry.")

    detail = f"{reason} — running on CPU"
    if reason != NO_GPU:
        side = _gpu_side_channels()
        if side:
            detail += f" ({'; '.join(side)})"
    return Check(name="gpu", ok=False, blocking=False, detail=detail, fix=fix)


def check_disk(data_dir: Path) -> Check:
    try:
        target = data_dir if data_dir.exists() else data_dir.parent
        free_gb = shutil.disk_usage(target).free / 1e9
        ok = free_gb >= MIN_FREE_GB
        return Check(
            name="disk",
            ok=ok,
            blocking=False,
            detail=f"{free_gb:.0f} GB free",
            fix="" if ok else
                f"Under {MIN_FREE_GB} GB free. Source videos and clips are "
                f"large — clear space, or use Storage cleanup in Settings.",
        )
    except Exception as e:
        return Check(name="disk", ok=False, blocking=False,
                     detail=f"could not check ({type(e).__name__})")


def run(config: dict) -> Preflight:
    """Every check, in the order a creator would care about them."""
    pf = Preflight()
    pf.checks += check_ffmpeg()

    llm = config.get("llm") or {}
    host = llm.get("ollama_host") or "http://localhost:11434"
    from llm.spec import parse_spec

    provider, cloud_model = parse_spec(llm.get("backend") or config.get("model") or "")
    if provider == "ollama":
        # `llm.backend` is what the pipeline actually loads (llm/registry.py), and
        # load_config derives it from the flat `model:` key. Reading that key here
        # instead was a second source of truth, and defaulting it to a hard-coded
        # gemma:7b made the check demand a model nobody had chosen.
        model = (llm.get("backend") or config.get("model") or "").split("/")[-1]
        pf.checks += check_ollama(host, model)
    else:
        # A cloud model on the user's own key needs neither Ollama nor a
        # download, so neither is checked: only that the key and model are set.
        data_dir = llm.get("data_dir") or config.get("paths", {}).get("data_dir", "data")
        pf.checks.append(check_cloud_ai(provider, cloud_model, data_dir))

    online = config.get("transcription") or {}
    if str(online.get("backend") or "local") == "local":
        whisper = (config.get("whisper") or {}).get("model") or "auto"
        pf.checks.append(check_whisper(str(whisper)))
    else:
        data_dir = llm.get("data_dir") or config.get("paths", {}).get("data_dir", "data")
        pf.checks.append(check_cloud_transcription(str(online.get("backend")), data_dir))

    pf.checks.append(check_gpu())
    pf.checks.append(check_disk(Path(config.get("paths", {}).get("data_dir", "data"))))
    return pf
