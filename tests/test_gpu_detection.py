"""GPU detection has to be truthful on any PC or VPS, not just the one it was
written on.

The bug that started this: a Quadro P3200 (Pascal, sm_61) with a working
driver, reported as "no CUDA GPU detected" because the venv held the CPU-only
PyTorch wheel and the check asked torch first. Whisper then also ran on the CPU
because float16 was hard-coded and Pascal only offers int8/float32 types, and
the bundled FFmpeg's NVENC needed a newer driver while `-encoders` still listed
it. Each case below is one machine somebody actually runs this on: a GPU-less
VPS, a datacenter card, a two-GPU workstation, a stale driver, a card that
passes the arch check but cannot compute.

Everything is faked (torch, NVML, nvidia-smi, CTranslate2) so it runs the
same on CI, on Linux and on a machine with no GPU at all.
"""

import sys
import types

import pytest

from core import gpu

_REAL_KERNEL_CHECK = gpu._kernel_check   # before the autouse fixture stubs it
SHIPPED = ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"]


def _hardware(monkeypatch, gpus=(), driver_cuda=None):
    """What the driver (NVML / nvidia-smi) reports, without any torch."""
    full = []
    for i, g in enumerate(gpus):
        full.append({"index": i, "compute_capability": None, "vram_bytes": None,
                     "uuid": None, "pci_bus_id": None, **g})
    monkeypatch.setattr(gpu, "_nvidia_probe", lambda: {
        "gpus": full, "driver": "572.76" if full else None,
        "driver_cuda": driver_cuda, "source": "nvml" if full else None})


class _Props:
    def __init__(self, memory, uuid=""):
        self.total_memory, self.uuid = memory, uuid


class _Cuda:
    """torch.cuda for a list of devices: (name, capability, memory bytes)."""

    def __init__(self, devices=(), archs=SHIPPED, available=None):
        self.devices, self.archs = list(devices), list(archs)
        self.available = bool(self.devices) if available is None else available
        self.current = 0

    def is_available(self):
        return self.available

    def get_arch_list(self):
        return self.archs

    def device_count(self):
        return len(self.devices)

    def get_device_name(self, i=0):
        return self.devices[i][0]

    def get_device_capability(self, i=0):
        return self.devices[i][1]

    def get_device_properties(self, i=0):
        return _Props(self.devices[i][2])

    def set_device(self, i):
        self.current = i


def _torch(cuda, cuda_build="13.0", hip=None):
    return types.SimpleNamespace(
        cuda=cuda, __version__="2.14.1",
        version=types.SimpleNamespace(cuda=cuda_build, hip=hip))


@pytest.fixture
def use_torch(monkeypatch):
    """Install a fake torch for `import torch` inside core.gpu."""
    def install(fake):
        monkeypatch.setitem(sys.modules, "torch", fake)
        monkeypatch.setattr(gpu, "_DEVICE", None)
        return fake
    return install


@pytest.fixture(autouse=True)
def _kernels_run(monkeypatch):
    monkeypatch.setattr(gpu, "_kernel_check", lambda torch, index: None)


# ---- the reported bug: a CPU-only PyTorch on a real NVIDIA card --------------------------


def test_cpu_only_torch_names_the_real_gpu(monkeypatch, use_torch):
    _hardware(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1)}], (12, 8))
    use_torch(_torch(_Cuda(available=False, archs=[]), cuda_build=None))
    usable, reason = gpu.cuda_usable()
    assert usable is False
    assert reason == "Quadro P3200 found, but this is a CPU-only PyTorch build"
    assert reason != gpu.NO_GPU and gpu.cpu_only_build(reason)
    assert gpu.torch_device() == "cpu"


def test_gpu_less_vps_is_no_gpu(monkeypatch, use_torch):
    """CPU wheel, no NVIDIA driver: the one case that IS "no GPU"."""
    _hardware(monkeypatch, [])
    use_torch(_torch(_Cuda(available=False, archs=[]), cuda_build=None))
    assert gpu.cuda_usable() == (False, gpu.NO_GPU)


def test_cuda_torch_on_a_gpu_less_vps_is_no_gpu(monkeypatch, use_torch):
    """Linux PyPI torch is a CUDA build, so a VPS without a GPU has archs but
    no device. Still no GPU — not a driver problem, not a crash."""
    _hardware(monkeypatch, [])
    use_torch(_torch(_Cuda(available=False), cuda_build="13.0"))
    assert gpu.cuda_usable() == (False, gpu.NO_GPU)
    assert gpu.torch_device() == "cpu"


