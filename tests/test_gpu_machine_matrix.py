"""One test group per machine this app is really run on, end to end.

test_gpu_detection.py proves each verdict; this file walks a whole machine
through every consumer at once — PyTorch's verdict and device, Whisper's
compute type and cuBLAS, the encoder pick, the stats poll, the preflight
advice and the install recommendation — because the bugs that reached users
were never one wrong function. They were two consumers disagreeing (PyTorch
said "no GPU" while Whisper and NVENC could use it), or advice that was right
for one machine shown on another (a packaged-app message on a source copy, a
.dll named on Linux, "nothing to do" for a driver that needed updating).

    (a) this PC: Quadro P3200 (Pascal) + Intel iGPU, CPU-only PyTorch
    (b) the same PC after installing the cu126 build
    (c) Linux VPS, no GPU, no nvidia-smi, CUDA PyTorch from PyPI
    (d) Linux VPS with a Tesla T4 and a current driver
    (e) RTX 5090 with the cu126 build (card too new)
    (f) GTX 960 (Maxwell)
    (g) laptop whose NVIDIA driver is older than PyTorch's CUDA
    (h) AMD-only Windows desktop
    (i) two NVIDIA GPUs of different generations
    (j) the packaged (frozen) app
    plus a hung driver, which must cost seconds once and never hang again.

Everything is faked, so it runs the same on CI, Linux and GPU-less machines.
"""

import sys
import threading
import time
import types
from pathlib import Path

import pytest

from core import gpu

CU126 = ["sm_50", "sm_60", "sm_61", "sm_70", "sm_75", "sm_80", "sm_86", "sm_90"]
CU130 = ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"]
PASCAL_TYPES = {"float32", "int8", "int8_float32"}
TURING_TYPES = {"float32", "float16", "int8", "int8_float16", "int8_float32"}


# ---- fakes ------------------------------------------------------------------------------


def _driver(monkeypatch, gpus=(), driver_cuda=None):
    """What NVML / nvidia-smi report, with no torch involved."""
    full = [{"index": i, "compute_capability": None, "vram_bytes": None, "uuid": None,
             "pci_bus_id": None, **g} for i, g in enumerate(gpus)]
    monkeypatch.setattr(gpu, "_nvidia_probe", lambda: {
        "gpus": full, "driver": "570.00" if full else None,
        "driver_cuda": driver_cuda, "source": "nvml" if full else None})
    return full


class _Cuda:
    def __init__(self, devices=(), archs=CU130, available=None, arch_list_needs_driver=False):
        self.devices, self.archs = list(devices), list(archs)
        self.available = bool(self.devices) if available is None else available
        # PyTorch before 2.4 returned [] from get_arch_list() whenever CUDA
        # could not start, even on a CUDA build.
        self.arch_list_needs_driver = arch_list_needs_driver

    def is_available(self):
        return self.available

    def get_arch_list(self):
        return [] if self.arch_list_needs_driver and not self.available else self.archs

    def device_count(self):
        return len(self.devices)

    def get_device_name(self, i=0):
        return self.devices[i][0]

    def get_device_capability(self, i=0):
        return self.devices[i][1]

    def get_device_properties(self, i=0):
        return types.SimpleNamespace(total_memory=self.devices[i][2], uuid="")

    def set_device(self, i):
        pass


@pytest.fixture
def machine(monkeypatch):
    """Install a fake torch; returns a function (cuda, cuda_build) -> None."""
    monkeypatch.setattr(gpu, "_DEVICE", None)
    monkeypatch.setattr(gpu, "_HUNG", None)
    monkeypatch.setattr(gpu, "_kernel_check", lambda torch, index: None)
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    monkeypatch.delattr(sys, "frozen", raising=False)

    def install(cuda, cuda_build):
        monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(
            cuda=cuda, __version__="2.14.1",
            version=types.SimpleNamespace(cuda=cuda_build, hip=None)))
    return install


def _preflight(monkeypatch, side_channels=()):
    from core import preflight

    monkeypatch.setattr(preflight, "_gpu_side_channels", lambda: list(side_channels))
    return preflight.check_gpu()


