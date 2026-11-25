"""The dedicated YouTube browser's page is refreshed once per download.

Google rotates the signed-in session cookies while the page is in use; a
browser left minimized for hours hands yt-dlp stale ones, and the bot check
comes back. So before the cookies are exported for a YouTube download, the
engine reloads YouTube in that browser over its loopback DevTools socket —
once per download, never per yt-dlp retry, and never fatally.

Everything here drives a fake DevTools websocket; no browser is started.
"""

import json
import sys
import threading
import types
from pathlib import Path

import pytest

from sources import ytdlp_common

VIDEO = "https://www.youtube.com/watch?v=aB3dEfGhIjK"
SAME_VIDEO_SHORT = "https://youtu.be/aB3dEfGhIjK?t=42"
OTHER_VIDEO = "https://www.youtube.com/watch?v=zZ9yXwVuTsR"
SECRET = "very-secret-cookie-value"


@pytest.fixture(autouse=True)
def _fresh_refresh_state(monkeypatch):
    """The throttle is module state on purpose; each test starts with none."""
    monkeypatch.setattr(ytdlp_common, "_refreshed", {})
    monkeypatch.setattr(ytdlp_common, "_last_any_refresh_at", None)
    monkeypatch.setattr(ytdlp_common, "_refreshing", None)
    monkeypatch.setattr(ytdlp_common, "_REFRESH_SETTLE", 0)


class FakeBrowser:
    """Answers CDP commands like Chromium does, and fires Page.loadEventFired
    after a reload or navigate unless told the page never finishes."""

    def __init__(self, targets, *, loads=True, load_before_answer=False):
        self.targets = targets
        self.loads = loads
        self.load_before_answer = load_before_answer
        self.sent = []
        self.pending = []
        self.connections = 0

    # websockets.sync.client.connect(...) -> context manager
    def connect(self, uri, **kwargs):
        assert uri == "ws://127.0.0.1:9222/devtools/browser/test-id"
        assert kwargs["proxy"] is None
        self.connections += 1
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def send(self, payload):
        message = json.loads(payload)
        self.sent.append(message)
        method = message["method"]
        results = {
            "Target.getTargets": {"targetInfos": self.targets},
            "Target.createTarget": {"targetId": "new-tab"},
            "Target.attachToTarget": {"sessionId": "attached"},
            "Page.enable": {},
            "Page.reload": {},
            "Page.navigate": {"frameId": "frame"},
            "Network.getAllCookies": {"cookies": []},
        }
        answer = {"id": message["id"], "result": results[method]}
        load = {"method": "Page.loadEventFired", "sessionId": "attached", "params": {}}
        # Another tab's load must not count as ours.
        other_load = {"method": "Page.loadEventFired", "sessionId": "other", "params": {}}
        if method in ("Page.reload", "Page.navigate") and self.loads:
            if self.load_before_answer:
                self.pending += [other_load, load, answer]
            else:
                self.pending += [answer, other_load, load]
        else:
            self.pending.append(answer)

    def recv(self, timeout):
        if not self.pending:
            raise TimeoutError
        return json.dumps(self.pending.pop(0))

    def methods(self):
        return [message["method"] for message in self.sent]


@pytest.fixture
def devtools(monkeypatch, tmp_path):
    (tmp_path / "DevToolsActivePort").write_text(
        "9222\n/devtools/browser/test-id\n", encoding="utf-8"
    )
    import websockets.sync.client

    def install(browser):
        monkeypatch.setattr(websockets.sync.client, "connect", browser.connect)
        return browser

    return install


# ---- the refresh itself ------------------------------------------------------------


@pytest.mark.parametrize("load_before_answer", [False, True])
def test_a_page_on_youtube_is_reloaded(devtools, tmp_path, load_before_answer):
    browser = devtools(
        FakeBrowser(
            [{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}],
            load_before_answer=load_before_answer,
        )
    )

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    assert browser.methods() == [
        "Target.getTargets",
        "Target.attachToTarget",
        "Page.enable",
        "Page.reload",
    ]
    assert browser.sent[1]["params"] == {"targetId": "yt", "flatten": True}
    assert browser.sent[2]["sessionId"] == "attached"
    assert browser.sent[3]["sessionId"] == "attached"
    # The video itself is never opened in the user's browser.
    assert VIDEO not in json.dumps(browser.sent)


