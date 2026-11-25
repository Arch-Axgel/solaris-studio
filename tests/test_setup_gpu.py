"""scripts/setup_gpu.py and server/gpu_routes.py: the right PyTorch for the card.

Everything here is offline. nvidia-smi, download.pytorch.org, pip and the
verification process are all replaced, so these tests prove the PLANNING:
which index each card generation gets, which wheel files that means for this
Python and platform, and that the script refuses, reports and falls back the
way the desktop app relies on. Whether a planned build really runs on a card
is what the script's own verification step is for.
"""

import importlib.util
import io
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def sg():
    spec = importlib.util.spec_from_file_location("setup_gpu_under_test", ROOT / "scripts" / "setup_gpu.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fake_smi(sg, monkeypatch, rows, cuda="12.8"):
    """nvidia-smi as the driver would answer. rows: [(name, cap, driver)];
    None means there is no nvidia-smi at all (a VPS without a GPU)."""
    def run(args):
        if rows is None:
            return None
        if not args:
            return f"| NVIDIA-SMI 572.76   Driver Version: 572.76   CUDA Version: {cuda}     |\n"
        return "".join(f"{n}, {c}, {d}\n" for n, c, d in rows)
    monkeypatch.setattr(sg, "run_smi", run)


# ---- which index for which card ---------------------------------------------

CARDS = {
    # name: (rows, driver CUDA, platform, must be first, must not appear)
    "pascal": ([("Quadro P3200", "6.1", "572.76")], "12.8", "win32", "cu126", {"cu130", "cu132"}),
    "pascal-linux": ([("Tesla P100-PCIE-16GB", "6.0", "550.54")], "12.4", "linux", "cu126", {"cu130"}),
    "turing-t4": ([("Tesla T4", "7.5", "580.65")], "13.0", "linux", "cu130", set()),
    "ampere-old-driver": ([("NVIDIA A10", "8.6", "535.104")], "12.2", "linux", "cu126", {"cu130", "cu132"}),
    "hopper": ([("NVIDIA H100 80GB HBM3", "9.0", "590.1")], "13.2", "linux", "cu132", set()),
    "blackwell": ([("NVIDIA GeForce RTX 5070 Ti", "12.0", "591.0")], "13.2", "win32", "cu132", {"cu126"}),
}


@pytest.mark.parametrize("card", sorted(CARDS))
def test_each_generation_gets_an_index_that_covers_it(sg, monkeypatch, card):
    rows, cuda, plat, first, never = CARDS[card]
    fake_smi(sg, monkeypatch, rows, cuda)
    candidates, why = sg.candidate_indexes(sg.detect_gpus(), plat)
    assert candidates[0] == first, (card, candidates)
    assert not never & set(candidates), (card, candidates)
    assert rows[0][0] in why


def test_turing_can_fall_back_to_the_other_cuda_line(sg, monkeypatch):
    """T4 to H100 are inside both cu126 and cu130: if the first does not pass
    verification, the second is still worth a try."""
    fake_smi(sg, monkeypatch, [("Tesla T4", "7.5", "580.65")], "13.0")
    candidates, _ = sg.candidate_indexes(sg.detect_gpus(), "linux")
    assert {"cu130", "cu126"} <= set(candidates)


def test_blackwell_on_an_old_driver_is_told_to_update_the_driver(sg, monkeypatch):
    fake_smi(sg, monkeypatch, [("NVIDIA GeForce RTX 5090", "12.0", "572.76")], "12.8")
    candidates, why = sg.candidate_indexes(sg.detect_gpus(), "win32")
    assert candidates == ["cpu"]
    assert "Update the NVIDIA driver" in why


def test_a_card_no_build_supports_is_told_so(sg, monkeypatch):
    fake_smi(sg, monkeypatch, [("Tesla K80", "3.7", "470.82")], "11.4")
    candidates, why = sg.candidate_indexes(sg.detect_gpus(), "linux")
    assert candidates == ["cpu"]
    assert "sm_37" in why and "no published PyTorch GPU build" in why


def test_no_gpu_means_cpu(sg, monkeypatch):
    fake_smi(sg, monkeypatch, None)
    found = sg.detect_gpus()
    assert found == {"gpus": [], "driver": None, "driver_cuda": None}
    assert sg.candidate_indexes(found, "linux") == (["cpu"], "No NVIDIA GPU found (no driver, or a machine without one).")


def test_detection_reads_name_capability_driver_and_cuda(sg, monkeypatch):
    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    assert sg.detect_gpus() == {
        "gpus": [{"name": "Quadro P3200", "compute_capability": (6, 1), "driver": "572.76"}],
        "driver": "572.76", "driver_cuda": (12, 8)}


def test_mixed_gpus_choose_a_build_that_covers_both_or_say_why(sg, monkeypatch):
    fake_smi(sg, monkeypatch, [("NVIDIA GeForce RTX 3090", "8.6", "590"), ("Tesla T4", "7.5", "590")], "13.0")
    candidates, _ = sg.candidate_indexes(sg.detect_gpus(), "linux")
    assert candidates[0] == "cu130"
    fake_smi(sg, monkeypatch, [("NVIDIA GeForce GTX 1080", "6.1", "590"), ("NVIDIA GeForce RTX 5090", "12.0", "590")],
             "13.0")
    candidates, why = sg.candidate_indexes(sg.detect_gpus(), "win32")
    assert candidates == ["cu126"] and "No single PyTorch build covers all 2 GPUs" in why


# ---- which wheel files -------------------------------------------------------


def page(index, files):
    links = "\n".join(
        f'<a href="/whl/{index}/{f.replace("+", "%2B")}#sha256={"ab" * 32}" '
        f'data-dist-info-metadata="sha256=cd">{f}</a><br/>' for f in files)
    return f"<html><body>{links}</body></html>"


WIN = "cp311-cp311-win_amd64"
LINUX = "cp311-cp311-manylinux_2_28_x86_64"
PAGES = {
    "cu126": {
        "torch": [f"torch-2.13.0+cu126-{WIN}.whl", f"torch-2.14.0+cu126-{WIN}.whl",
                  f"torch-2.14.1+cu126-{WIN}.whl", f"torch-2.14.1+cu126-{LINUX}.whl",
                  f"torch-2.14.1-{WIN}.whl",  # mirrored without a label: never chosen
                  f"torch-2.14.1+cu126-cp311-cp311t-win_amd64.whl",  # free-threaded
                  f"torch-2.14.1+cu126-cp312-cp312-win_amd64.whl"],
        "torchvision": [f"torchvision-0.28.0+cu126-{WIN}.whl", f"torchvision-0.29.0+cu126-{WIN}.whl",
                        f"torchvision-0.29.1+cu126-{WIN}.whl", f"torchvision-0.29.1+cu126-{LINUX}.whl"],
    },
    "cu132": {
        "torch": [f"torch-2.14.1+cu132-{WIN}.whl", f"torch-2.15.0+cu132-{WIN}.whl"],
        "torchvision": [f"torchvision-0.29.1+cu132-{WIN}.whl", f"torchvision-0.30.0+cu132-{WIN}.whl"],
    },
    "cpu": {
        "torch": [f"torch-2.14.1+cpu-{WIN}.whl"],
        "torchvision": [f"torchvision-0.29.1+cpu-{WIN}.whl"],
    },
}
NEEDS = {"0.28.0": "2.13.0", "0.29.0": "2.14.0", "0.29.1": "2.14.1", "0.30.0": "2.15.0"}


@pytest.fixture
def offline(sg, monkeypatch):
    """download.pytorch.org from the fixture above; nothing reaches the network."""
    def fetch(url, timeout=60):
        if url.endswith(".metadata"):
            ver = url.rsplit("/", 1)[1].split("-")[1].split("%2B")[0]
            return f"Metadata-Version: 2.1\nName: torchvision\nRequires-Dist: torch=={NEEDS[ver]}\n"
        index, name = url[len(sg.INDEX_ROOT) + 1:].strip("/").split("/")
        return page(index, PAGES.get(index, {}).get(name, []))
    monkeypatch.setattr(sg, "fetch", fetch)
    monkeypatch.setattr(sg, "head_size", lambda url: 2_600_000_000 if "/torch-" in url else 6_000_000)
    return fetch


WIN_TAGS = dict(py="cp311")


def test_the_installed_version_line_is_kept_with_its_matching_torchvision(sg, offline):
    tag_ok = sg.platform_tags("win32", "AMD64")
    choice = sg.choose_wheels("cu126", want_line=(2, 14), spec=None, py="cp311", tag_ok=tag_ok)
    assert choice["torch"]["file"] == f"torch-2.14.1+cu126-{WIN}.whl"
    assert choice["torchvision"]["file"] == f"torchvision-0.29.1+cu126-{WIN}.whl"
    assert choice["torch"]["url"] == f"https://download.pytorch.org/whl/cu126/torch-2.14.1%2Bcu126-{WIN}.whl"
    assert choice["torch"]["sha256"] == "ab" * 32

    # The newest on the index is 2.15, but this checkout runs on 2.14.
    choice = sg.choose_wheels("cu132", want_line=(2, 14), spec=None, py="cp311", tag_ok=tag_ok)
    assert (choice["torch"]["version"], choice["torchvision"]["version"]) == ("2.14.1+cu132", "0.29.1+cu132")


def test_an_index_without_the_installed_line_gives_its_newest(sg, offline):
    tag_ok = sg.platform_tags("win32", "AMD64")
    # An old card's only build can be an older line (cu126 has nothing past 2.14).
    choice = sg.choose_wheels("cu126", want_line=(2, 15), spec=None, py="cp311", tag_ok=tag_ok)
    assert choice["torch"]["version"] == "2.14.1+cu126"
    # requirements.txt's pin wins over both.
    choice = sg.choose_wheels("cu126", want_line=(2, 14), spec="<2.14", py="cp311", tag_ok=tag_ok)
    assert (choice["torch"]["version"], choice["torchvision"]["version"]) == ("2.13.0+cu126", "0.28.0+cu126")


def test_an_index_with_nothing_for_this_python_says_so(sg, offline):
    with pytest.raises(sg.SetupError, match="no torch wheel for this Python .cp310."):
        sg.choose_wheels("cu126", want_line=None, spec=None, py="cp310", tag_ok=sg.platform_tags("win32", "AMD64"))


def test_linux_wheels_need_a_new_enough_glibc(sg, offline):
    ok = sg.platform_tags("linux", "x86_64", glibc=(2, 35))
    choice = sg.choose_wheels("cu126", want_line=(2, 14), spec=None, py="cp311", tag_ok=ok)
    assert choice["torch"]["file"] == f"torch-2.14.1+cu126-{LINUX}.whl"
    old = sg.platform_tags("linux", "x86_64", glibc=(2, 17))  # CentOS 7
    assert not old("manylinux_2_28_x86_64") and old("manylinux2014_x86_64")
    assert sg.platform_tags("linux", "aarch64", glibc=(2, 35))("manylinux_2_28_aarch64")
    assert not sg.platform_tags("linux", "aarch64", glibc=(2, 35))("manylinux_2_28_x86_64")


def test_requirements_without_torch_leave_the_version_open(sg, tmp_path):
    assert sg.required_spec(ROOT / "requirements.txt") is None  # torch arrives through ultralytics
    req = tmp_path / "requirements.txt"
    req.write_text("torchvision>=0.20\n# torch is pinned below\ntorch>=2.4,<3  # comment\n", encoding="utf-8")
    assert sg.required_spec(req) == ">=2.4,<3"


def test_the_pip_command_pins_exact_files_from_pytorchs_index_only(sg):
    cmd = sg.pip_command("py", "cu126", ["a.whl", "b.whl"])
    assert cmd[:4] == ["py", "-m", "pip", "install"]
    assert cmd[cmd.index("--index-url") + 1] == "https://download.pytorch.org/whl/cu126/"
    assert "--extra-index-url" not in cmd and "--force-reinstall" not in cmd
    assert cmd[-2:] == ["a.whl", "b.whl"]


def test_leftovers_from_a_locked_install_are_recognised_and_nothing_else(sg):
    for name in ("~orch", "~-rch", "~.rch", "~0rch", "~orchvision", "~orch-2.14.1+cpu.dist-info", "~unctorch",
                 "~orchgen"):
        assert sg._STASH.match(name), name
    for name in ("torch", "~ympy", "~umpy", "numpy", "~illow"):
        assert not sg._STASH.match(name), name


# ---- the whole run, start to finish ------------------------------------------


@pytest.fixture
def machine(sg, monkeypatch, offline):
    """A Windows PC with the CPU build of 2.14.1 installed."""
    monkeypatch.setattr(sg, "installed_version",
                        lambda name: {"torch": "2.14.1+cpu", "torchvision": "0.29.1+cpu"}.get(name))
    monkeypatch.setattr(sg, "platform_tags", lambda *a, **k: (lambda tag: tag == "win_amd64"))
    monkeypatch.setattr(sg.sys, "version_info", (3, 11, 9, "final", 0))
    monkeypatch.setattr(sg, "wrong_python", lambda: None)
    monkeypatch.setattr(sg, "required_spec", lambda *a: None)
    calls = {"pip": [], "verify": []}

    def no_pip(cmd, say, lo, hi):
        raise AssertionError("pip must not run here")
    monkeypatch.setattr(sg, "run_pip", no_pip)
    monkeypatch.setattr(sg, "verify", lambda py: calls["verify"].append(py) or
                        {"usable": False, "loads": True, "torch": "2.14.1+cpu",
                         "reason": "Quadro P3200 found, but this is a CPU-only PyTorch build"})
    return calls


def run_main(sg, argv):
    out = io.StringIO()
    code = sg.main(argv, stream=out)
    return code, out.getvalue()


def json_lines(text):
    lines = [json.loads(line) for line in text.splitlines() if line.strip()]
    for line in lines:
        assert set(line) >= {"stage", "pct", "msg"}
        assert isinstance(line["pct"], int) and 0 <= line["pct"] <= 100
    assert [l["pct"] for l in lines] == sorted(l["pct"] for l in lines), "progress ran backwards"
    return lines


def test_dry_run_on_a_pascal_card_plans_cu126_and_changes_nothing(sg, monkeypatch, machine):
    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    code, out = run_main(sg, ["--dry-run", "--json"])
    lines = json_lines(out)
    assert code == 0
    final = lines[-1]
    assert final["stage"] == "done" and final["pct"] == 100
    result = final["result"]
    assert result["dry_run"] is True and result["changed"] is False
    steps = result["plan"]["steps"]
    assert [s["index"] for s in steps] == ["cu126"]
    assert steps[0]["torch"]["version"] == "2.14.1+cu126"
    assert steps[0]["torchvision"]["version"] == "0.29.1+cu126"
    commands = [l["command"] for l in lines if "command" in l]
    assert any("--index-url https://download.pytorch.org/whl/cu126/" in c and "torch-2.14.1+cu126" in c
               for c in commands)
    assert any("CPU-only PyTorch build" in l["msg"] for l in lines)


def test_dry_run_in_plain_text_prints_the_plan(sg, monkeypatch, machine):
    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    code, out = run_main(sg, ["--dry-run"])
    assert code == 0
    assert "torch 2.14.1+cu126 + torchvision 0.29.1+cu126" in out
    assert "2.61 GB download" in out
    assert "Dry run: nothing was downloaded or changed." in out
    assert not out.lstrip().startswith("{")


def test_forced_cpu_and_forced_index(sg, monkeypatch, machine):
    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    code, out = run_main(sg, ["--dry-run", "--json", "--index", "cu132"])
    assert code == 0 and [s["index"] for s in json_lines(out)[-1]["result"]["plan"]["steps"]] == ["cu132"]
    # The CPU build that is already there: nothing to do.
    code, out = run_main(sg, ["--json", "--cpu"])
    final = json_lines(out)[-1]
    assert code == 0 and final["result"]["changed"] is False and "already installed" in final["msg"]
    code, out = run_main(sg, ["--json", "--index", "rocm"])
    assert code == 2 and "--index takes" in json_lines(out)[-1]["msg"]


def test_a_gpu_less_vps_with_pytorch_has_nothing_to_change(sg, monkeypatch, machine):
    fake_smi(sg, monkeypatch, None)
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 0 and final["result"]["changed"] is False
    assert "nothing to change" in final["msg"] and "--cpu" in final["msg"]
    # Changed deliberately: the installed build is asked whether it loads
    # (once), because the metadata alone survives a half-finished install.
    assert len(machine["verify"]) == 1


def test_a_build_that_already_works_is_left_alone(sg, monkeypatch, machine):
    fake_smi(sg, monkeypatch, [("NVIDIA GeForce RTX 3060", "8.6", "590")], "13.0")
    monkeypatch.setattr(sg, "verify", lambda py: {"usable": True, "torch": "2.14.1+cu130",
                                                  "reason": "NVIDIA GeForce RTX 3060"})
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 0 and final["result"]["changed"] is False
    assert final["msg"] == "PyTorch 2.14.1+cu130 already runs on NVIDIA GeForce RTX 3060: nothing to change."


def test_the_packaged_app_refuses_with_guidance(sg, monkeypatch, machine):
    monkeypatch.setattr(sg.sys, "frozen", True, raising=False)
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 3
    assert final["stage"] == "refused" and final["result"]["frozen"] is True
    assert "run Solaris Studio from source" in final["msg"]


def test_the_wrong_python_is_refused_with_the_right_command(sg, monkeypatch, tmp_path):
    venv = tmp_path / "venv"
    venv.mkdir()
    monkeypatch.setattr(sg, "ROOT", tmp_path)
    monkeypatch.setattr(sg.sys, "prefix", str(tmp_path / "elsewhere"))
    message = sg.wrong_python()
    assert message and "not the project's Python" in message and str(venv) in message
    monkeypatch.setattr(sg.sys, "prefix", str(venv))
    assert sg.wrong_python() is None


@pytest.fixture
def installing(sg, monkeypatch, machine, tmp_path):
    """Downloads that only touch a file; pip and verification scripted per test."""
    def download(wheel, folder, say, lo, hi, size):
        target = folder / wheel["file"]
        target.write_bytes(b"wheel")
        say("download", f"Downloading {wheel['file']}", hi)
        return target
    monkeypatch.setattr(sg, "download", download)
    monkeypatch.setattr(sg, "free_bytes", lambda path: 1 << 50)
    monkeypatch.setattr(sg, "clean_stale_stashes", lambda: 0)
    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    return machine


def test_a_build_that_passes_the_test_is_kept_and_asks_for_a_restart(sg, monkeypatch, installing):
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or (0, "Successfully installed"))
    answers = iter([{"usable": False, "torch": "2.14.1+cpu", "reason": "CPU-only PyTorch build"},
                    {"usable": True, "torch": "2.14.1+cu126", "reason": "Quadro P3200"}])
    monkeypatch.setattr(sg, "verify", lambda py: next(answers))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 0, final
    assert final["result"]["gpu"] is True and final["result"]["restart"] is True
    assert final["msg"] == ("PyTorch 2.14.1+cu126 can use Quadro P3200: a test ran on it. "
                            "Restart Solaris Studio to use the GPU.")
    assert len(pips) == 1 and pips[0][-2].endswith("torch-2.14.1+cu126-cp311-cp311-win_amd64.whl")