@pytest.fixture
def whisper(monkeypatch):
    from transcription import transcriber

    made = []

    class WhisperModel:
        def __init__(self, name, device="cpu", compute_type="auto"):
            made.append((device, compute_type))
            self.model = types.SimpleNamespace(device=device)

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=WhisperModel))
    return transcriber, made


# ---- (a) this PC: Pascal Quadro, CPU-only PyTorch ---------------------------------------


def test_a_pascal_with_cpu_torch(monkeypatch, machine, whisper):
    _driver(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1),
                           "vram_bytes": 6 << 30}], (12, 8))
    machine(_Cuda(available=False, archs=[]), None)

    usable, reason = gpu.cuda_usable()
    assert (usable, reason) == (False, "Quadro P3200 found, but this is a CPU-only PyTorch build")
    assert gpu.torch_device() == "cpu"

    # Whisper uses the card on its own, in a type Pascal actually has.
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": gpu.cuda_compute_type(PASCAL_TYPES)})
    monkeypatch.setattr(transcriber, "_cuda12_blas", lambda: Path("."))
    transcriber._load_model("small", "auto")
    assert made == [("cuda", "int8_float32")]

    # The advice is the setup script, for the one index that has sm_61.
    rec = gpu._recommendation(gpu._best(gpu.nvidia_gpus()), (12, 8), False)
    assert rec["needed"] and rec["candidates"] == ["cu126"] and rec["index"] == "cu126"
    assert "torch==2.14.1+cu126" in rec["pip"] or "torch==" not in rec["pip"]
    fix = _preflight(monkeypatch).fix
    assert "no GPU support" in fix and "setup_gpu.py" in fix and "cu126" in fix


def test_a_without_the_setup_script_the_pip_command_is_exact(monkeypatch, machine, tmp_path):
    from core import preflight

    _driver(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1)}], (12, 8))
    machine(_Cuda(available=False, archs=[]), None)
    monkeypatch.setattr(preflight, "__file__", str(tmp_path / "core" / "preflight.py"))
    monkeypatch.setattr(gpu, "_installed", lambda d: {"torch": "2.14.1", "torchvision": "0.29.1"}.get(d))
    fix = _preflight(monkeypatch).fix
    assert "torch==2.14.1+cu126 torchvision==0.29.1+cu126" in fix
    assert "uninstall" not in fix, "a failed second step must not leave the venv without PyTorch"


# ---- (b) the same PC after installing cu126 --------------------------------------------


def test_b_pascal_after_installing_cu126(monkeypatch, machine, whisper):
    _driver(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1),
                           "vram_bytes": 6 << 30}], (12, 8))
    machine(_Cuda([("Quadro P3200", (6, 1), 6 << 30)], archs=CU126), "12.6")

    assert gpu.cuda_usable() == (True, "Quadro P3200")
    assert gpu.torch_device() == "cuda"
    check = _preflight(monkeypatch)
    assert check.ok and check.detail.startswith("Quadro P3200")

    rec = gpu._recommendation(gpu._best(gpu.nvidia_gpus()), (12, 8), True)
    assert rec["needed"] is False, "nothing left to install: the GPU page must not offer it again"


# ---- (c) Linux VPS, no GPU at all ------------------------------------------------------


def test_c_gpu_less_vps(monkeypatch, machine, whisper, capsys):
    monkeypatch.setitem(sys.modules, "pynvml", None)
    monkeypatch.setattr(gpu, "_smi_exe", lambda: None)
    gpu._nvidia_probe.cache_clear()
    try:
        assert gpu.nvidia_gpus() == []
    finally:
        gpu._nvidia_probe.cache_clear()
    _driver(monkeypatch, [])
    # Linux PyPI torch is a CUDA build: it names its CUDA but finds no device.
    machine(_Cuda(available=False), "13.0")

    assert gpu.cuda_usable() == (False, gpu.NO_GPU)
    assert gpu.torch_device() == "cpu"
    check = _preflight(monkeypatch, side_channels=["must not be asked"])
    assert "works without a GPU" in check.fix and "must not be asked" not in check.detail

    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": None, "cuda_devices": 0})
    transcriber._load_model("auto", "auto")
    assert made == [("cpu", "auto")]
    assert "cuBLAS" not in capsys.readouterr().out

    rec = gpu._recommendation(None, None, False)
    assert rec["needed"] is False