def test_a_page_somewhere_else_is_sent_to_youtube(devtools, tmp_path):
    browser = devtools(
        FakeBrowser(
            [
                {"type": "service_worker", "targetId": "sw", "url": "https://www.youtube.com/sw.js"},
                {"type": "page", "targetId": "acct", "url": "https://myaccount.google.com/"},
            ]
        )
    )

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    assert browser.methods() == [
        "Target.getTargets",
        "Target.attachToTarget",
        "Page.enable",
        "Page.navigate",
    ]
    assert browser.sent[1]["params"]["targetId"] == "acct"
    assert browser.sent[3]["params"] == {"url": "https://www.youtube.com/"}


def test_a_lookalike_host_is_not_youtube():
    assert ytdlp_common._is_youtube_page("https://m.youtube.com/watch?v=x")
    assert not ytdlp_common._is_youtube_page("https://youtube.com.evil.example/")
    assert not ytdlp_common._is_youtube_page("about:blank")
    assert not ytdlp_common._is_youtube_page(None)


def test_no_tab_open_creates_one_on_youtube(devtools, tmp_path):
    browser = devtools(FakeBrowser([]))

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    assert browser.methods() == [
        "Target.getTargets",
        "Target.createTarget",
        "Target.attachToTarget",
        "Page.enable",
        "Page.navigate",
    ]
    assert browser.sent[1]["params"]["url"] == "https://www.youtube.com/"
    assert browser.sent[2]["params"]["targetId"] == "new-tab"


def test_a_page_that_never_loads_is_waited_for_then_used(
    devtools, tmp_path, monkeypatch, capsys
):
    browser = devtools(
        FakeBrowser(
            [{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}],
            loads=False,
        )
    )
    # Move the clock on with every look, so the 12 s wait passes instantly.
    ticks = iter(range(0, 10_000, 5))
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: float(next(ticks)))

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)  # does not raise

    assert browser.methods()[-1] == "Page.reload"
    assert "didn't finish loading" in capsys.readouterr().out


class CommittingBrowser(FakeBrowser):
    """YouTube as seen live: the reload commits (Page.frameNavigated on the
    main frame) but the load event never comes, because the page streams."""

    def send(self, payload):
        super().send(payload)
        if self.sent[-1]["method"] == "Page.reload":
            self.pending.append(
                {
                    "method": "Page.frameNavigated",
                    "sessionId": "attached",
                    "params": {"frame": {"id": "main", "url": "https://www.youtube.com/"}},
                }
            )


def test_a_committed_reload_waits_only_briefly_and_quietly(
    devtools, tmp_path, monkeypatch, capsys
):
    devtools(
        CommittingBrowser(
            [{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}],
            loads=False,
        )
    )
    now = [0.0]

    def clock():
        now[0] += 0.5
        return now[0]

    monkeypatch.setattr(ytdlp_common, "_clock", clock)

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    # Far less than the 12 s load timeout, and no warning: the fresh cookies
    # came with the committed response.
    assert now[0] < ytdlp_common._REFRESH_LOAD_TIMEOUT
    assert "WARNING" not in capsys.readouterr().out


def test_a_tab_mid_sign_in_is_left_alone(devtools, tmp_path):
    browser = devtools(
        FakeBrowser(
            [
                {
                    "type": "page",
                    "targetId": "signin",
                    "url": "https://accounts.google.com/ServiceLogin?service=youtube",
                }
            ]
        )
    )

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    assert browser.methods() == ["Target.getTargets"]


def test_a_sign_in_interstitial_is_left_alone_too(devtools, tmp_path):
    browser = devtools(
        FakeBrowser([{"type": "page", "targetId": "gds", "url": "https://gds.google.com/web/chip"}])
    )
    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)
    assert browser.methods() == ["Target.getTargets"]


def test_an_offline_navigate_fails_fast_instead_of_waiting(devtools, tmp_path, monkeypatch):
    class OfflineBrowser(FakeBrowser):
        def send(self, payload):
            message = json.loads(payload)
            if message["method"] == "Page.navigate":
                self.sent.append(message)
                self.pending.append(
                    {"id": message["id"], "result": {"frameId": "f", "errorText": "net::ERR_INTERNET_DISCONNECTED"}}
                )
                return
            super().send(payload)

    devtools(OfflineBrowser([{"type": "page", "targetId": "blank", "url": "about:blank"}]))
    looks = []
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: looks.append(1) or 0.0)

    with pytest.raises(ytdlp_common._DevToolsError, match="ERR_INTERNET_DISCONNECTED"):
        ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)
    assert looks == []              # the load wait never started