def test_a_build_that_fails_the_test_is_replaced_by_the_cpu_build(sg, monkeypatch, installing):
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or (0, "Successfully installed"))
    answers = iter([{"usable": False, "torch": "2.14.1+cpu", "reason": "CPU-only PyTorch build"},
                    {"usable": False, "torch": "2.14.1+cu126",
                     "reason": "CUDA error: no kernel image is available for execution on the device"},
                    {"usable": False, "loads": True, "torch": "2.14.1+cpu", "reason": "CPU-only PyTorch build"}])
    monkeypatch.setattr(sg, "verify", lambda py: next(answers))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 1
    assert "no kernel image" in final["msg"] and "PyTorch 2.14.1+cpu (CPU-only) is installed instead" in final["msg"]
    assert [p[p.index("--index-url") + 1] for p in pips] == [
        "https://download.pytorch.org/whl/cu126/", "https://download.pytorch.org/whl/cpu/"]


def test_files_locked_by_the_running_app_give_the_terminal_command(sg, monkeypatch, installing):
    output = ("ERROR: Could not install packages due to an OSError: [WinError 5] Access is denied: "
              "'C:\\\\venv\\\\Lib\\\\site-packages\\\\torch\\\\lib\\\\c10.dll'")
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: (1, output))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 4
    assert final["result"]["locked"] is True
    assert "Close Solaris Studio completely" in final["msg"]
    assert "setup_gpu.py" in final["result"]["command"]
    assert final["result"]["changed"] is False and "left as it was" in final["msg"]


