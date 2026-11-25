"""GPU status and PyTorch setup routes, mounted on the engine's app by create_app.

    GET  /system/gpu          every GPU layer's view of this machine (core.gpu.gpu_report),
                              plus "layers" for the UI and "setup" (can the install run here)
    POST /system/gpu/setup    {"mode": "auto" | "cpu" | "index", "index": "cu126", "dry_run": false}
                              start scripts/setup_gpu.py --json; session header; one at a time
    GET  /system/gpu/setup    {running, progress, lines, result, restart_required}

Its own module, the same way the publishers and plugins are, so it stays out
of server/api.py's stats code.

The install never runs inside the engine. The engine has torch loaded, and on
Windows a loaded DLL cannot be deleted, so the script is a child process that
only moves the old files aside; the engine keeps running the old build until
Solaris Studio restarts, which is why a finished install reports
`restart_required` rather than pretending the GPU is live.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "setup_gpu.py"
_MAX_LINES = 400


class GpuSetupIn(BaseModel):
    mode: str = "auto"  # auto | cpu | index | dry_run (= auto with dry_run)
    index: str | None = None  # with mode "index": cu126, cu130, ...
    dry_run: bool = False


def _frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def setup_available() -> tuple[bool, str | None]:
    """Whether this engine can run the setup script, and why not."""
    if _frozen():
        return False, ("The installed app carries its own PyTorch, fixed when it was built, so it can't "
                       "be swapped from here. Running Solaris Studio from source lets you pick the build "
                       "for this PC with scripts/setup_gpu.py.")
    if not SCRIPT.is_file():
        return False, f"{SCRIPT} is missing from this copy of Solaris Studio."
    return True, None


def layers(report: dict) -> list[dict]:
    """One row per thing that can use the GPU, in the words the card shows.

    `status` is "gpu" (on the GPU), "cpu" (works, on the CPU) or "off" (not
    available at all — only Stats can be). Every row has a reason: "on the
    CPU" alone is how someone concludes their graphics card is broken.
    """
    rows = []
    nvidia = report.get("nvidia") or {}
    gpus = nvidia.get("gpus") or []

    torch = report.get("torch") or {}
    if torch.get("usable"):
        rows.append({"id": "torch", "label": "PyTorch", "status": "gpu",
                     "reason": f"Running on {torch.get('reason')}"
                               + (f" (build covers {torch['arch_range']})" if torch.get("arch_range") else "")})
    else:
        rows.append({"id": "torch", "label": "PyTorch", "status": "cpu",
                     "reason": torch.get("reason") or "PyTorch is not installed"})

    ct2 = report.get("ctranslate2") or {}
    if ct2.get("cuda_devices") and ct2.get("chosen") and report.get("whisper_cublas12") is False:
        # CTranslate2 lists the GPU's compute types without loading cuBLAS, so
        # "it sees the GPU" is not "it can transcribe on it": on Windows the
        # model load then fails for want of cublas64_12.dll and Whisper drops
        # to the CPU (transcription/transcriber.py, issue #111).
        # The cure differs by OS: on Windows the cu126 PyTorch wheel carries the
        # DLL, while on Linux the default PyTorch brings cuBLAS 13 and the CUDA 12
        # library comes from NVIDIA's own pip wheel (transcriber._NO_CUBLAS12_POSIX).
        reason = ("CTranslate2 can use this GPU, but NVIDIA's cuBLAS 12 (cublas64_12.dll) "
                  "isn't on this PC; a CUDA 12 build of PyTorch (cu126) carries it") if os.name == "nt" else (
                  "CTranslate2 can use this GPU, but NVIDIA's cuBLAS 12 (libcublas.so.12) isn't on this "
                  "machine; install it with: pip install \"nvidia-cublas-cu12>=12.4,<13\"")
        rows.append({"id": "whisper", "label": "Whisper", "status": "cpu", "reason": reason})
    elif ct2.get("cuda_devices") and ct2.get("chosen"):
        rows.append({"id": "whisper", "label": "Whisper", "status": "gpu",
                     "reason": f"Transcribes on the GPU in {ct2['chosen']}"})
    elif ct2.get("version") is None:
        rows.append({"id": "whisper", "label": "Whisper", "status": "cpu",
                     "reason": "faster-whisper's engine (CTranslate2) did not load"})
    else:
        rows.append({"id": "whisper", "label": "Whisper", "status": "cpu",
                     "reason": "CTranslate2 sees no CUDA GPU" if not ct2.get("cuda_devices")
                     else "CTranslate2 offers no compute type for this GPU"})

    enc = report.get("ffmpeg_encoders")
    names = {"nvenc": "NVIDIA NVENC", "amf": "AMD AMF", "qsv": "Intel Quick Sync"}
    if isinstance(enc, dict) and not enc.get("error"):
        working = [k for k in ("nvenc", "amf", "qsv") if (enc.get(k) or {}).get("ok")]
        if working:
            rows.append({"id": "encoding", "label": "Encoding", "status": "gpu",
                         "reason": f"Hardware encoding with {names[working[0]]}"})
        else:
            nv = (enc.get("nvenc") or {}).get("error")
            rows.append({"id": "encoding", "label": "Encoding", "status": "cpu",
                         "reason": (f"NVENC failed its test encode: {nv}" if gpus and nv
                                    else "No hardware encoder passed a test encode; x264 on the CPU")})
    else:
        rows.append({"id": "encoding", "label": "Encoding", "status": "cpu",
                     "reason": "Hardware encoders were not checked"})

    if gpus:
        rows.append({"id": "stats", "label": "Stats", "status": "gpu",
                     "reason": f"Reading {gpus[0]['name']} through {nvidia.get('source') or 'the driver'}"})
    else:
        rows.append({"id": "stats", "label": "Stats", "status": "off",
                     "reason": "No NVIDIA GPU reported by the driver"})
    return rows


def whisper_cublas12() -> bool | None:
    """Whether cuBLAS 12 is where Whisper looks for it, without loading it.
    None off Windows, where the system loader finds it as usual."""
    if os.name != "nt":
        return None
    try:
        from transcription.transcriber import _CUBLAS12, _cublas12_dirs

        return any(all((d / name).is_file() for name in _CUBLAS12) for d in _cublas12_dirs())
    except Exception:
        return None


def script_args(body: GpuSetupIn) -> list[str]:
    mode = (body.mode or "auto").strip().lower()
    dry = body.dry_run or mode in ("dry_run", "dry-run")
    if mode in ("dry_run", "dry-run"):
        mode = "auto"
    if mode not in ("auto", "cpu", "index"):
        raise HTTPException(400, "mode must be auto, cpu or index")
    args = ["--json"]
    if mode == "cpu":
        args.append("--cpu")
    elif mode == "index":
        import re

        index = (body.index or "").strip().lower()
        if not re.fullmatch(r"cpu|cu\d{3}", index):
            raise HTTPException(400, "index must look like cu126, cu130 or cpu")
        args += ["--index", index]
    if dry:
        args.append("--dry-run")
    return args


class SetupRun:
    """The one setup process this engine may have, and what it has said."""

    def __init__(self):
        self.lock = threading.Lock()
        self.proc: subprocess.Popen | None = None
        self.lines: list[dict] = []
        self.result: dict | None = None
        self.args: list[str] = []
        self.started: float | None = None
        self.finished: float | None = None
        self.exit_code: int | None = None
        # Survives later dry runs: once a real install changed PyTorch, the
        # running engine is on the old build until it restarts.
        self.restart_required = False

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, args: list[str], python: str | None = None) -> None:
        with self.lock:
            if self.running():
                raise HTTPException(409, "GPU setup is already running.")
            env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1"}
            cmd = [python or sys.executable, str(SCRIPT), *args]
            try:
                proc = subprocess.Popen(cmd, cwd=str(ROOT), env=env, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, text=True,
                                        encoding="utf-8", errors="replace",
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except OSError as e:
                raise HTTPException(500, f"Could not start GPU setup: {e}") from e
            self.proc, self.args, self.lines, self.result = proc, list(args), [], None
            self.started, self.finished, self.exit_code = time.time(), None, None
        threading.Thread(target=self._read, args=(proc,), name="gpu-setup", daemon=True).start()

    def _read(self, proc: subprocess.Popen) -> None:
        import json

        for raw in proc.stdout:
            raw = raw.strip()
            if not raw:
                continue
            try:
                line = json.loads(raw)
                if not isinstance(line, dict):
                    raise ValueError
            except ValueError:
                # A traceback or a stray print: kept, so a failure is never silent.
                line = {"stage": "log", "msg": raw}
            with self.lock:
                self.lines.append(line)
                del self.lines[:-_MAX_LINES]
                if isinstance(line.get("result"), dict):
                    self.result = line["result"]
        code = proc.wait()
        with self.lock:
            self.exit_code, self.finished = code, time.time()
            if self.result is None:
                tail = " | ".join(str(l.get("msg")) for l in self.lines[-3:])
                self.result = {"ok": False, "message": f"GPU setup stopped unexpectedly (exit {code}). {tail}"}
            if self.result.get("changed"):
                self.restart_required = True

    def status(self) -> dict:
        with self.lock:
            progress = next((l for l in reversed(self.lines) if "pct" in l), None)
            return {
                "running": self.running(),
                "args": self.args,
                "dry_run": "--dry-run" in self.args,
                "started_at": self.started,
                "finished_at": self.finished,
                "exit_code": self.exit_code,
                "pct": progress.get("pct") if progress else 0,
                "stage": progress.get("stage") if progress else None,
                "message": progress.get("msg") if progress else None,
                "lines": list(self.lines),
                "result": self.result,
                "restart_required": self.restart_required,
            }


def install(app: FastAPI, *, data_dir: Path, report=None, runner: SetupRun | None = None,
            busy=None) -> SetupRun:
    """Mount the routes. `report` and `runner` are for tests.

    `busy` returns why a real install must wait (a job is running), or None.
    pip replacing site-packages/torch under a running job lets that job's next
    lazy torch import load half of the new build and crash mid-render, so a
    real install is refused while one runs; a dry run touches nothing and is
    always allowed."""
    from plugins import session

    run = runner or SetupRun()

    def require_session(x_solaris_studio_session: str | None = Header(default=None)) -> None:
        # The same secret the plugin routes ask for, read from the file
        # plugins/api.py wrote for this run of the engine. Calling
        # session.secret_for() here instead would mint a second secret and
        # lock the desktop app out of the plugin routes.
        try:
            expected = session.path(data_dir).read_text(encoding="utf-8").strip()
        except OSError:
            expected = ""
        if not expected or not session.matches(expected, x_solaris_studio_session):
            raise HTTPException(403, f"This needs the {session.HEADER} header. The desktop app sends it; a "
                                     f"script finds it in {session.path(data_dir)}.")

    def get_report() -> dict:
        if report is not None:
            return report()
        from core.gpu import gpu_report

        return gpu_report()

    @app.get("/system/gpu")
    def system_gpu():
        out = dict(get_report())
        if "whisper_cublas12" not in out:
            out["whisper_cublas12"] = whisper_cublas12() if report is None else None
        available, why = setup_available()
        rec = out.get("recommendation") or {}
        out["layers"] = layers(out)
        out["setup"] = {
            "available": available,
            "unavailable_reason": why,
            "frozen": _frozen(),
            # Offer the install only when it would change something: a GPU
            # this build can't use, and a GPU build that can.
            "offer": bool(available and rec.get("needed") and rec.get("candidates")
                          and rec.get("candidates") != ["cpu"]),
            "running": run.running(),
            "restart_required": run.restart_required,
            "command": f'"{sys.executable}" "{SCRIPT}"' if available else None,
        }
        return out

    @app.post("/system/gpu/setup", dependencies=[Depends(require_session)])
    def start_gpu_setup(body: GpuSetupIn):
        available, why = setup_available()
        if not available:
            raise HTTPException(409, why)
        args = script_args(body)
        if busy is not None and "--dry-run" not in args:
            try:
                reason = busy()
            except Exception:
                reason = None   # a failed check must not lock the install out for good
            if reason:
                raise HTTPException(409, reason)
        run.start(args)
        return run.status()

    @app.get("/system/gpu/setup")
    def gpu_setup_status():
        return run.status()

    return run