def test_c_stats_poll_never_touches_nvml_without_an_nvidia_card(monkeypatch):
    from server import api

    class Exploding(types.ModuleType):
        def __getattr__(self, name):
            raise AssertionError("NVML loaded on a machine with no NVIDIA card")

    monkeypatch.setitem(sys.modules, "pynvml", Exploding("pynvml"))
    monkeypatch.setattr(gpu, "nvidia_gpus_nowait", lambda: [])
    monkeypatch.setattr(api, "_nvml_hung", False)
    assert api._gpu_stats() is None
    _driver(monkeypatch, [])
    assert api._nvidia_vram_gb() is None


# ---- (d) Linux VPS with a T4 -----------------------------------------------------------


def test_d_t4_on_a_current_driver(monkeypatch, machine, whisper):
    _driver(monkeypatch, [{"name": "Tesla T4", "compute_capability": (7, 5),
                           "vram_bytes": 15 << 30}], (13, 0))
    machine(_Cuda([("Tesla T4", (7, 5), 15 << 30)]), "13.0")

    assert gpu.cuda_usable() == (True, "Tesla T4")
    assert gpu.torch_device() == "cuda"
    assert gpu.cuda_compute_type(TURING_TYPES) == "float16"
    assert gpu._recommendation(gpu._best(gpu.nvidia_gpus()), (13, 0), True)["needed"] is False


def test_d_linux_cublas12_is_preloaded_from_the_pip_wheel(tmp_path):
    """The default Linux PyTorch now brings cuBLAS 13, so Whisper's cuBLAS 12
    comes from nvidia-cublas-cu12, whose folder is not on the loader's path."""
    from transcription import transcriber

    wheel = tmp_path / "nvidia" / "cublas" / "lib"
    wheel.mkdir(parents=True)
    for name in transcriber._CUBLAS12_SO:
        (wheel / name).write_bytes(b"")
    loaded = []
    assert transcriber._cuda12_blas_posix([tmp_path / "empty", wheel], loaded.append) == wheel
    assert loaded == [str(wheel / "libcublasLt.so.12"), str(wheel / "libcublas.so.12")]


def test_d_linux_without_cublas12_says_so_in_linux_terms(tmp_path, monkeypatch):
    from core import preflight
    from transcription import transcriber

    def refuse(path):
        raise OSError(f"{path}: cannot open shared object file")

    assert transcriber._cuda12_blas_posix([tmp_path], refuse) is None
    assert "libcublas.so.12" in transcriber._NO_CUBLAS12_POSIX
    assert "nvidia-cublas-cu12" in transcriber._NO_CUBLAS12_POSIX

    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": "float16"})
    monkeypatch.setattr(transcriber, "_cuda12_blas", lambda: None)
    import video.encoding as enc
    monkeypatch.setattr(enc, "probe_hardware_encoders", lambda: {})
    import os
    lib = "cublas64_12.dll" if os.name == "nt" else "libcublas.so.12"
    assert preflight._gpu_side_channels() == [
        f"transcription could use the GPU but cuBLAS 12 ({lib}) is missing"]


def test_d_linux_cublas12_found_by_the_loader_itself():
    from transcription import transcriber

    loaded = []
    assert transcriber._cuda12_blas_posix([], loaded.append) == Path(".")
    assert loaded == list(transcriber._CUBLAS12_SO)


# ---- (e) RTX 5090 with the cu126 build -------------------------------------------------