# ---- never leave the venv without a working PyTorch ---------------------------


def test_a_gpu_less_vps_with_a_broken_pytorch_gets_the_cpu_build(sg, monkeypatch, installing):
    """The dist-info survives an interrupted install; the files may not."""
    fake_smi(sg, monkeypatch, None)
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or (0, "Successfully installed"))
    answers = iter([{"usable": False, "loads": False, "reason": "ImportError: DLL load failed"},
                    {"usable": False, "loads": True, "torch": "2.14.1+cpu", "reason": "no GPU"}])
    monkeypatch.setattr(sg, "verify", lambda py: next(answers))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 0 and final["result"]["changed"] is True, final
    assert len(pips) == 1 and pips[0][pips[0].index("--index-url") + 1].endswith("/whl/cpu/")
    # Same version as the (broken) one on record: pip must reinstall, not skip.
    assert "--force-reinstall" in pips[0] and "--no-deps" in pips[0]


def test_forced_cpu_repairs_a_cpu_build_that_does_not_load(sg, monkeypatch, installing):
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or (0, "Successfully installed"))
    answers = iter([{"loads": False, "reason": "ImportError"}, {"loads": True, "torch": "2.14.1+cpu"}])
    monkeypatch.setattr(sg, "verify", lambda py: next(answers))
    code, out = run_main(sg, ["--json", "--cpu"])
    assert code == 0 and len(pips) == 1 and "--force-reinstall" in pips[0]


