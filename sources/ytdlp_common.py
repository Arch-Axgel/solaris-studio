"""Shared yt-dlp behavior for all sources: live download progress + cancel,
parallel fragment fetching, and pointing yt-dlp at the bundled FFmpeg.

Without a progress hook the UI's bar sits still during a long VOD download
(the "stuck at 3%" feeling). This emits real percent as bytes arrive and
aborts promptly if the video is cancelled.
"""

import os
import re
import shutil
import http.cookiejar
import json
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from urllib.parse import urlparse

from core import cancel, progress
from core.binaries import ffmpeg


def _ffmpeg_dir() -> str | None:
    """The folder holding ffmpeg and ffprobe, for yt-dlp's own use.

    yt-dlp does not call core.binaries — it looks for ffmpeg on PATH itself,
    and merging separate video and audio streams is the one thing it cannot do
    without one. A developer's machine has ffmpeg on PATH, so this is invisible
    there. An installed copy does not, and every download that needs merging
    dies with "ffmpeg is not installed" — which is most YouTube downloads,
    because the good video and the good audio arrive as separate streams.

    Returns None when nothing resolved, leaving yt-dlp to search PATH exactly
    as before rather than handing it a path that isn't there.
    """
    resolved = ffmpeg()
    if resolved == "ffmpeg" or not Path(resolved).exists():
        return None
    return str(Path(resolved).parent)


# What YouTube answers when it takes a connection for a bot ("Sign in to
# confirm you're not a bot"). It goes by the address the request comes from,
# and a PC on both IPv4 and IPv6 has two: refused over one, the same video
# is served over the other a second later.
_BOT_CHECK = "not a bot"
_IPV4 = "0.0.0.0"       # yt-dlp's --force-ipv4
# Set once a request only got through over IPv4. The rest of the session's
# YouTube requests start there, rather than being refused again at every step
# of a video.
_ipv4_only = False
# Only YouTube answers like this. A Twitch or Kick link is asked for the way
# it always was, whatever YouTube has been doing.
_YOUTUBE = re.compile(r"(?:^|//|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:[/:?#]|$)", re.I)


class _DevToolsError(RuntimeError):
    pass


# The longest one DevTools command may take, events in between included.
_DEVTOOLS_COMMAND_TIMEOUT = 8.0


def _devtools_endpoint(user_data_dir: Path) -> str:
    """The dedicated browser's loopback DevTools websocket URL.

    Chromium writes the port it picked (--remote-debugging-port=0) and the
    browser websocket path into DevToolsActivePort. Anything that doesn't look
    like that file is refused rather than connected to.
    """
    active_port = user_data_dir / "DevToolsActivePort"
    lines = active_port.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2:
        raise ValueError("the browser's DevTools port file is incomplete")
    port = int(lines[0])
    websocket_path = lines[1]
    if not 1 <= port <= 65535 or not websocket_path.startswith("/devtools/browser/"):
        raise ValueError("the browser's DevTools endpoint is invalid")
    return f"ws://127.0.0.1:{port}{websocket_path}"


def _devtools_connect(user_data_dir: Path):
    # Imported here, not at the top: the engine runs (and CI tests) without
    # websockets until a YouTube download actually needs the browser.
    from websockets.sync.client import connect

    return connect(
        _devtools_endpoint(user_data_dir),
        open_timeout=3,
        close_timeout=1,
        max_size=10 * 1024 * 1024,
        # Loopback only: a system proxy must never see the DevTools socket.
        proxy=None,
    )


def _devtools_request(
    ws,
    command_id: int,
    method: str,
    params: dict | None = None,
    session_id=None,
    on_event=None,
) -> dict:
    """Send one CDP command and wait for its answer.

    Events arrive on the same socket in between (Page.loadEventFired can even
    beat the Page.reload answer), so anything that isn't the answer is handed
    to `on_event` instead of being dropped.
    """
    message = {"id": command_id, "method": method}
    if params is not None:
        message["params"] = params
    if session_id is not None:
        message["sessionId"] = session_id
    ws.send(json.dumps(message))
    # Each recv is bounded, and so is the whole wait: a page that keeps
    # firing events (with Page enabled, a busy YouTube tab does) would
    # otherwise keep this loop alive forever without the answer ever coming.
    deadline = time.monotonic() + _DEVTOOLS_COMMAND_TIMEOUT
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"browser didn't answer {method}")
        response = json.loads(ws.recv(timeout=min(5.0, remaining)))
        if not isinstance(response, dict):
            raise _DevToolsError("browser returned an invalid DevTools message")
        if response.get("id") != command_id:
            if on_event is not None and "method" in response:
                on_event(response)
            continue
        if "error" in response:
            raise _DevToolsError(f"browser rejected {method}")
        result = response.get("result")
        if not isinstance(result, dict):
            raise _DevToolsError(f"browser returned an invalid result for {method}")
        return result