def test_e_blackwell_on_cu126_points_at_cu130(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "NVIDIA GeForce RTX 5090", "compute_capability": (12, 0),
                           "vram_bytes": 32 << 30}], (13, 0))
    machine(_Cuda([("NVIDIA GeForce RTX 5090", (12, 0), 32 << 30)], archs=CU126), "12.6")

    usable, reason = gpu.cuda_usable()
    assert not usable and "sm_120" in reason and "sm_90" in reason and not gpu.gpu_too_old(reason)
    assert gpu.torch_device() == "cpu"
    fix = _preflight(monkeypatch).fix
    assert "setup_gpu.py" in fix and "cu130" in fix


def test_e_blackwell_on_a_cuda_12_8_driver_is_told_to_update_it(monkeypatch, machine):
    """No published GPU build fits until the driver reaches CUDA 13. From
    source that is the advice, not the packaged app's "nothing to do"."""
    _driver(monkeypatch, [{"name": "NVIDIA GeForce RTX 5090", "compute_capability": (12, 0)}], (12, 8))
    machine(_Cuda([("NVIDIA GeForce RTX 5090", (12, 0), 32 << 30)], archs=CU126), "12.6")
    fix = _preflight(monkeypatch).fix
    assert "newer NVIDIA driver" in fix and "Nothing to do on your end" not in fix


# ---- (f) GTX 960 (Maxwell) -------------------------------------------------------------


def test_f_maxwell_on_cu130_is_offered_cu126(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "GeForce GTX 960", "compute_capability": (5, 2),
                           "vram_bytes": 2 << 30}], (12, 8))
    machine(_Cuda([("GeForce GTX 960", (5, 2), 2 << 30)], archs=CU130), "13.0")

    usable, reason = gpu.cuda_usable()
    assert not usable and gpu.gpu_too_old(reason) and "sm_52" in reason
    fix = _preflight(monkeypatch).fix
    assert "older one still supports it" in fix and "cu126" in fix and "permanent" not in fix


def test_f_maxwell_on_cu126_runs(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "GeForce GTX 960", "compute_capability": (5, 2)}], (12, 8))
    machine(_Cuda([("GeForce GTX 960", (5, 2), 2 << 30)], archs=CU126), "12.6")
    assert gpu.cuda_usable() == (True, "GeForce GTX 960")   # sm_50 code runs on 5.2


# ---- (g) laptop driver older than PyTorch's CUDA ---------------------------------------


@pytest.mark.parametrize("old_torch", [False, True], ids=["torch-2.14", "torch-before-2.4"])
def test_g_stale_laptop_driver(monkeypatch, machine, old_torch):
    _driver(monkeypatch, [{"name": "NVIDIA GeForce RTX 3060 Laptop GPU",
                           "compute_capability": (8, 6)}], (12, 4))
    machine(_Cuda([("NVIDIA GeForce RTX 3060 Laptop GPU", (8, 6), 6 << 30)], available=False,
                  arch_list_needs_driver=old_torch), "13.0")

    usable, reason = gpu.cuda_usable()
    assert not usable and gpu.driver_too_old(reason), reason
    assert not gpu.cpu_only_build(reason), "an old torch's empty arch list is not the CPU wheel"
    assert "12.4" in reason and "13.0" in reason
    fix = _preflight(monkeypatch).fix
    assert "driver is updated" in fix
    # The way out when the laptop maker's driver can't be updated.
    assert "a PyTorch build for this driver also works" in fix and "cu126" in fix


def test_g_same_major_driver_gets_no_pointless_reinstall(monkeypatch, machine):
    """A 12.4 driver under a cu126 build: the recommended build IS cu126, so
    offering to install it again would change nothing."""
    _driver(monkeypatch, [{"name": "NVIDIA T600 Laptop GPU", "compute_capability": (7, 5)}], (12, 4))
    machine(_Cuda([("NVIDIA T600 Laptop GPU", (7, 5), 4 << 30)], archs=CU126, available=False), "12.6")
    fix = _preflight(monkeypatch).fix
    assert "driver is updated" in fix and "also works" not in fix


# ---- (h) AMD-only Windows desktop ------------------------------------------------------