def test_torch_missing_entirely_is_not_a_crash(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)   # import raises ImportError
    usable, reason = gpu.cuda_usable()
    assert usable is False and "PyTorch did not load" in reason


# ---- driver too old ------------------------------------------------------------------


def test_driver_older_than_the_build_says_update_the_driver(monkeypatch, use_torch):
    _hardware(monkeypatch, [{"name": "NVIDIA A10", "compute_capability": (8, 6)}], (12, 4))
    use_torch(_torch(_Cuda(available=False), cuda_build="13.0"))
    usable, reason = gpu.cuda_usable()
    assert usable is False
    assert gpu.driver_too_old(reason)
    assert "12.4" in reason and "13.0" in reason and "NVIDIA A10" in reason
    assert not gpu.gpu_too_old(reason) and not gpu.cpu_only_build(reason)


def test_driver_new_enough_but_cuda_will_not_start(monkeypatch, use_torch):
    _hardware(monkeypatch, [{"name": "Tesla T4", "compute_capability": (7, 5)}], (13, 0))
    use_torch(_torch(_Cuda(available=False), cuda_build="13.0"))
    usable, reason = gpu.cuda_usable()
    assert usable is False and "Tesla T4" in reason and "could not start CUDA" in reason


# ---- proof by kernel -------------------------------------------------------------------


def test_a_card_that_fails_the_test_kernel_is_not_usable(monkeypatch, use_torch):
    _hardware(monkeypatch, [], None)
    monkeypatch.setattr(gpu, "_kernel_check",
                        lambda torch, index: "CUDA error: no kernel image is available")
    use_torch(_torch(_Cuda([("NVIDIA L4", (8, 9), 24 << 30)])))
    usable, reason = gpu.cuda_usable()
    assert usable is False
    assert "failed a test computation" in reason and "no kernel image" in reason
    assert gpu.torch_device() == "cpu"


def test_a_failed_kernel_with_a_stale_driver_blames_the_driver(monkeypatch, use_torch):
    _hardware(monkeypatch, [{"name": "NVIDIA L4"}], (12, 2))
    monkeypatch.setattr(gpu, "_kernel_check", lambda torch, index: "CUDA driver version is insufficient")
    use_torch(_torch(_Cuda([("NVIDIA L4", (8, 9), 24 << 30)]), cuda_build="12.6"))
    assert gpu.driver_too_old(gpu.cuda_usable()[1])


def test_the_real_kernel_check_reports_instead_of_raising():
    class Boom:
        def ones(self, *a, **k):
            raise RuntimeError("CUDA error: an illegal memory access was encountered\nmore")

    assert _REAL_KERNEL_CHECK(Boom(), 0) == "CUDA error: an illegal memory access was encountered"


def test_rocm_build_is_judged_by_its_kernel_not_its_arch_list(monkeypatch, use_torch):
    _hardware(monkeypatch, [])
    cuda = _Cuda([("AMD Radeon RX 7900 XTX", (11, 0), 24 << 30)], archs=["gfx1100"])
    use_torch(_torch(cuda, cuda_build=None, hip="6.2"))
    assert gpu.cuda_usable() == (True, "AMD Radeon RX 7900 XTX")


# ---- several GPUs ------------------------------------------------------------------------


def test_multi_gpu_skips_an_unsupported_first_card(monkeypatch, use_torch):
    _hardware(monkeypatch, [])
    cuda = use_torch(_torch(_Cuda([("GTX 1060", (6, 1), 6 << 30), ("RTX 3060", (8, 6), 12 << 30)]))).cuda
    assert gpu.cuda_usable() == (True, "RTX 3060")
    assert gpu.torch_device() == "cuda:1"
    assert cuda.current == 1, "made current, so a library's bare 'cuda' lands there too"


def test_multi_gpu_prefers_the_card_with_more_memory(monkeypatch, use_torch):
    _hardware(monkeypatch, [])
    use_torch(_torch(_Cuda([("A10", (8, 6), 24 << 30), ("A100", (8, 0), 80 << 30)])))
    assert gpu.torch_device() == "cuda:1"