def test_a_later_candidate_failing_to_download_still_restores_the_cpu_build(sg, monkeypatch, installing):
    """cu126 installs but fails its test; cu132's download dies. The venv must
    not be left on the cu126 build that just failed."""
    fake_smi(sg, monkeypatch, [("NVIDIA GeForce RTX 3060", "8.6", "590")], "13.2")
    monkeypatch.setattr(sg, "candidate_indexes", lambda found, plat=None: (["cu126", "cu132"], "two"))
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or (0, "Successfully installed"))
    real_download = sg.download

    def download(wheel, folder, say, lo, hi, size):
        if "cu132" in wheel["file"]:
            raise sg.SetupError("Downloading failed five times", sg.EXIT_CANNOT)
        return real_download(wheel, folder, say, lo, hi, size)
    monkeypatch.setattr(sg, "download", download)
    answers = iter([{"usable": False, "loads": True, "torch": "2.14.1+cpu", "reason": "CPU-only build"},
                    {"usable": False, "loads": True, "torch": "2.14.1+cu126", "reason": "kernel failed"},
                    {"usable": False, "loads": True, "torch": "2.14.1+cpu", "reason": "no"}])
    monkeypatch.setattr(sg, "verify", lambda py: next(answers))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 1 and final["result"]["index"] == "cpu", final
    assert "Downloading failed" in final["msg"] and "CPU-only) is installed instead" in final["msg"]
    assert [p[p.index("--index-url") + 1].rsplit("/", 2)[-2] for p in pips] == ["cu126", "cpu"]