def _read_browser_cookies(user_data_dir: Path) -> list[dict]:
    from websockets.exceptions import WebSocketException

    request = _devtools_request
    try:
        with _devtools_connect(user_data_dir) as ws:
            targets = request(ws, 1, "Target.getTargets").get("targetInfos")
            if not isinstance(targets, list):
                raise _DevToolsError("browser returned an invalid target list")
            # Same choice as the refresh: a web page before Edge's internal
            # ones, so both talk to the tab that was just reloaded.
            page = _pick_page(targets)
            if page is None:
                # In the background, like the refresh's: a new tab must not
                # jump in front of whatever the user is doing.
                page = request(
                    ws,
                    2,
                    "Target.createTarget",
                    {"url": "https://www.youtube.com/", "background": True},
                )
                attach_id = 3
            else:
                attach_id = 2
            target_id = page.get("targetId")
            if not isinstance(target_id, str):
                raise _DevToolsError("browser returned an invalid page target")
            session_id = request(
                ws,
                attach_id,
                "Target.attachToTarget",
                {"targetId": target_id, "flatten": True},
            ).get("sessionId")
            if not isinstance(session_id, str):
                raise _DevToolsError("browser didn't attach a page session")
            cookies = request(
                ws,
                attach_id + 1,
                "Network.getAllCookies",
                session_id=session_id,
            ).get("cookies")
            if not isinstance(cookies, list):
                raise _DevToolsError("browser returned an invalid cookie list")
            return cookies
    except (OSError, TimeoutError, ValueError, json.JSONDecodeError, WebSocketException) as error:
        raise _DevToolsError(f"could not read the browser cookies ({type(error).__name__})") from error


# ---- refreshing the YouTube page before a download ---------------------------------
#
# Google rotates the session cookies (__Secure-*PSIDTS and friends) while the
# signed-in page is in use. A browser left minimized for hours still holds the
# old ones, and yt-dlp handed stale cookies gets the bot check anyway.
# Reloading YouTube in the dedicated browser just before reading its cookies
# lets the page rotate them first. Once per download is enough: yt-dlp is
# asked more than once per video (the IPv4 fallback, the second ask), and
# reloading for each ask would only make the page churn.

_YOUTUBE_HOME = "https://www.youtube.com/"
_REFRESH_LOAD_TIMEOUT = 12.0    # seconds to wait for Page.loadEventFired
_REFRESH_SETTLE = 1.5           # seconds for the page's cookie rotation to land
_REFRESH_INTERVAL = 120.0       # the same video asked again after this long refreshes again
_REFRESH_AFTER_COMMIT = 4.0     # once the reload has committed, wait at most this much longer
# Metadata-only reads (the channel watcher's listing and readiness checks,
# the VOD finder) run on a timer, several per poll. Reloading for each would
# reload the browser every poll for as long as a stream is pending; they only
# refresh when nothing has refreshed the page for this long.
_BACKGROUND_REFRESH_INTERVAL = 600.0
_VIDEO_ID = re.compile(
    r"(?:[?&]v=|youtu\.be/|/(?:shorts|live|embed|v)/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])"
)
_clock = time.monotonic         # module-level so tests can move time on
_refresh_lock = threading.Lock()
# key -> when it was last refreshed for. A dict, not just the last key, so
# two downloads running side by side (A's probe, B's probe, A's download,
# B's download) don't take turns reloading the page for each other.
_refreshed: dict[str, float] = {}
_last_any_refresh_at: float | None = None
# The reload under way, if any. There is one browser tab, so there is only
# ever one reload: anything asking meanwhile waits for it and reads the
# cookies it rotated, rather than reloading under it.
_refreshing: threading.Event | None = None