def test_a_command_drowned_in_events_gives_up(devtools, tmp_path, monkeypatch):
    """A busy page firing events forever must not keep a command waiting
    forever: every command has an overall deadline, not just per recv."""

    class ChattyBrowser(FakeBrowser):
        def send(self, payload):
            message = json.loads(payload)
            self.sent.append(message)
            if message["method"] != "Target.getTargets":
                super().send(payload)
                self.sent.pop()

        def recv(self, timeout):
            assert timeout <= 5
            if self.pending:
                return json.dumps(self.pending.pop(0))
            return json.dumps({"method": "Page.lifecycleEvent", "sessionId": "attached", "params": {}})

    devtools(ChattyBrowser([]))
    monkeypatch.setattr(ytdlp_common, "_DEVTOOLS_COMMAND_TIMEOUT", 0.2)

    with pytest.raises(ytdlp_common._DevToolsError, match="TimeoutError"):
        ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)


def test_an_internal_browser_page_is_skipped_for_a_web_page(devtools, tmp_path):
    browser = devtools(
        FakeBrowser(
            [
                {"type": "page", "targetId": "internal", "url": "edge://sync-confirmation-dialog/"},
                {"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"},
            ]
        )
    )

    ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)

    assert browser.sent[1]["params"]["targetId"] == "yt"
    assert browser.methods()[-1] == "Page.reload"


def test_a_missing_devtools_port_is_a_devtools_error(tmp_path):
    with pytest.raises(ytdlp_common._DevToolsError):
        ytdlp_common._refresh_youtube_page(tmp_path, VIDEO)


def test_the_cookie_reader_still_works_with_one_argument(devtools, tmp_path):
    browser = devtools(
        FakeBrowser([{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}])
    )
    assert ytdlp_common._read_browser_cookies(tmp_path) == []
    assert browser.methods() == [
        "Target.getTargets",
        "Target.attachToTarget",
        "Network.getAllCookies",
    ]


# ---- once per download -------------------------------------------------------------


def test_the_key_is_the_video_whatever_the_link_looks_like():
    key = ytdlp_common._refresh_key(VIDEO)
    assert key == "aB3dEfGhIjK"
    assert ytdlp_common._refresh_key(SAME_VIDEO_SHORT) == key
    assert ytdlp_common._refresh_key("https://www.youtube.com/shorts/aB3dEfGhIjK") == key
    assert ytdlp_common._refresh_key(VIDEO + "&t=10s") == key
    assert ytdlp_common._refresh_key(OTHER_VIDEO) != key
    channel = "https://www.youtube.com/@someone/videos"
    assert ytdlp_common._refresh_key(channel) == channel


def _count_refreshes(monkeypatch):
    calls = []
    monkeypatch.setattr(
        ytdlp_common, "_refresh_youtube_page", lambda path, url: calls.append(url)
    )
    return calls


def test_the_same_video_twice_refreshes_once(monkeypatch, tmp_path):
    calls = _count_refreshes(monkeypatch)
    now = [1000.0]
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: now[0])

    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    now[0] += 30
    ytdlp_common._refresh_once_per_download(tmp_path, SAME_VIDEO_SHORT)
    assert calls == [VIDEO]

    ytdlp_common._refresh_once_per_download(tmp_path, OTHER_VIDEO)
    assert calls == [VIDEO, OTHER_VIDEO]

    # Back to the first video within two minutes: two downloads running side
    # by side (probe A, probe B, download A, download B) mustn't take turns
    # reloading the page for each other.
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    ytdlp_common._refresh_once_per_download(tmp_path, OTHER_VIDEO)
    assert calls == [VIDEO, OTHER_VIDEO]

    # Long after, the same video is a new download again.
    now[0] += 200
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    assert calls == [VIDEO, OTHER_VIDEO, VIDEO]