def test_pip_failing_for_every_candidate_leaves_pytorch_alone(sg, monkeypatch, installing):
    pips = []
    monkeypatch.setattr(sg, "run_pip", lambda cmd, say, lo, hi: pips.append(cmd) or
                        (1, "ERROR: No matching distribution found for sympy>=1.13.3"))
    code, out = run_main(sg, ["--json"])
    final = json_lines(out)[-1]
    assert code == 1 and final["result"]["changed"] is False and final["result"]["restart"] is False
    assert "left as it was" in final["msg"] and len(pips) == 1  # no CPU "restore" over a working CPU build


def test_the_run_finishes_even_when_its_reader_goes_away(sg):
    """The engine quitting mid-install closes our stdout; the script must keep
    going to verify/restore rather than die between pip and the test."""
    class Gone(io.StringIO):
        def write(self, s):
            raise BrokenPipeError(32, "Broken pipe")
    say = sg.Reporter(True, Gone())
    say("install", "line", 10)
    say("install", "another", 20)  # no exception, and no more attempts to write
    assert say.stream is None and say.pct == 20


def test_torchvision_with_only_a_lower_bound_on_torch_is_paired_by_its_line(sg, offline, monkeypatch):
    """Measured: torchvision 0.29.1+cu126 declares `torch (>=2.14.0)`, not ==."""
    def fetch(url, timeout=60, _orig=offline):
        if url.endswith(".metadata"):
            return "Metadata-Version: 2.1\nName: torchvision\nRequires-Dist: numpy\nRequires-Dist: torch (>=2.14.0)\n"
        return _orig(url, timeout)
    monkeypatch.setattr(sg, "fetch", fetch)
    choice = sg.choose_wheels("cu132", want_line=(2, 15), spec=None, py="cp311",
                              tag_ok=sg.platform_tags("win32", "AMD64"))
    # 0.29.1 also "allows" torch 2.15, but only 0.30 is built for it.
    assert (choice["torch"]["version"], choice["torchvision"]["version"]) == ("2.15.0+cu132", "0.30.0+cu132")
    assert sg._torchvision_requires({"metadata": "x.metadata"}) == ">=2.14.0"