def _refresh_key(url: str) -> str:
    """One key per video: the watch, shorts, youtu.be and embed links of the
    same video (or the same link with a different &t=) are one download."""
    match = _VIDEO_ID.search(url)
    return match.group(1) if match else url.strip()


def _is_youtube_page(page_url) -> bool:
    if not isinstance(page_url, str):
        return False
    host = (urlparse(page_url).hostname or "").lower()
    return host == "youtube.com" or host.endswith(".youtube.com")


# Google's sign-in flow: the form itself, and the "simplify your sign-in" /
# recovery-info interstitials it can stop on before handing back to YouTube.
_SIGN_IN_HOSTS = ("accounts.google.com", "gds.google.com")


def _is_sign_in_page(page_url) -> bool:
    if not isinstance(page_url, str):
        return False
    return (urlparse(page_url).hostname or "").lower() in _SIGN_IN_HOSTS


def _pick_page(targets: list) -> dict | None:
    """The tab to refresh: a real web page first. Edge also lists internal
    'page' targets (edge://sync-confirmation-dialog/ and the like) that have
    no window and can't be reloaded usefully."""
    pages = [target for target in targets if isinstance(target, dict) and target.get("type") == "page"]
    web = [page for page in pages if str(page.get("url", "")).startswith(("http://", "https://"))]
    return (web or pages or [None])[0]


def _refresh_youtube_page(user_data_dir: Path, url: str) -> None:
    """Reload (or open) YouTube in the dedicated browser and wait for it.

    `url` is the video about to be downloaded. It isn't opened: the page
    reloaded is whatever YouTube page is already there, or YouTube's home
    page. Raises _DevToolsError on any DevTools problem; a page that is merely
    slow to load is a warning, not an error. Touches no cookies.
    """
    from websockets.exceptions import WebSocketException

    loaded = threading.Event()
    committed = threading.Event()
    session: dict = {}
    ids = iter(range(1, 1000))

    def on_event(event: dict) -> None:
        # Flattened sessions tag their events; only our tab's load counts.
        if event.get("sessionId") not in (None, session.get("id")):
            return
        method = event.get("method")
        if method == "Page.loadEventFired":
            loaded.set()
        elif method == "Page.frameNavigated":
            frame = (event.get("params") or {}).get("frame") or {}
            # The main frame (no parent) committing means the response, and
            # the Set-Cookie headers on it, have arrived.
            if isinstance(frame, dict) and not frame.get("parentId"):
                committed.set()

    request = _devtools_request
    try:
        with _devtools_connect(user_data_dir) as ws:
            targets = request(ws, next(ids), "Target.getTargets").get("targetInfos")
            if not isinstance(targets, list):
                raise _DevToolsError("browser returned an invalid target list")
            page = _pick_page(targets)
            if page is not None and _is_sign_in_page(page.get("url")):
                # The user is signing in in that tab right now (the app's
                # connect flow); reloading would throw away what they typed.
                # The cookies are read as they are.
                return
            created = page is None
            if created:
                # Every tab was closed: open YouTube again, in the background
                # so the browser doesn't jump over whatever the user is doing.
                page = request(
                    ws,
                    next(ids),
                    "Target.createTarget",
                    {"url": _YOUTUBE_HOME, "background": True},
                )
            target_id = page.get("targetId")
            if not isinstance(target_id, str):
                raise _DevToolsError("browser returned an invalid page target")
            session_id = request(
                ws,
                next(ids),
                "Target.attachToTarget",
                {"targetId": target_id, "flatten": True},
            ).get("sessionId")
            if not isinstance(session_id, str):
                raise _DevToolsError("browser didn't attach a page session")
            session["id"] = session_id
            # Page events only flow once the domain is enabled on the session.
            request(ws, next(ids), "Page.enable", session_id=session_id, on_event=on_event)
            loaded.clear()      # a load from before we asked doesn't count
            committed.clear()
            if created or not _is_youtube_page(page.get("url")):
                # A fresh tab may still be on about:blank, and a tab left on a
                # Google account page wouldn't rotate YouTube's cookies: go to
                # YouTube itself.
                navigated = request(
                    ws,
                    next(ids),
                    "Page.navigate",
                    {"url": _YOUTUBE_HOME},
                    session_id=session_id,
                    on_event=on_event,
                )
                if navigated.get("errorText"):
                    # Offline or blocked: no load event is coming, so don't
                    # sit out the whole timeout waiting for one. errorText is
                    # a net:: code, never page or cookie content.
                    raise _DevToolsError(f"YouTube didn't load ({navigated['errorText']})")
            else:
                request(
                    ws,
                    next(ids),
                    "Page.reload",
                    session_id=session_id,
                    on_event=on_event,
                )

            deadline = _clock() + _REFRESH_LOAD_TIMEOUT
            commit_seen = False
            while not loaded.is_set():
                if committed.is_set() and not commit_seen:
                    # YouTube's load event can take far longer than the
                    # timeout (the page keeps streaming), but the fresh
                    # cookies come with the response, so a committed reload
                    # only gets a short grace period.
                    commit_seen = True
                    deadline = min(deadline, _clock() + _REFRESH_AFTER_COMMIT)
                remaining = deadline - _clock()
                if remaining <= 0:
                    break
                try:
                    message = json.loads(ws.recv(timeout=min(remaining, 1.0)))
                except TimeoutError:
                    continue
                if isinstance(message, dict) and "method" in message:
                    on_event(message)
            if not loaded.is_set() and not committed.is_set():
                # A slow page still holds the session it had; its cookies are
                # read as they are rather than failing the download.
                print(
                    "WARNING: The YouTube page in the dedicated browser didn't finish "
                    f"loading within {_REFRESH_LOAD_TIMEOUT:g} s; using its cookies as they are."
                )
    except (OSError, ValueError, json.JSONDecodeError, WebSocketException) as error:
        # TimeoutError (a command that never answered) is an OSError.
        raise _DevToolsError(f"could not refresh the YouTube page ({type(error).__name__})") from error
    # The load event fires before the page's scripts have rotated the session
    # cookies; give them a moment so the export gets the new ones.
    time.sleep(_REFRESH_SETTLE)