def test_h_amd_only_desktop(monkeypatch, machine, whisper, capsys):
    import video.encoding as enc

    _driver(monkeypatch, [])
    machine(_Cuda(available=False, archs=[]), None)
    assert gpu.cuda_usable() == (False, gpu.NO_GPU)
    assert gpu._recommendation(None, None, False)["needed"] is False

    monkeypatch.setattr(enc, "_probe_detail", lambda args: (
        (True, "") if "h264_amf" in args else (False, "No NVENC capable devices found")))
    assert enc._select("auto")[0] == "amf"
    assert "NVENC" not in capsys.readouterr().out, "NVENC failing on an AMD PC is noise"

    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": None})
    transcriber._load_model("small", "auto")
    assert made == [("cpu", "auto")]


# ---- (i) two NVIDIA GPUs of different generations --------------------------------------


def test_i_mixed_generations_on_cu130_uses_the_card_it_supports(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "GeForce GTX 1080", "compute_capability": (6, 1), "vram_bytes": 8 << 30},
                          {"name": "GeForce RTX 3060", "compute_capability": (8, 6), "vram_bytes": 12 << 30}],
            (13, 0))
    machine(_Cuda([("GeForce GTX 1080", (6, 1), 8 << 30), ("GeForce RTX 3060", (8, 6), 12 << 30)]), "13.0")
    assert gpu.cuda_usable() == (True, "GeForce RTX 3060")
    assert gpu.torch_device() == "cuda:1"


def test_i_both_supported_prefers_the_bigger_card(monkeypatch, machine):
    _driver(monkeypatch, [])
    machine(_Cuda([("GeForce GTX 1080", (6, 1), 8 << 30), ("GeForce RTX 3060", (8, 6), 12 << 30)],
                  archs=CU126), "12.6")
    assert gpu.torch_device() == "cuda:1"


def test_i_stats_follow_the_bigger_card_before_torch_loads(monkeypatch):
    _driver(monkeypatch, [{"name": "GeForce GTX 1080", "vram_bytes": 8 << 30},
                          {"name": "GeForce RTX 3060", "vram_bytes": 12 << 30}])
    monkeypatch.setattr(gpu, "_DEVICE", None)
    from server import api

    assert gpu.nvml_index() == 1
    assert round(api._nvidia_vram_gb()) == 13   # 12 GiB in GB, from the cached probe


# ---- (j) the packaged app --------------------------------------------------------------


def test_j_frozen_app_never_offers_pip(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1)}], (12, 8))
    machine(_Cuda(available=False, archs=[]), None)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    fix = _preflight(monkeypatch).fix
    assert "Solaris Studio build with GPU support" in fix
    assert "pip" not in fix and "setup_gpu" not in fix


def test_j_frozen_stale_driver_has_no_dangling_alternative(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "NVIDIA A10", "compute_capability": (8, 6)}], (12, 4))
    machine(_Cuda([("NVIDIA A10", (8, 6), 24 << 30)], available=False), "13.0")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    fix = _preflight(monkeypatch).fix
    assert "driver is updated" in fix and "also works" not in fix


# ---- the hung driver -------------------------------------------------------------------


def test_a_hung_cuda_init_costs_one_timeout_then_answers_at_once(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "Tesla T4", "compute_capability": (7, 5)}], (13, 0))
    machine(_Cuda([("Tesla T4", (7, 5), 15 << 30)]), "13.0")
    release = threading.Event()
    monkeypatch.setattr(gpu, "_verdict", lambda torch: release.wait(10) or (True, "Tesla T4", 0))
    try:
        started = time.monotonic()
        usable, reason, _ = gpu._cuda_verdict(timeout=0.2)
        assert not usable and "did not respond" in reason and gpu.driver_too_old(reason)
        # Every later caller (the tracker, the report, preflight again) is
        # answered from memory instead of hanging on the same lock.
        assert gpu.cuda_usable() == (False, reason)
        assert gpu.torch_device() == "cpu"
        assert time.monotonic() - started < 3
    finally:
        release.set()


