"""The direct-YouTube batch plan uses the same jobs as a single upload."""

from datetime import datetime, timedelta, timezone
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.state import StateDB
from server import youtube_api, youtube_service


class _Worker:
    def notify(self):
        pass


def test_youtube_batch_plan_schedules_and_executes_each_clip(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    db_path = data_dir / "state.db"
    seed = StateDB(db_path)
    youtube_service.save_settings(seed, {"enabled": True})
    youtube_service.save_accounts(
        seed,
        [{"id": "channel-1", "title": "My channel", "default": True}],
    )

    clip_ids = []
    for index in range(3):
        video_id = f"video-{index}"
        seed.conn.execute(
            "INSERT INTO videos (video_id, title, channel_name, status, created_at, updated_at) "
            "VALUES (?, ?, 'Creator', 'done', '2026-01-01', '2026-01-01')",
            (video_id, f"Video {index}"),
        )
        path = tmp_path / f"clip-{index}.mp4"
        path.write_bytes(b"video")
        cur = seed.conn.execute(
            "INSERT INTO clips (video_id, start_s, end_s, score, title, description, "
            "hashtags, path, created_at) VALUES (?, 0, 10, 90, ?, 'Description', '[]', ?, "
            "'2026-01-01')",
            (video_id, f"Clip {index}", str(path)),
        )
        clip_ids.append(cur.lastrowid)
    seed.conn.commit()
    seed.close()

    app = FastAPI()
    youtube_api.install(
        app,
        config={},
        db=lambda: StateDB(db_path),
        data_dir=data_dir,
        worker=_Worker(),
        publish_worker=_Worker(),
    )
    client = TestClient(app)

    start_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
    planned = client.post(
        "/publish/plan",
        json={
            "clip_ids": clip_ids,
            "privacy": "unlisted",
            "made_for_kids": False,
            "channel_id": "channel-1",
            "start_at": start_at,
            "per_day": 2,
            "gap_hours": 1,
        },
    )
    assert planned.status_code == 200, planned.text
    items = planned.json()["items"]
    assert [item["title"] for item in items] == ["Clip 0", "Clip 1", "Clip 2"]
    assert all(item["privacy"] == "private" for item in items)
    assert all(item["made_for_kids"] is False for item in items)
    assert all(item["channel_id"] == "channel-1" for item in items)
    moments = [datetime.fromisoformat(item["publish_at"].replace("Z", "+00:00")) for item in items]
    assert moments[1] - moments[0] == timedelta(hours=1)
    assert moments[2].date() > moments[1].date()

    executed = client.post("/publish/plan/execute", json={"items": items})
    assert executed.status_code == 200, executed.text
    assert len(executed.json()["started"]) == 3
    assert not executed.json()["skipped"]

    check = StateDB(db_path)
    jobs = check.conn.execute(
        "SELECT request FROM publish_jobs ORDER BY id"
    ).fetchall()
    requests = [json.loads(row["request"]) for row in jobs]
    assert len(requests) == 3
    assert all(request["channel_id"] == "channel-1" for request in requests)
    assert all(request["made_for_kids"] is False for request in requests)
    assert [request["publish_at"] for request in requests] == [
        item["publish_at"] for item in items
    ]
    check.close()

    for invalid_schedule in ({"per_day": 101}, {"gap_hours": 24}):
        rejected = client.post(
            "/publish/plan",
            json={"clip_ids": clip_ids, **invalid_schedule},
        )
        assert rejected.status_code == 422, rejected.text