def _refresh_once_per_download(user_data_dir: Path, url: str, *, background: bool = False) -> None:
    """Refresh the page unless it was just refreshed for this same video.

    Thread-safe, because downloads run concurrently. Each new video gets its
    own reload, but only one reload runs at a time: anything that asks while
    one is under way (the same video twice, or two videos started together)
    waits for it and uses the cookies it rotated. A failed refresh still
    counts, so a broken browser costs one warning per download, not one per
    yt-dlp retry. `background` marks a metadata-only read on a timer (see
    _BACKGROUND_REFRESH_INTERVAL). Never raises.
    """
    global _last_any_refresh_at, _refreshing
    key = _refresh_key(url)
    with _refresh_lock:
        now = _clock()
        for old in [k for k, at in _refreshed.items() if now - at > _REFRESH_INTERVAL]:
            del _refreshed[old]     # downloads come and go; don't grow forever
        waiter = _refreshing
        if waiter is not None:
            # A reload is running right now; it serves this download too.
            _refreshed[key] = now
        elif key in _refreshed:
            return                  # the same download asking again
        elif background and _last_any_refresh_at is not None and (
            now - _last_any_refresh_at <= _BACKGROUND_REFRESH_INTERVAL
        ):
            return
        else:
            in_flight = _refreshing = threading.Event()
            _refreshed[key] = _last_any_refresh_at = now
    if waiter is not None:
        # Bounded: every step of the reload is on a timeout already; this is
        # a backstop so one wedged refresh can't hold every download.
        waiter.wait(_REFRESH_LOAD_TIMEOUT + _REFRESH_SETTLE + 15)
        return
    try:
        _refresh_youtube_page(user_data_dir, url)
    except _DevToolsError as error:
        # These messages are ours and name no cookie.
        print(
            "WARNING: Could not refresh YouTube in the dedicated browser "
            f"({error}); using its cookies as they are."
        )
    except Exception as error:  # a refresh must never fail the download
        print(
            "WARNING: Could not refresh YouTube in the dedicated browser "
            f"({type(error).__name__}); using its cookies as they are."
        )
    finally:
        with _refresh_lock:
            if _refreshing is in_flight:
                _refreshing = None
        in_flight.set()


