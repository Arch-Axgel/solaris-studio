"""FFmpeg 8 removed the deprecated -vsync option."""

import io
from pathlib import Path
from types import SimpleNamespace

from core.models import ClipCandidate
from video import cutter, encoding


def test_cut_clip_uses_supported_constant_frame_rate_option(monkeypatch, tmp_path):
    seen = {}

    def run(cmd, **kwargs):
        seen["cmd"] = cmd
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(cutter, "ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(cutter, "hwaccel_input_args", lambda: [])
    monkeypatch.setattr(cutter, "audio_filter_args", lambda _normalize: [])
    monkeypatch.setattr(cutter, "video_encoder_args", lambda: ["-c:v", "libx264"])
    monkeypatch.setattr(cutter, "using_hardware_encoder", lambda: False)
    monkeypatch.setattr(cutter.subprocess, "run", run)

    cutter.cut_clip(
        Path("source.mp4"),
        ClipCandidate(start=1, end=5, score=80),
        tmp_path / "clip.mp4",
    )

    cmd = seen["cmd"]
    assert cmd[cmd.index("-fps_mode") + 1] == "cfr"
    assert "-vsync" not in cmd


def test_sampled_frames_preserves_source_frame_timing(monkeypatch):
    seen = {}

    class Process:
        stdout = io.BytesIO()

        def __init__(self, cmd, **kwargs):
            seen["cmd"] = cmd

        @staticmethod
        def poll():
            return 0

        @staticmethod
        def wait():
            return 0

    monkeypatch.setattr(encoding, "ffmpeg", lambda: "ffmpeg")
    monkeypatch.setattr(encoding.subprocess, "Popen", Process)

    assert list(encoding.sampled_frames(Path("clip.mp4"), 8, 16, 16, hwaccel=False)) == []

    cmd = seen["cmd"]
    assert cmd[cmd.index("-fps_mode") + 1] == "passthrough"
    assert "-vsync" not in cmd