def test_two_different_videos_at_once_share_the_reload_under_way(monkeypatch, tmp_path):
    """One browser tab means one reload at a time: the second download reads
    the cookies the first one's reload rotated instead of reloading under it."""
    started = threading.Event()
    release = threading.Event()
    calls = []

    def slow_refresh(path, url):
        calls.append(url)
        started.set()
        release.wait(5)

    monkeypatch.setattr(ytdlp_common, "_refresh_youtube_page", slow_refresh)
    first = threading.Thread(
        target=ytdlp_common._refresh_once_per_download, args=(tmp_path, VIDEO)
    )
    first.start()
    assert started.wait(5)
    second = threading.Thread(
        target=ytdlp_common._refresh_once_per_download, args=(tmp_path, OTHER_VIDEO)
    )
    second.start()
    second.join(0.2)
    assert second.is_alive()        # waiting for the first reload
    release.set()
    first.join(5)
    second.join(5)
    assert calls == [VIDEO]
    # ...and that reload counted for the second video too.
    ytdlp_common._refresh_once_per_download(tmp_path, OTHER_VIDEO)
    assert calls == [VIDEO]
    assert ytdlp_common._refreshing is None


def test_background_reads_reload_at_most_every_ten_minutes(monkeypatch, tmp_path):
    """The channel watcher reads listings and pending videos on a timer;
    each poll must not reload the user's browser."""
    calls = _count_refreshes(monkeypatch)
    now = [1000.0]
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: now[0])
    listing = "https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv"

    ytdlp_common._refresh_once_per_download(tmp_path, listing, background=True)
    assert calls == [listing]       # nothing had refreshed yet
    for minute in range(1, 10):
        now[0] = 1000.0 + minute * 60
        ytdlp_common._refresh_once_per_download(tmp_path, listing, background=True)
        ytdlp_common._refresh_once_per_download(tmp_path, OTHER_VIDEO, background=True)
    assert calls == [listing]
    now[0] = 1000.0 + 601
    ytdlp_common._refresh_once_per_download(tmp_path, OTHER_VIDEO, background=True)
    assert calls == [listing, OTHER_VIDEO]
    # A real download still refreshes for its own video at once.
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    assert calls == [listing, OTHER_VIDEO, VIDEO]


def test_the_throttle_memory_does_not_grow_forever(monkeypatch, tmp_path):
    _count_refreshes(monkeypatch)
    now = [0.0]
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: now[0])
    for n in range(50):
        now[0] += 200
        ytdlp_common._refresh_once_per_download(tmp_path, f"https://youtu.be/{n:011d}")
    assert len(ytdlp_common._refreshed) == 1


def test_the_same_video_after_two_minutes_refreshes_again(monkeypatch, tmp_path):
    calls = _count_refreshes(monkeypatch)
    now = [1000.0]
    monkeypatch.setattr(ytdlp_common, "_clock", lambda: now[0])

    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    now[0] += 119
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    assert len(calls) == 1
    now[0] += 2  # 121 s after the refresh
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    assert len(calls) == 2


def test_two_downloads_of_one_video_at_once_share_one_reload(monkeypatch, tmp_path):
    started = threading.Event()
    release = threading.Event()
    calls = []

    def slow_refresh(path, url):
        calls.append(url)
        started.set()
        release.wait(5)

    monkeypatch.setattr(ytdlp_common, "_refresh_youtube_page", slow_refresh)
    first = threading.Thread(
        target=ytdlp_common._refresh_once_per_download, args=(tmp_path, VIDEO)
    )
    first.start()
    assert started.wait(5)

    finished = threading.Event()
    second = threading.Thread(
        target=lambda: (
            ytdlp_common._refresh_once_per_download(tmp_path, SAME_VIDEO_SHORT),
            finished.set(),
        )
    )
    second.start()
    # The second waits for the reload under way rather than starting its own.
    assert not finished.wait(0.2)
    release.set()
    first.join(5)
    second.join(5)
    assert finished.is_set()
    assert calls == [VIDEO]


def test_a_failed_refresh_warns_and_counts(monkeypatch, tmp_path, capsys):
    calls = []

    def broken(path, url):
        calls.append(url)
        raise ytdlp_common._DevToolsError("could not refresh the YouTube page (ConnectionRefusedError)")

    monkeypatch.setattr(ytdlp_common, "_refresh_youtube_page", broken)
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)

    out = capsys.readouterr().out
    assert out.count("WARNING: Could not refresh YouTube") == 1
    assert calls == [VIDEO]