def test_single_gpu_stays_plain_cuda(monkeypatch, use_torch):
    """Device 0 is "cuda", exactly as before, for every existing caller."""
    _hardware(monkeypatch, [])
    use_torch(_torch(_Cuda([("H100", (9, 0), 80 << 30)])))
    assert gpu.torch_device() == "cuda"


def test_multi_gpu_falls_through_to_a_card_that_computes(monkeypatch, use_torch):
    _hardware(monkeypatch, [])
    monkeypatch.setattr(gpu, "_kernel_check", lambda torch, index: "busy" if index == 1 else None)
    use_torch(_torch(_Cuda([("A10", (8, 6), 24 << 30), ("A100", (8, 0), 80 << 30)])))
    assert gpu.torch_device() == "cuda"


def test_demote_to_cpu_sticks(monkeypatch, use_torch):
    _hardware(monkeypatch, [])
    use_torch(_torch(_Cuda([("T4", (7, 5), 16 << 30)])))
    assert gpu.torch_device() == "cuda"
    gpu.demote_to_cpu()
    assert gpu.torch_device() == "cpu"


# ---- CTranslate2 / Whisper compute types -----------------------------------------------


@pytest.mark.parametrize("supported, chosen", [
    ({"float32", "int8_float32", "int8"}, "int8_float32"),        # Pascal: the P3200
    ({"float32", "int8"}, "int8"),
    ({"float32"}, "float32"),
    ({"float32", "float16", "int8_float16", "int8_float32", "int8", "bfloat16"}, "float16"),  # Ampere
    ({"float32", "float16", "int8_float16", "int8"}, "float16"),   # Turing T4
    (set(), None),
])
def test_compute_type_follows_the_card(supported, chosen):
    assert gpu.cuda_compute_type(supported) == chosen


@pytest.fixture
def whisper(monkeypatch):
    from transcription import transcriber

    made = []

    class WhisperModel:
        def __init__(self, name, device="cpu", compute_type="auto"):
            made.append((device, compute_type))
            self.model = types.SimpleNamespace(device=device)

    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=WhisperModel))
    monkeypatch.setattr(transcriber, "_cuda12_blas", lambda: ".")
    return transcriber, made


def test_pascal_whisper_loads_on_the_gpu_in_int8(whisper, monkeypatch):
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": gpu.cuda_compute_type(
        {"float32", "int8_float32", "int8"})})
    model = transcriber._load_model("auto", "auto")
    assert made == [("cuda", "int8_float32")] and transcriber._on_gpu(model)


def test_ampere_whisper_loads_in_float16(whisper, monkeypatch):
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": "float16"})
    transcriber._load_model("small", "auto")
    assert made == [("cuda", "float16")]


def test_no_cuda_device_whisper_uses_the_cpu_and_says_so(whisper, monkeypatch, capsys):
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": None})
    transcriber._load_model("auto", "auto")
    assert made == [("cpu", "auto")]
    out = capsys.readouterr().out
    assert "no CUDA GPU" in out and "cuBLAS" not in out, "no hardware is not a missing library"


def test_no_cuda_device_but_cuda_demanded_raises(whisper, monkeypatch):
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": None})
    with pytest.raises(RuntimeError, match="no CUDA GPU"):
        transcriber._load_model("small", "cuda")
    assert made == []


def test_cpu_path_is_unchanged(whisper, monkeypatch):
    transcriber, made = whisper
    monkeypatch.setattr(gpu, "_ct2_info", lambda: pytest.fail("the CPU path asks no GPU questions"))
    transcriber._load_model("small", "cpu")
    assert made == [("cpu", "auto")]


# ---- probing the driver without torch --------------------------------------------------


def test_nvml_missing_and_no_nvidia_smi_is_simply_no_gpus(monkeypatch):
    monkeypatch.setitem(sys.modules, "pynvml", None)
    monkeypatch.setattr(gpu, "_smi_exe", lambda: None)
    gpu._nvidia_probe.cache_clear()
    try:
        assert gpu.nvidia_gpus() == [] and gpu.driver_cuda_version() is None
        assert gpu.nvml_index() == 0
    finally:
        gpu._nvidia_probe.cache_clear()