def _write_youtube_cookiefile(cookies: list[dict], path: Path) -> int:
    jar = http.cookiejar.MozillaCookieJar(str(path))
    count = 0
    for item in cookies:
        domain = item.get("domain")
        name = item.get("name")
        value = item.get("value")
        if not isinstance(domain, str) or not isinstance(name, str) or not isinstance(value, str):
            continue
        domain = domain.lower()
        normalized_domain = domain.lstrip(".")
        if not (
            normalized_domain == "youtube.com"
            or normalized_domain.endswith(".youtube.com")
            or normalized_domain == "google.com"
            or normalized_domain.endswith(".google.com")
        ):
            continue
        if item.get("partitionKey"):
            continue
        expires = item.get("expires")
        expires = int(expires) if isinstance(expires, (int, float)) and expires > 0 else None
        if expires is not None and expires <= int(time.time()):
            continue
        rest = {"HTTPOnly": None} if item.get("httpOnly") else {}
        jar.set_cookie(
            http.cookiejar.Cookie(
                version=0,
                name=name,
                value=value,
                port=None,
                port_specified=False,
                domain=domain,
                domain_specified=domain.startswith("."),
                domain_initial_dot=domain.startswith("."),
                path=item.get("path") if isinstance(item.get("path"), str) else "/",
                path_specified=True,
                secure=bool(item.get("secure")),
                expires=expires,
                discard=expires is None,
                comment=None,
                comment_url=None,
                rest=rest,
                rfc2109=False,
            )
        )
        count += 1
    if count:
        jar.save(ignore_discard=True, ignore_expires=True)
    return count


@contextmanager
def _youtube_browser_cookies(url: str, *, background: bool = False) -> Iterator[dict]:
    """Use the app's dedicated Chromium profile for YouTube only, if signed in.

    Chromium locks its cookie database while open on Windows. Read cookies
    from the dedicated browser's loopback-only DevTools endpoint instead;
    cookie values never leave this process except for yt-dlp's local temp file.
    """
    if not _YOUTUBE.search(url):
        yield {}
        return
    browser = os.environ.get("SOLARIS_STUDIO_YOUTUBE_BROWSER")
    profile = os.environ.get("SOLARIS_STUDIO_YOUTUBE_PROFILE")
    if browser not in ("edge", "chrome") or not profile:
        yield {}
        return

    profile_path = Path(profile)
    user_data_dir = profile_path.parent
    # Let the signed-in page rotate its session cookies before they're read
    # (once per download; see _refresh_once_per_download). Never fatal.
    _refresh_once_per_download(user_data_dir, url, background=background)
    try:
        cookies = _read_browser_cookies(user_data_dir)
    except (OSError, _DevToolsError) as error:
        print(
            "WARNING: Could not read cookies from the dedicated YouTube browser "
            f"({error}); trying without its cookies."
        )
        yield {}
        return
    except Exception as error:
        # Anything else (websockets missing from an odd install, a browser
        # answer shaped unlike any Chromium's) still mustn't fail the
        # download. Only the type is printed: its text could quote a cookie.
        print(
            "WARNING: Could not read cookies from the dedicated YouTube browser "
            f"({type(error).__name__}); trying without its cookies."
        )
        yield {}
        return

    with tempfile.TemporaryDirectory(prefix="solaris-studio-youtube-") as temporary:
        cookiefile = Path(temporary) / "cookies.txt"
        try:
            cookie_count = _write_youtube_cookiefile(cookies, cookiefile)
            export_error = None
        except Exception as error:  # a disk error, or an odd cookie field (expires=inf, say)
            cookie_count = 0
            export_error = error
        if export_error is not None:
            print(
                "WARNING: Could not create the temporary YouTube cookie file "
                f"({type(export_error).__name__}); trying without its cookies."
            )
            yield {}
            return
        if not cookie_count:
            yield {}
            return
        yield {"cookiefile": str(cookiefile)}


def is_bot_check(error) -> bool:
    return _BOT_CHECK in str(error)


# yt-dlp's words when no format survives extraction, which with the format
# selectors used here (each ends in a catch-all) means none was offered at all.
_NO_FORMATS = "Requested format is not available"


def _no_formats(error) -> bool:
    return _NO_FORMATS in str(error)