def test_an_unexpected_refresh_crash_is_not_fatal(monkeypatch, tmp_path, capsys):
    def crash(path, url):
        raise KeyError(SECRET)

    monkeypatch.setattr(ytdlp_common, "_refresh_youtube_page", crash)
    ytdlp_common._refresh_once_per_download(tmp_path, VIDEO)
    out = capsys.readouterr().out
    assert "WARNING: Could not refresh YouTube" in out and "KeyError" in out
    assert SECRET not in out


# ---- wired into the cookie export --------------------------------------------------


def _signed_in_cookies():
    return [
        {
            "domain": ".youtube.com",
            "name": "LOGIN_INFO",
            "value": SECRET,
            "path": "/",
            "secure": True,
            "expires": -1,
        }
    ]


def _use_dedicated_browser(monkeypatch, tmp_path):
    monkeypatch.setenv("SOLARIS_STUDIO_YOUTUBE_BROWSER", "edge")
    monkeypatch.setenv("SOLARIS_STUDIO_YOUTUBE_PROFILE", str(tmp_path / "Default"))


def test_the_page_is_refreshed_before_the_cookies_are_read(monkeypatch, tmp_path):
    _use_dedicated_browser(monkeypatch, tmp_path)
    order = []
    monkeypatch.setattr(
        ytdlp_common,
        "_refresh_youtube_page",
        lambda path, url: order.append(("refresh", path, url)),
    )
    monkeypatch.setattr(
        ytdlp_common,
        "_read_browser_cookies",
        lambda path: order.append(("read", path)) or _signed_in_cookies(),
    )

    with ytdlp_common._youtube_browser_cookies(VIDEO) as options:
        assert "cookiefile" in options
    assert order == [("refresh", tmp_path, VIDEO), ("read", tmp_path)]


def test_the_cookie_reader_uses_the_web_tab_and_rejects_odd_targets(devtools, tmp_path):
    browser = devtools(
        FakeBrowser(
            [
                {"type": "page", "targetId": "internal", "url": "edge://newtab-takeover/"},
                {"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"},
            ]
        )
    )
    ytdlp_common._read_browser_cookies(tmp_path)
    assert browser.sent[1]["params"]["targetId"] == "yt"

    devtools(FakeBrowser([{"type": "page", "url": "https://www.youtube.com/"}]))
    with pytest.raises(ytdlp_common._DevToolsError):
        ytdlp_common._read_browser_cookies(tmp_path)


def test_an_unexpected_cookie_read_crash_is_not_fatal_or_leaky(monkeypatch, tmp_path, capsys):
    _use_dedicated_browser(monkeypatch, tmp_path)
    _count_refreshes(monkeypatch)

    def crash(_path):
        raise KeyError(SECRET)

    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", crash)
    with ytdlp_common._youtube_browser_cookies(VIDEO) as options:
        assert options == {}
    out = capsys.readouterr().out
    assert "trying without its cookies" in out and "KeyError" in out
    assert SECRET not in out


def test_an_unwritable_cookie_is_not_fatal(monkeypatch, tmp_path, capsys):
    _use_dedicated_browser(monkeypatch, tmp_path)
    _count_refreshes(monkeypatch)
    odd = _signed_in_cookies()
    odd[0]["expires"] = float("inf")
    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", lambda _path: odd)
    with ytdlp_common._youtube_browser_cookies(VIDEO) as options:
        assert options == {}
    out = capsys.readouterr().out
    assert "WARNING" in out and SECRET not in out


def test_metadata_only_reads_are_background_reads(monkeypatch, tmp_path):
    """extract_info(process=False) is the watcher / VOD finder path."""
    _use_dedicated_browser(monkeypatch, tmp_path)
    seen = []
    monkeypatch.setattr(
        ytdlp_common,
        "_refresh_once_per_download",
        lambda path, url, background=False: seen.append(background),
    )
    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", lambda path: _signed_in_cookies())
    monkeypatch.setattr(ytdlp_common, "_ipv4_only", False)

    class FakeYoutubeDL:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def extract_info(self, *_args, **_kwargs):
            return {}

    fake_yt_dlp = types.ModuleType("yt_dlp")
    fake_yt_dlp.YoutubeDL = FakeYoutubeDL
    fake_yt_dlp.utils = types.SimpleNamespace(DownloadError=RuntimeError)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    ytdlp_common.extract_info(VIDEO, {}, process=False)
    ytdlp_common.extract_info(VIDEO, {}, download=True)
    assert seen == [True, False]