def test_nvml_is_read_without_torch(monkeypatch):
    class Mem:
        total = 6 << 30

    fake = types.SimpleNamespace(
        nvmlInit=lambda: None, nvmlShutdown=lambda: None,
        nvmlSystemGetDriverVersion=lambda: b"572.76",
        nvmlSystemGetCudaDriverVersion_v2=lambda: 12080,
        nvmlDeviceGetCount=lambda: 1,
        nvmlDeviceGetHandleByIndex=lambda i: i,
        nvmlDeviceGetName=lambda h: b"Quadro P3200",
        nvmlDeviceGetCudaComputeCapability=lambda h: (6, 1),
        nvmlDeviceGetMemoryInfo=lambda h: Mem(),
        nvmlDeviceGetUUID=lambda h: "GPU-abc",
        nvmlDeviceGetPciInfo=lambda h: types.SimpleNamespace(busId=b"00000000:01:00.0"),
    )
    monkeypatch.setitem(sys.modules, "pynvml", fake)
    info = gpu._nvml_query()
    assert info["driver_cuda"] == (12, 8) and info["driver"] == "572.76"
    assert info["gpus"] == [{"index": 0, "name": "Quadro P3200", "compute_capability": (6, 1),
                             "vram_bytes": 6 << 30, "uuid": "GPU-abc",
                             "pci_bus_id": "00000000:01:00.0"}]


SMI_CSV = "0, Tesla T4, 7.5, 15360, 550.54.15, 00000000:00:1E.0, GPU-t4\n"
SMI_BANNER = "| NVIDIA-SMI 550.54.15   Driver Version: 550.54.15   CUDA Version: 12.4 |"


def test_nvidia_smi_fallback_parses_a_linux_vps(monkeypatch):
    def smi(args):
        return SMI_CSV if args else SMI_BANNER
    monkeypatch.setattr(gpu, "_smi", smi)
    info = gpu._smi_query()
    assert info["driver_cuda"] == (12, 4) and info["driver"] == "550.54.15"
    g = info["gpus"][0]
    assert g["name"] == "Tesla T4" and g["compute_capability"] == (7, 5)
    assert g["vram_bytes"] == 15360 * 1024 * 1024


def test_old_nvidia_smi_without_compute_cap_still_names_the_card(monkeypatch):
    def smi(args):
        if not args:
            return "CUDA Version: 11.4"
        return None if "compute_cap" in args[0] else "0, Tesla K80, 11441, 470.82, 0000:00:04.0, GPU-k\n"
    monkeypatch.setattr(gpu, "_smi", smi)
    g = gpu._smi_query()["gpus"][0]
    assert g["name"] == "Tesla K80" and g["compute_capability"] is None


def test_nvidia_smi_is_found_off_path_on_linux_and_wsl(monkeypatch):
    monkeypatch.setattr(gpu.shutil, "which", lambda name: None)
    monkeypatch.setattr(gpu.os, "name", "posix")
    monkeypatch.setattr(gpu.os.path, "isfile", lambda p: p == "/usr/lib/wsl/lib/nvidia-smi")
    assert gpu._smi_exe() == "/usr/lib/wsl/lib/nvidia-smi"


def test_a_hung_probe_is_abandoned_not_waited_on():
    import threading

    gate = threading.Event()
    assert gpu._timed(gate.wait, timeout=0.05) is None
    gate.set()


def test_nvml_index_matches_the_torch_card_by_uuid(monkeypatch):
    _hardware(monkeypatch, [{"name": "A", "uuid": "GPU-aaaa", "vram_bytes": 80 << 30},
                            {"name": "B", "uuid": "GPU-bbbb", "vram_bytes": 8 << 30}])
    fake_cuda = types.SimpleNamespace(get_device_properties=lambda i: _Props(0, uuid="bbbb"))
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(cuda=fake_cuda))
    monkeypatch.setattr(gpu, "_DEVICE", "cuda")
    assert gpu.nvml_index() == 1, "torch's device 0 is NVML's 1 here; stats must follow it"


def test_nvml_index_without_torch_is_the_biggest_card(monkeypatch):
    _hardware(monkeypatch, [{"name": "small", "vram_bytes": 4 << 30},
                            {"name": "big", "vram_bytes": 24 << 30}])
    monkeypatch.setattr(gpu, "_DEVICE", None)
    assert gpu.nvml_index() == 1


# ---- which PyTorch to install -----------------------------------------------------------