def test_a_forced_index_that_does_not_exist_is_not_blamed_on_the_connection(sg, monkeypatch):
    import urllib.error

    fake_smi(sg, monkeypatch, [("Quadro P3200", "6.1", "572.76")], "12.8")
    monkeypatch.setattr(sg, "installed_version", lambda name: None)
    monkeypatch.setattr(sg, "wrong_python", lambda: None)
    monkeypatch.setattr(sg, "required_spec", lambda *a: None)

    def urlopen(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)
    monkeypatch.setattr(sg.urllib.request, "urlopen", urlopen)
    with pytest.raises(sg.SetupError) as e:
        sg.fetch("https://download.pytorch.org/whl/cu999/torch/")
    assert e.value.code == sg.EXIT_FAILED and "404" in str(e.value)
    code, out = run_main(sg, ["--json", "--dry-run", "--index", "cu999"])
    final = json_lines(out)[-1]
    assert code == 2 and "does not exist" in final["msg"] and "internet" not in final["msg"]


# ---- the engine's routes -----------------------------------------------------

REPORT = {
    "platform": "win32", "frozen": False,
    "nvidia": {"gpus": [{"index": 0, "name": "Quadro P3200", "compute_capability": "6.1", "vram_gb": 6.0}],
               "driver": "572.76", "driver_max_cuda": "12.8", "source": "nvml"},
    "torch": {"version": "2.14.1+cpu", "usable": False, "arch_range": None,
              "reason": "Quadro P3200 found, but this is a CPU-only PyTorch build"},
    "ctranslate2": {"version": "4.8.3", "cuda_devices": 1, "compute_types": ["float32", "int8", "int8_float32"],
                    "chosen": "int8_float32"},
    "onnxruntime": {"version": "1.31.0", "providers": ["CPUExecutionProvider"], "gpu": False},
    "ffmpeg_encoders": {"nvenc": {"ok": False, "error": "driver too old for this NVENC"},
                        "amf": {"ok": False, "error": "no AMD"}, "qsv": {"ok": True, "error": ""}},
    "recommendation": {"needed": True, "candidates": ["cu126"], "why": "..."},
}