def _configure_youtube_javascript(options: dict, url: str) -> None:
    if not _YOUTUBE.search(url):
        return

    node_path = os.environ.get("SOLARIS_STUDIO_NODE_RUNTIME") or shutil.which("node")
    if node_path:
        runtimes = dict(options.get("js_runtimes") or {"deno": {}})
        runtimes.setdefault("node", {"path": node_path})
        options["js_runtimes"] = runtimes

    remote_components = list(options.get("remote_components") or [])
    if "ejs:github" not in remote_components:
        remote_components.append("ejs:github")
    options["remote_components"] = remote_components


def extract_info(url: str, opts: dict, *, download: bool = False, process: bool = True):
    """yt-dlp's extract_info with `opts`, asked once more the other way when
    YouTube answers with its bot check: over IPv4 after an ordinary request,
    and an ordinary one after IPv4.

    A request that works is made once. Any other failure, and a second
    refusal, is raised as it is. If the desktop app's dedicated YouTube
    browser profile is configured, its cookies are read locally for YouTube
    requests only; otherwise the request behavior is unchanged.
    """
    global _ipv4_only
    import yt_dlp

    # Asked as each caller used to ask: `process` only where one turned it off.
    how = {"download": download} if process else {"download": download, "process": False}

    def ask(options: dict):
        effective_options = dict(options)
        if "cookiesfrombrowser" not in effective_options and "cookiefile" not in effective_options:
            # process=False is a metadata-only read (the channel watcher,
            # the VOD finder), not a download: see _BACKGROUND_REFRESH_INTERVAL.
            signed_in_error = None
            with _youtube_browser_cookies(url, background=not process) as cookie_options:
                effective_options.update(cookie_options)
                _configure_youtube_javascript(effective_options, url)
                try:
                    with yt_dlp.YoutubeDL(effective_options) as ydl:
                        return ydl.extract_info(url, **how)
                except yt_dlp.utils.DownloadError as e:
                    if not cookie_options or not _no_formats(e):
                        raise
                    signed_in_error = e
            # Signed in, YouTube answers only through its logged-in player
            # clients, and each of them needs yt-dlp's JavaScript challenge
            # solver. When YouTube changes its player faster than yt-dlp ships
            # a solver for it, every stream of every signed-in client is
            # dropped and nothing is left to pick ("Requested format is not
            # available"), while the anonymous clients still serve the video.
            # One cookie-less attempt keeps downloads working until yt-dlp
            # catches up; if that fails too, the signed-in failure is the one
            # worth reporting.
            print("      (signed-in YouTube offered no playable formats; "
                  "asking again without the burner account's cookies)")
            effective_options = dict(options)
            _configure_youtube_javascript(effective_options, url)
            try:
                with yt_dlp.YoutubeDL(effective_options) as ydl:
                    return ydl.extract_info(url, **how)
            except yt_dlp.utils.DownloadError as e:
                raise signed_in_error from e
        _configure_youtube_javascript(effective_options, url)
        with yt_dlp.YoutubeDL(effective_options) as ydl:
            return ydl.extract_info(url, **how)

    if "source_address" in opts or not _YOUTUBE.search(url):
        return ask(opts)        # an address the caller chose, or not YouTube: as it always was
    ipv4 = {**opts, "source_address": _IPV4}
    first, other = (ipv4, opts) if _ipv4_only else (opts, ipv4)
    try:
        return ask(first)
    except yt_dlp.utils.DownloadError as e:
        # Starting on IPv4 is a habit of this session, not a need: after a
        # failure of any kind the next request starts the ordinary way.
        _ipv4_only = False
        if not is_bot_check(e):
            raise
        refused = e
    try:
        info = ask(other)
    except yt_dlp.utils.DownloadError as e:
        if is_bot_check(e):
            raise
        # The other way failed for a reason of its own (no such route, a
        # timeout). The refusal is what stands in the way, and what is said.
        raise refused from e
    # yt-dlp has already printed its refusal, cookie advice and all: say what
    # became of it, so the log does not read as a failure.
    print("      (YouTube took the request for a bot; asked again "
          f"{'over IPv4' if other is ipv4 else 'the ordinary way'} and was served)")
    _ipv4_only = other is ipv4
    return info


