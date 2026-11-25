"""When the burner account's cookies leave YouTube with nothing to offer.

Signed in, yt-dlp asks only YouTube's logged-in player clients, and each needs
yt-dlp's JavaScript challenge solver. When YouTube changes its player before
yt-dlp catches up, every signed-in stream is dropped and the download fails
with "Requested format is not available", while the anonymous clients would
still have served it. extract_info asks once more without the cookies then.
"""

import sys
import types
from contextlib import contextmanager

import pytest

from sources import ytdlp_common

URL = "https://www.youtube.com/watch?v=-2PnhJqIpoo"
NO_FORMATS = "ERROR: [youtube] -2PnhJqIpoo: Requested format is not available. Use --list-formats"


class DownloadError(Exception):
    pass


def _install(monkeypatch, outcomes, cookies=True):
    """Fake yt_dlp whose successive extract_info calls follow `outcomes`
    (an exception to raise or a dict to return); returns the options seen."""
    seen = []
    queue = list(outcomes)

    class FakeYoutubeDL:
        def __init__(self, options):
            seen.append(options)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def extract_info(self, *_args, **_kwargs):
            outcome = queue.pop(0)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

    fake = types.ModuleType("yt_dlp")
    fake.YoutubeDL = FakeYoutubeDL
    fake.utils = types.SimpleNamespace(DownloadError=DownloadError)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake)
    monkeypatch.setattr(ytdlp_common, "_ipv4_only", False)

    @contextmanager
    def fake_cookies(_url, **_kwargs):
        yield {"cookiefile": "C:/tmp/cookies.txt"} if cookies else {}

    monkeypatch.setattr(ytdlp_common, "_youtube_browser_cookies", fake_cookies)
    return seen


def test_no_formats_while_signed_in_retries_without_cookies(monkeypatch, capsys):
    seen = _install(monkeypatch, [DownloadError(NO_FORMATS), {"format_id": "302"}])

    info = ytdlp_common.extract_info(URL, {"format": "b"})

    assert info == {"format_id": "302"}
    assert "cookiefile" in seen[0]
    assert "cookiefile" not in seen[1]
    # The retry still gets the JavaScript solver set up.
    assert "remote_components" in seen[1]
    assert "without the burner account's cookies" in capsys.readouterr().out


def test_signed_in_failure_is_reported_when_the_retry_fails_too(monkeypatch):
    first = DownloadError(NO_FORMATS)
    _install(monkeypatch, [first, DownloadError("ERROR: something else")])

    with pytest.raises(DownloadError) as raised:
        ytdlp_common.extract_info(URL, {"format": "b"})
    assert raised.value is first


def test_other_signed_in_failures_are_not_retried_without_cookies(monkeypatch):
    private = DownloadError("ERROR: [youtube] x: Private video. Sign in if you've been granted access")
    seen = _install(monkeypatch, [private])

    with pytest.raises(DownloadError):
        ytdlp_common.extract_info(URL, {"format": "b"})
    assert len(seen) == 1


def test_no_cookies_in_play_means_no_extra_attempt(monkeypatch):
    seen = _install(monkeypatch, [DownloadError(NO_FORMATS)], cookies=False)

    with pytest.raises(DownloadError):
        ytdlp_common.extract_info(URL, {"format": "b"})
    assert len(seen) == 1


def test_a_callers_own_cookie_file_is_left_alone(monkeypatch):
    seen = _install(monkeypatch, [DownloadError(NO_FORMATS)])

    with pytest.raises(DownloadError):
        ytdlp_common.extract_info(URL, {"format": "b", "cookiefile": "mine.txt"})
    assert len(seen) == 1
    assert seen[0]["cookiefile"] == "mine.txt"