def test_layers_say_where_each_part_runs_and_why(monkeypatch):
    import types

    import server.gpu_routes as gpu_routes
    from server.gpu_routes import layers

    rows = {r["id"]: r for r in layers(REPORT)}
    assert list(rows) == ["torch", "whisper", "encoding", "stats"]
    assert rows["torch"]["status"] == "cpu" and "CPU-only" in rows["torch"]["reason"]
    assert rows["whisper"]["status"] == "gpu" and "int8_float32" in rows["whisper"]["reason"]
    assert rows["encoding"] == {"id": "encoding", "label": "Encoding", "status": "gpu",
                                "reason": "Hardware encoding with Intel Quick Sync"}
    assert rows["stats"]["status"] == "gpu"

    # Without cuBLAS 12: CTranslate2 lists the GPU, but Whisper can't load on it.
    # The cure is OS-specific, so each OS is checked on its own wording.
    monkeypatch.setattr(gpu_routes, "os", types.SimpleNamespace(name="nt"))
    rows = {r["id"]: r for r in layers({**REPORT, "whisper_cublas12": False})}
    assert rows["whisper"]["status"] == "cpu" and "cublas64_12.dll" in rows["whisper"]["reason"]
    # A Linux VPS: the cu126 PyTorch wheel is not where cuBLAS 12 comes from there.
    monkeypatch.setattr(gpu_routes, "os", types.SimpleNamespace(name="posix"))
    rows = {r["id"]: r for r in layers({**REPORT, "whisper_cublas12": False})}
    assert rows["whisper"]["status"] == "cpu"
    assert "libcublas.so.12" in rows["whisper"]["reason"] and "nvidia-cublas-cu12" in rows["whisper"]["reason"]
    assert "cu126" not in rows["whisper"]["reason"]
    monkeypatch.undo()

    vps = {**REPORT, "nvidia": {"gpus": [], "source": None},
           "torch": {"usable": False, "reason": "no CUDA GPU detected"},
           "ctranslate2": {"version": "4.8.3", "cuda_devices": 0, "chosen": None},
           "ffmpeg_encoders": {k: {"ok": False, "error": "x"} for k in ("nvenc", "amf", "qsv")}}
    rows = {r["id"]: r for r in layers(vps)}
    assert [rows[k]["status"] for k in rows] == ["cpu", "cpu", "cpu", "off"]
    assert rows["encoding"]["reason"] == "No hardware encoder passed a test encode; x264 on the CPU"


def test_setup_arguments_are_validated():
    from fastapi import HTTPException

    from server.gpu_routes import GpuSetupIn, script_args

    assert script_args(GpuSetupIn()) == ["--json"]
    assert script_args(GpuSetupIn(mode="cpu")) == ["--json", "--cpu"]
    assert script_args(GpuSetupIn(mode="index", index="cu126", dry_run=True)) == ["--json", "--index", "cu126",
                                                                                   "--dry-run"]
    assert script_args(GpuSetupIn(mode="dry_run")) == ["--json", "--dry-run"]
    for bad in (GpuSetupIn(mode="index", index="cu126; rm -rf /"), GpuSetupIn(mode="nuke")):
        with pytest.raises(HTTPException):
            script_args(bad)


@pytest.fixture
def gpu_client(tmp_path, monkeypatch):
    pytest.importorskip("httpx")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from server import gpu_routes

    script = tmp_path / "fake_setup.py"
    script.write_text(
        "import json, sys\n"
        "print(json.dumps({'stage': 'plan', 'pct': 5, 'msg': 'args ' + ' '.join(sys.argv[1:])}))\n"
        "print('a stray line')\n"
        "print(json.dumps({'stage': 'done', 'pct': 100, 'msg': 'ok', 'result': "
        "{'ok': True, 'changed': '--dry-run' not in sys.argv, 'message': 'ok'}}))\n", encoding="utf-8")
    monkeypatch.setattr(gpu_routes, "SCRIPT", script)
    data = tmp_path / "data"
    (data / "plugins").mkdir(parents=True)
    (data / "plugins" / "session.secret").write_text("s" * 32 + "\n", encoding="utf-8")
    app = FastAPI()
    run = gpu_routes.install(app, data_dir=data, report=lambda: dict(REPORT))
    return TestClient(app, base_url="http://127.0.0.1"), run


def _wait(run):
    import time

    for _ in range(200):
        if not run.running() and run.finished:
            return
        time.sleep(0.05)
    raise AssertionError("the setup process did not finish")