def test_a_hung_nvml_stops_being_polled(monkeypatch):
    from server import api

    calls = []
    release = threading.Event()
    fake = types.ModuleType("pynvml")
    fake.nvmlInit = lambda: (calls.append(1), release.wait(10))
    fake.nvmlShutdown = lambda: None
    monkeypatch.setitem(sys.modules, "pynvml", fake)
    monkeypatch.setattr(gpu, "nvidia_gpus_nowait", lambda: [{"index": 0, "name": "x"}])
    monkeypatch.setattr(api, "_nvml_hung", False)
    monkeypatch.setattr(api, "_NVML_STATS_TIMEOUT_S", 0.2)
    try:
        assert api._gpu_stats() is None
        assert api._gpu_stats() is None
        assert calls == [1], "a hung NVML must not get a fresh thread on every poll"
    finally:
        release.set()


def test_the_first_stats_poll_does_not_wait_for_the_probe(monkeypatch):
    import functools

    release = threading.Event()

    @functools.lru_cache(maxsize=1)
    def slow_probe():
        release.wait(10)
        return {"gpus": [{"index": 0, "name": "Tesla T4"}], "driver": None,
                "driver_cuda": None, "source": "nvml"}

    monkeypatch.setattr(gpu, "_nvidia_probe", slow_probe)
    monkeypatch.setattr(gpu, "_warm_thread", None)
    started = time.monotonic()
    assert gpu.nvidia_gpus_nowait() is None
    assert time.monotonic() - started < 1
    release.set()
    gpu._warm_thread.join(5)
    assert gpu.nvidia_gpus_nowait() == [{"index": 0, "name": "Tesla T4"}]


def test_cuda_visible_devices_hiding_the_card_is_named(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "NVIDIA L4", "compute_capability": (8, 9)}], (13, 0))
    machine(_Cuda([("NVIDIA L4", (8, 9), 24 << 30)], available=False), "13.0")
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "")
    usable, reason = gpu.cuda_usable()
    assert not usable and "CUDA_VISIBLE_DEVICES" in reason and not gpu.driver_too_old(reason)
    assert "CUDA_VISIBLE_DEVICES" in _preflight(monkeypatch).fix


def test_a_kernel_failure_is_not_told_to_wait_for_a_release(monkeypatch, machine):
    _driver(monkeypatch, [{"name": "NVIDIA A10", "compute_capability": (8, 6)}], (13, 0))
    machine(_Cuda([("NVIDIA A10", (8, 6), 24 << 30)]), "13.0")
    monkeypatch.setattr(gpu, "_kernel_check", lambda torch, index: "CUDA error: unspecified launch failure")
    usable, reason = gpu.cuda_usable()
    assert not usable and gpu.kernel_failed(reason)
    fix = _preflight(monkeypatch).fix
    assert "failed a test computation" in fix and "future release" not in fix


# ---- the bug report --------------------------------------------------------------------


def test_feedback_sends_no_home_folder_and_asks_no_dead_gpu(monkeypatch, machine):
    from server import feedback

    machine(_Cuda([("Quadro P3200", (6, 1), 6 << 30)], archs=CU126), "12.6")
    monkeypatch.setattr(gpu, "cuda_usable", lambda: (False, "Quadro P3200 found, but x"))
    sys.modules["torch"].cuda.get_device_capability = lambda i=0: pytest.fail("asked a GPU torch can't use")
    monkeypatch.setattr(gpu, "gpu_report", lambda encoders=True: {
        "platform": "win32",
        "torch": {"cuda_build": "12.6"},
        "nvidia": {"gpus": [{"name": "Quadro P3200", "uuid": "GPU-1", "pci_bus_id": "0:1:0"}]},
        "ctranslate2": {"chosen": "int8_float32", "cublas12": r"C:\Users\someone\venv\torch\lib"},
        "recommendation": {"needed": False}})
    out = feedback._cuda()
    assert out["whisper"]["cublas12"] is True
    assert "someone" not in repr(out) and "GPU-1" not in repr(out)