@pytest.mark.parametrize("cap, driver, plat, expected", [
    ((6, 1), (12, 8), "win32", ["cu126"]),                     # Quadro P3200 / GTX 10-series
    ((6, 1), (13, 0), "linux", ["cu126"]),                     # Pascal never gets CUDA 13
    ((7, 0), (13, 2), "linux", ["cu126"]),                     # V100: Volta stops at cu126
    ((7, 5), (12, 4), "linux", ["cu126"]),                     # T4 on a 12.4 driver
    ((8, 6), (13, 2), "win32", ["cu132", "cu130", "cu126"]),   # RTX 3060, current driver
    ((8, 0), (13, 0), "linux", ["cu130", "cu126", "cu132"]),   # A100: 13.2 only by minor compat
    ((9, 0), None, "linux", ["cu132", "cu130", "cu126"]),      # H100, driver unknown
    ((12, 0), (13, 0), "win32", ["cu130", "cu132"]),           # RTX 50-series
    ((12, 0), (12, 8), "win32", ["cpu"]),                      # needs a driver update first
    ((3, 7), (11, 4), "linux", ["cpu"]),                       # Kepler: nothing ships for it
    (None, None, "linux", ["cpu"]),                            # no NVIDIA GPU
    ((8, 6), (13, 0), "darwin", ["cpu"]),
])
def test_recommend_torch_index(cap, driver, plat, expected):
    assert gpu.recommend_torch_index(cap, driver, plat) == expected


def test_recommend_honours_what_an_index_actually_publishes():
    assert gpu.recommend_torch_index((12, 0), (12, 8), "win32", available=["cu126", "cu128"]) == ["cu128"]
    assert gpu.recommend_torch_index((6, 1), (12, 8), "linux", available=["cu118", "cu126"]) == ["cu126", "cu118"]


def test_install_command_is_one_step_pinned_to_the_local_label(monkeypatch):
    """Deliberately changed from "uninstall, then install": when the second
    step failed (the installed version not on that index, a dropped network)
    the venv was left with no PyTorch at all. One install pinned to
    `+cu126` replaces 2.14.1+cpu, and fails without touching anything when
    the index lacks that exact version."""
    monkeypatch.setattr(gpu, "_installed", lambda d: {"torch": "2.14.1", "torchvision": "0.29.1"}.get(d))
    assert gpu.torch_install_commands("cu126") == [
        "python -m pip install torch==2.14.1+cu126 torchvision==0.29.1+cu126 "
        "--index-url https://download.pytorch.org/whl/cu126",
    ]
    assert gpu.torch_install_commands("cpu") == [
        "python -m pip install torch==2.14.1 torchvision==0.29.1 "
        "--index-url https://download.pytorch.org/whl/cpu",
    ]


# ---- the whole report ---------------------------------------------------------------------


def test_report_survives_a_machine_with_nothing(monkeypatch):
    _hardware(monkeypatch, [])
    for mod in ("torch", "ctranslate2", "onnxruntime"):
        monkeypatch.setitem(sys.modules, mod, None)
    monkeypatch.setattr(gpu, "_DEVICE", None)
    gpu._ct2_info.cache_clear()
    try:
        report = gpu.gpu_report(encoders=False)
    finally:
        gpu._ct2_info.cache_clear()
    assert report["nvidia"]["gpus"] == []
    assert report["torch"]["usable"] is False and report["torch"]["device"] == "cpu"
    assert report["ctranslate2"]["chosen"] is None
    assert report["onnxruntime"]["gpu"] is False
    assert report["recommendation"] == {"needed": False, "candidates": ["cpu"],
                                        "why": "No NVIDIA GPU here, so the CPU build of PyTorch is the right one."}


def test_report_for_the_reported_machine(monkeypatch, use_torch):
    _hardware(monkeypatch, [{"name": "Quadro P3200", "compute_capability": (6, 1),
                             "vram_bytes": 6 << 30}], (12, 8))
    use_torch(_torch(_Cuda(available=False, archs=[]), cuda_build=None))
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": "int8_float32"})
    rec = gpu.gpu_report(encoders=False)["recommendation"]
    assert rec["needed"] is True and rec["candidates"] == ["cu126"]
    assert "whl/cu126" in rec["pip"]


# ---- preflight wording per case -----------------------------------------------------------