def test_gpu_status_route(gpu_client):
    client, _run = gpu_client
    body = client.get("/system/gpu").json()
    assert body["nvidia"]["gpus"][0]["name"] == "Quadro P3200"
    assert [l["id"] for l in body["layers"]] == ["torch", "whisper", "encoding", "stats"]
    assert body["setup"]["available"] is True and body["setup"]["offer"] is True
    assert body["setup"]["restart_required"] is False


def test_setup_needs_the_session_header_and_streams_progress(gpu_client):
    client, run = gpu_client
    assert client.post("/system/gpu/setup", json={"mode": "auto"}).status_code == 403
    assert client.post("/system/gpu/setup", json={"mode": "auto"},
                       headers={"X-Solaris-Studio-Session": "wrong" * 5}).status_code == 403
    headers = {"X-Solaris-Studio-Session": "s" * 32}

    r = client.post("/system/gpu/setup", json={"mode": "dry_run"}, headers=headers)
    assert r.status_code == 200 and r.json()["dry_run"] is True
    _wait(run)
    status = client.get("/system/gpu/setup").json()
    assert status["running"] is False and status["exit_code"] == 0
    assert status["lines"][0]["msg"] == "args --json --dry-run"
    assert {"stage": "log", "msg": "a stray line"} in status["lines"]
    assert status["pct"] == 100 and status["result"]["ok"] is True
    assert status["restart_required"] is False  # a dry run changes nothing

    client.post("/system/gpu/setup", json={"mode": "index", "index": "cu126"}, headers=headers)
    _wait(run)
    status = client.get("/system/gpu/setup").json()
    assert status["lines"][0]["msg"] == "args --json --index cu126"
    assert status["restart_required"] is True
    assert client.get("/system/gpu").json()["setup"]["restart_required"] is True


def test_a_real_install_waits_for_a_running_job_but_a_dry_run_does_not(gpu_client, tmp_path):
    """pip replacing torch under a running render can crash it at its next
    lazy torch import, so a real install is refused (409) while a job runs."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from server import gpu_routes

    _client, run = gpu_client
    reason = {"now": "A video is being processed."}
    app = FastAPI()
    data = tmp_path / "data"
    gpu_routes.install(app, data_dir=data, report=lambda: dict(REPORT), runner=run,
                       busy=lambda: reason["now"])
    client = TestClient(app, base_url="http://127.0.0.1")
    headers = {"X-Solaris-Studio-Session": "s" * 32}

    r = client.post("/system/gpu/setup", json={"mode": "index", "index": "cu126"}, headers=headers)
    assert r.status_code == 409 and "being processed" in r.json()["detail"]
    assert run.proc is None   # nothing was started

    r = client.post("/system/gpu/setup", json={"mode": "dry_run"}, headers=headers)
    assert r.status_code == 200
    _wait(run)

    reason["now"] = None
    r = client.post("/system/gpu/setup", json={"mode": "index", "index": "cu126"}, headers=headers)
    assert r.status_code == 200
    _wait(run)


def test_the_packaged_app_does_not_offer_or_run_setup(gpu_client, monkeypatch):
    client, _run = gpu_client
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    setup = client.get("/system/gpu").json()["setup"]
    assert setup["available"] is False and setup["offer"] is False and setup["frozen"] is True
    assert "carries its own PyTorch" in setup["unavailable_reason"]
    r = client.post("/system/gpu/setup", json={"mode": "auto"}, headers={"X-Solaris-Studio-Session": "s" * 32})
    assert r.status_code == 409


# ---- the installer build's warning -------------------------------------------


def test_the_installer_build_names_the_generations_its_pytorch_leaves_out():
    """The packaged app ships one architecture range. The build used to say
    "install from cu130" as if that suited everyone; cu130 is the build that
    drops Pascal, so it now says what each range excludes."""
    spec = importlib.util.spec_from_file_location("build_installer_gpu", ROOT / "scripts" / "build_installer.py")
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)

    cu126 = ["sm_50", "sm_60", "sm_61", "sm_70", "sm_75", "sm_80", "sm_86", "sm_90"]
    covered, excluded = build.arch_coverage(cu126)
    assert covered == "sm_50..sm_90"
    assert [e.split(" (")[0] for e in excluded] == ["Blackwell datacenter", "Blackwell"]

    cu130 = ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120"]
    covered, excluded = build.arch_coverage(cu130)
    assert covered == "sm_75..sm_120"
    assert [e.split(" (")[0] for e in excluded] == ["Maxwell", "Pascal", "Volta"]

    source = (ROOT / "scripts" / "build_installer.py").read_text(encoding="utf-8")
    assert "whl/cu130" not in source and "scripts/setup_gpu.py" in source