def progress_opts(video_id: str | None) -> dict:
    def hook(d: dict) -> None:
        if video_id and cancel.is_cancelled(video_id):
            raise cancel.CancelledError(video_id)  # aborts the yt-dlp download
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes")
            if total and done:
                progress.emit(
                    stage="download",
                    fraction=min(1.0, done / total),
                    video_id=video_id,
                    downloaded=done,
                    total=total,
                )

    opts = {
        "progress_hooks": [hook],
        # VODs are HLS: thousands of small fragments. Fetching them one at a
        # time leaves most of the connection idle — parallel fragments cut
        # download time by 2-4x on long streams.
        "concurrent_fragment_downloads": 6,
        # Long downloads WILL hit a slow or dropped fragment. Without retries a
        # single "Read timed out" or transient 403 kills the whole job after
        # minutes of progress. Retry the fragment instead, and cap how long we
        # wait on a stalled socket so a dead connection fails fast enough to
        # retry rather than hanging.
        "retries": 10,
        "fragment_retries": 10,
        "socket_timeout": 30,
        # Pull large (non-fragmented) streams in 10 MB HTTP range chunks. A
        # 900 MB YouTube DASH stream is otherwise one long GET, and a single
        # stall late in it ("Read timed out" against googlevideo) throws away
        # the whole transfer. Chunked, a timeout loses only the current 10 MB
        # and retries just that — which is what makes the retries above
        # actually recover a big download instead of restarting it.
        "http_chunk_size": 10 * 1024 * 1024,
        # A retry immediately after a 403/timeout usually hits the same wall;
        # a short backoff lets throttling clear. Capped so we don't stall.
        "retry_sleep_functions": {
            "http": lambda n: min(5, 2 ** n),
            "fragment": lambda n: min(5, 2 ** n),
        },
    }

    # Only set when we actually have one, so a checkout with ffmpeg on PATH
    # keeps working the way it always did.
    #
    # This is what separates Twitch from YouTube on a clean install: a Twitch
    # VOD is one already-muxed HLS stream and needs no merge, while YouTube
    # serves video and audio separately and cannot be assembled without
    # ffmpeg. Miss this and half the sources look fine while the biggest one
    # fails on every single video.
    ffmpeg_dir = _ffmpeg_dir()
    if ffmpeg_dir:
        opts["ffmpeg_location"] = ffmpeg_dir

    return opts


# YouTube's broad categories, which say nothing about which game it is.
_NOT_A_GAME = {"gaming", "entertainment", "people & blogs", "comedy", "education",
               "howto & style", "music", "news & politics", "science & technology",
               "sports", "film & animation", "autos & vehicles", "travel & events",
               "pets & animals", "nonprofits & activism"}


def games_from_info(info: dict | None, platform: str) -> list[dict]:
    """The game(s) a video shows, from yt-dlp's metadata, for the gaming
    profile: [{"name", "start", "end"}], plus "hint" text when the platform
    only says "Gaming" (a YouTube video's tags often name the game).

    Twitch: its chapters are the stream's game changes, each a game's name
    over a time range (or one game for the whole VOD). Kick: the category.
    YouTube: chapters are the creator's own titles, not games, so only the
    tags go in, and only when the video is in the Gaming category."""
    if not info:
        return []
    duration = float(info.get("duration") or 0)
    games: list[dict] = []
    if platform == "twitch":
        for ch in info.get("chapters") or []:
            name = str(ch.get("title") or "").strip()
            if name:
                games.append({"name": name, "start": float(ch.get("start_time") or 0),
                              "end": float(ch.get("end_time") or duration)})
    if not games and platform in ("twitch", "kick"):
        for cat in info.get("categories") or []:
            name = str(cat or "").strip()
            if name and name.lower() not in _NOT_A_GAME:
                games.append({"name": name, "start": 0.0, "end": duration})
    if not games and platform == "youtube":
        cats = [str(x).lower() for x in info.get("categories") or []]
        if "gaming" in cats:
            tags = " ".join(str(t) for t in (info.get("tags") or [])[:25])
            games.append({"name": "", "start": 0.0, "end": duration, "hint": tags})
    return games


# ---- which yt-dlp this copy of the app is running ---------------------------
#
# Twitch, Kick and YouTube change something regularly, and yt-dlp fixes it
# within days — but the copy inside Solaris Studio is frozen at build time
# (solaris-studio.spec collects yt_dlp into the installer), so an installed app
# can be carrying an extractor that was fixed upstream last week. The gap
# shows up as a download that stopped working, and the failure itself never
# says which yt-dlp produced it: the version is the first thing needed to
# triage a report, so it travels with the failure. Issue #39, and the
# user-facing note in KNOWN-ISSUES.md.