def test_no_refresh_for_other_sites_or_without_the_browser(monkeypatch, tmp_path):
    calls = _count_refreshes(monkeypatch)
    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", lambda path: _signed_in_cookies())

    _use_dedicated_browser(monkeypatch, tmp_path)
    with ytdlp_common._youtube_browser_cookies("https://www.twitch.tv/videos/123"):
        pass
    monkeypatch.delenv("SOLARIS_STUDIO_YOUTUBE_BROWSER")
    with ytdlp_common._youtube_browser_cookies(VIDEO) as options:
        assert options == {}
    assert calls == []


def test_a_refresh_failure_still_exports_the_cookies_and_never_prints_them(
    monkeypatch, tmp_path, devtools, capsys
):
    _use_dedicated_browser(monkeypatch, tmp_path)

    class RefusingBrowser(FakeBrowser):
        def send(self, payload):
            message = json.loads(payload)
            if message["method"] == "Page.reload":
                self.sent.append(message)
                self.pending.append({"id": message["id"], "error": {"message": SECRET}})
                return
            super().send(payload)

    devtools(
        RefusingBrowser([{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}])
    )
    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", lambda path: _signed_in_cookies())

    with ytdlp_common._youtube_browser_cookies(VIDEO) as options:
        exported = Path(options["cookiefile"]).read_text(encoding="utf-8")
        assert SECRET in exported
    out = capsys.readouterr().out
    assert "WARNING: Could not refresh YouTube" in out
    assert SECRET not in out


def test_the_whole_download_path_prints_no_cookie_value(
    monkeypatch, tmp_path, devtools, capsys
):
    """End to end through the fake socket: refresh, read, export, yt-dlp."""
    _use_dedicated_browser(monkeypatch, tmp_path)
    browser = devtools(
        FakeBrowser([{"type": "page", "targetId": "yt", "url": "https://www.youtube.com/"}])
    )
    original_send = browser.send

    def send_with_cookies(payload):
        original_send(payload)
        message = json.loads(payload)
        if message["method"] == "Network.getAllCookies":
            browser.pending[-1]["result"] = {"cookies": _signed_in_cookies()}

    browser.send = send_with_cookies
    monkeypatch.setattr(ytdlp_common, "_ipv4_only", False)
    captured = []

    class FakeYoutubeDL:
        def __init__(self, options):
            captured.append(Path(options["cookiefile"]).read_text(encoding="utf-8"))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def extract_info(self, *_args, **_kwargs):
            return {"id": "aB3dEfGhIjK"}

    fake_yt_dlp = types.ModuleType("yt_dlp")
    fake_yt_dlp.YoutubeDL = FakeYoutubeDL
    fake_yt_dlp.utils = types.SimpleNamespace(DownloadError=RuntimeError)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    assert ytdlp_common.extract_info(VIDEO, {}) == {"id": "aB3dEfGhIjK"}
    assert SECRET in captured[0]
    assert "Page.reload" in browser.methods()
    assert SECRET not in capsys.readouterr().out


def test_extract_info_retries_do_not_refresh_again(monkeypatch, tmp_path):
    """The bot check on the first ask makes extract_info ask again (over IPv4);
    that's the same download, so the page isn't reloaded a second time."""
    _use_dedicated_browser(monkeypatch, tmp_path)
    calls = _count_refreshes(monkeypatch)
    monkeypatch.setattr(ytdlp_common, "_read_browser_cookies", lambda path: _signed_in_cookies())
    monkeypatch.setattr(ytdlp_common, "_ipv4_only", False)
    asked = []

    class DownloadError(Exception):
        pass

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def extract_info(self, *_args, **_kwargs):
            asked.append(self.options.get("source_address"))
            if len(asked) == 1:
                raise DownloadError("ERROR: [youtube] aB3dEfGhIjK: Sign in to confirm you're not a bot.")
            return {"id": "aB3dEfGhIjK"}

    fake_yt_dlp = types.ModuleType("yt_dlp")
    fake_yt_dlp.YoutubeDL = FakeYoutubeDL
    fake_yt_dlp.utils = types.SimpleNamespace(DownloadError=DownloadError)
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    ytdlp_common.extract_info(VIDEO, {})
    assert asked == [None, "0.0.0.0"]
    assert calls == [VIDEO]

    # A later download of another video does refresh.
    ytdlp_common.extract_info(OTHER_VIDEO, {})
    assert calls == [VIDEO, OTHER_VIDEO]