@pytest.mark.parametrize("reason, words", [
    (gpu.NO_GPU, "works without a GPU"),
    ("Quadro P3200 found, but this is a CPU-only PyTorch build", "no GPU support"),
    ("NVIDIA A10 found, but its NVIDIA driver supports CUDA up to 12.4 and this PyTorch "
     "build needs CUDA 13.0 — update the NVIDIA driver", "driver is updated"),
    ("GTX 1060 is compute capability sm_61, which is older than the oldest this PyTorch "
     "build supports (sm_75)", "CPU"),
    ("RTX 5070 Ti is compute capability sm_120, and this PyTorch build only goes up to sm_90", "CPU"),
])
def test_preflight_advice_per_case(monkeypatch, reason, words):
    from core import preflight

    _hardware(monkeypatch, [])   # no install hint: the wording a packaged copy shows
    monkeypatch.setattr(gpu, "cuda_usable", lambda: (False, reason))
    monkeypatch.setattr(preflight, "_gpu_side_channels", lambda: [])
    check = preflight.check_gpu()
    assert check.ok is False and check.blocking is False
    assert words in check.fix


def test_preflight_says_what_still_uses_the_gpu(monkeypatch):
    from core import preflight

    monkeypatch.setattr(gpu, "cuda_usable",
                        lambda: (False, "Quadro P3200 found, but this is a CPU-only PyTorch build"))
    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": "int8_float32"})
    from transcription import transcriber
    monkeypatch.setattr(transcriber, "_cuda12_blas", lambda: ".")
    import video.encoding as enc
    monkeypatch.setattr(enc, "probe_hardware_encoders", lambda: {"nvenc": {
        "ok": False, "error": "Driver does not support the required nvenc API version. "
                              "Required: 13.1 Found: 13.0; The minimum required Nvidia "
                              "driver for nvenc is 610.00 or newer"}})
    detail = preflight.check_gpu().detail
    assert "transcription still runs on the GPU (int8_float32)" in detail
    assert "NVENC video encoding needs NVIDIA driver 610.00 or newer" in detail


def test_preflight_does_not_promise_gpu_whisper_without_cublas(monkeypatch):
    """The Quadro P3200 machine: CTranslate2 saw the card, but cuBLAS 12 was
    not installed, so Whisper ran on the CPU anyway. Saying "still runs on the
    GPU" there would be untrue."""
    from core import preflight
    from transcription import transcriber

    monkeypatch.setattr(gpu, "_ct2_info", lambda: {"chosen": "int8_float32"})
    monkeypatch.setattr(transcriber, "_cuda12_blas", lambda: None)
    import video.encoding as enc
    monkeypatch.setattr(enc, "probe_hardware_encoders", lambda: {})
    notes = preflight._gpu_side_channels()
    assert notes == ["transcription could use the GPU but cuBLAS 12 (cublas64_12.dll) is missing"]


def test_preflight_says_nothing_extra_without_a_gpu(monkeypatch):
    from core import preflight

    monkeypatch.setattr(gpu, "cuda_usable", lambda: (False, gpu.NO_GPU))
    monkeypatch.setattr(preflight, "_gpu_side_channels", lambda: pytest.fail("not asked"))
    assert preflight.check_gpu().detail == f"{gpu.NO_GPU} — running on CPU"


# ---- FFmpeg encoder probe --------------------------------------------------------------


def test_encoder_probe_reports_the_encoders_own_reason():
    from video.encoding import _probe_error

    stderr = (
        "[h264_nvenc @ 000001] Driver does not support the required nvenc API version. Required: 13.1 Found: 13.0\n"
        "[h264_nvenc @ 000001] The minimum required Nvidia driver for nvenc is 610.00 or newer\n"
        "[vost#0:0/h264_nvenc @ 0002] Error while opening encoder\n"
        "[out#0/null @ 0003] Nothing was written into output file, because at least one of its streams received no packets.\n"
    )
    why = _probe_error(stderr, ["-c:v", "h264_nvenc"], 1)
    assert why.startswith("Driver does not support the required nvenc API version")
    assert "610.00" in why and "Nothing was written" not in why


def test_failed_nvenc_falls_back_with_a_reason(monkeypatch, capsys):
    import video.encoding as enc

    monkeypatch.setattr(enc, "_probe_detail", lambda args: (
        (False, "OpenEncodeSessionEx failed: out of memory (10)") if "h264_nvenc" in args
        else (False, "no device") if "h264_amf" in args or "h264_qsv" in args else (True, "")))
    monkeypatch.setattr(enc, "_has_nvidia", lambda: True)
    assert enc._select("auto")[0] == "cpu"
    assert "OpenEncodeSessionEx" in capsys.readouterr().out