_version: str | None = None


def installed_version() -> str:
    """The yt-dlp this process is actually running: the bundled one in an
    installed build, and site-packages in a checkout. Either way it is the same
    import, and the same one `server/feedback.py` puts in a report.

    Read once and cached. "unknown" when it cannot be read at all: this is
    called from an error path, and a diagnostic is not worth raising a second
    exception over.
    """
    global _version
    if _version is None:
        try:
            from yt_dlp.version import __version__

            _version = str(__version__)
        except Exception:
            _version = "unknown"
    return _version


# The words yt-dlp uses when the site changed under the extractor, rather than
# the network or the account failing. "Confirm you are on the latest version"
# is yt-dlp's own hint, printed with exactly these errors, which makes it the
# strongest evidence available that this copy is the old one.
_EXTRACTOR_SIGNS = (
    "unable to extract",
    "no video formats found",
    "unsupported url",
    "nsig extraction failed",
    "confirm you are on the latest version",
)

# Reaching the site failed. A newer yt-dlp would not have helped, so it must
# not be suggested: pointing someone at a version when their connection is the
# problem only moves them further from the answer.
_NETWORK_SIGNS = (
    "timed out", "timeout", "connection refused", "connection reset",
    "connection aborted", "temporary failure in name resolution", "getaddrinfo",
    "network is unreachable", "no route to host", "incomplete read",
    "unable to download webpage", "http error 5",
)

# The video's own access rules: signed-in, members-only, geo-blocked. Also not
# a version problem, and also not something a re-download fixes.
_ACCESS_SIGNS = (
    "sign in", "not a bot", "cookies", "login required", "private video",
    "video unavailable", "has been removed", "members-only", "members only",
    "join this channel", "age-restricted", "confirm your age", "premieres in",
    "forbidden", "unauthorized", "http error 401", "http error 403",
    "not available in your country", "unavailable in your country",
)

_RELEASES = "https://github.com/yt-dlp/yt-dlp/releases"


def failure_note(error: BaseException) -> str | None:
    """One line to add to a download failure, or None to leave it exactly as
    it is.

    None for a cancellation (nothing failed) and for anything the source
    modules have already put into the app's own words — every one of those
    raises ValueError (`youtube._friendly_errors`, `kick._gone_or_raise`: an
    age-gated video, a deleted Kick VOD, a live stream, a link for the wrong
    platform). Those already say what happened, and a version appended to them
    reads as noise.

    What is left is yt-dlp's own text, which is where the version earns its
    place: it is not in the message, it is the first thing a maintainer needs,
    and someone reporting "Kick stopped working" can now paste it. A newer
    version is named only when the failure has the shape of a site change;
    otherwise the version is given as context and nothing is claimed about the
    cause. See tests/test_ytdlp_failure_diagnostics.py.

    Nothing from `error` is copied into the note, so this cannot put a cookie
    or a private URL back into a message the job layer scrubbed on the way
    out (server/jobs.py).
    """
    if isinstance(error, (cancel.CancelledError, ValueError)):
        return None
    text = str(error).lower()
    version = installed_version()
    if any(sign in text for sign in _EXTRACTOR_SIGNS):
        return (
            f"Solaris Studio's bundled yt-dlp is {version}. This reads like a change on the "
            f"site, which yt-dlp fixes within days — but the copy inside the app is fixed "
            f"at build time, so a newer yt-dlp may already have the fix: {_RELEASES}"
        )
    if any(sign in text for sign in _NETWORK_SIGNS):
        return (
            f"Solaris Studio's bundled yt-dlp is {version}. This reads as the connection "
            f"failing rather than the app or the link, so a newer yt-dlp is very unlikely "
            f"to change it."
        )
    if any(sign in text for sign in _ACCESS_SIGNS):
        return (
            f"Solaris Studio's bundled yt-dlp is {version}. This reads as the video's own "
            f"access rules rather than the app, so a newer yt-dlp is very unlikely to "
            f"change it."
        )
    return f"Solaris Studio's bundled yt-dlp is {version}."
