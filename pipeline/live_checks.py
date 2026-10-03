"""Live incident checks for the webcam: the candidate checks over a rolling window.

live_server.py feeds every labeled frame (same row shape as tracks.json) plus its JPEG. Once
a second the window's last WINDOW_SEC seconds go through candidates.py's checks. A new
candidate waits POST_SEC so its clip shows what happened next, then the buffered frames are
written as the evidence clip and a worker thread sends it to the verifier and appends the
result to the incident ledger. Labeling never waits on the verifier.

Times are seconds since the webcam session started. The live labeler runs a pose model,
which detects people only, so the near-miss check has no vehicles to work with here.

Person down comes from the labeler's per-person posture instead of candidates.py's box-shape
checks: a webcam usually frames head and shoulders, a box wider than tall even when sitting
up, so those checks would flag anyone sitting still in front of it.

The webcam's zone, restricted polygons (normalized, unmirrored frame coordinates), and
threshold overrides are in pipeline/config/live.json.
"""

from __future__ import annotations

import json
import math
import queue
import threading
import time
from collections import deque

import cv2
import numpy as np

from candidates import DEFAULTS, _by_track, _runs, _ts, _window, check_near_miss, check_restricted_zone, merge
from media import VideoWriter
from run_all import STATUS, to_incident
from schema import CLIPS_DIR, ROOT, Candidate, Incident, load_config, read_ledger, write_ledger
from verify import resolve_backend, verify_clip

LIVE_CONFIG_PATH = ROOT / "pipeline" / "config" / "live.json"
WINDOW_SEC = 20.0
CHECK_EVERY_SEC = 1.0
MIN_WINDOW_SEC = 4.0
POST_SEC = 3.0
# A same-type candidate starting this soon after the last one ended is the same event.
COOLDOWN_SEC = 8.0
CLIP_HEIGHT = 480
# The verifier samples clips at COSMOS_FPS (4) and rejects anything slower, while the webcam
# loop often labels only 1-2 frames a second, so clips repeat frames up to this rate.
CLIP_FPS = 10.0
MAX_EVENTS = 8

_ledger_lock = threading.Lock()


def load_live_camera() -> dict:
    cam = json.loads(LIVE_CONFIG_PATH.read_text())
    cam.setdefault("videoFile", "webcam-live")
    cam.setdefault("sourceType", "team_recorded")
    cam.setdefault("restrictedPolygons", [])
    return cam


def write_clip(frames: list[tuple[float, bytes]], out) -> float:
    """Encode buffered JPEG frames as a browser-playable mp4 at CLIP_FPS, in real time: each
    output frame shows the latest webcam frame at that moment."""
    first = cv2.imdecode(np.frombuffer(frames[0][1], np.uint8), cv2.IMREAD_COLOR)
    h, w = first.shape[:2]
    height = min(CLIP_HEIGHT, h) // 2 * 2
    width = round(w * height / h) // 2 * 2
    t0, span = frames[0][0], frames[-1][0] - frames[0][0]
    writer = VideoWriter(out, width, height, CLIP_FPS)
    i, img = -1, None
    try:
        for k in range(max(1, math.ceil(span * CLIP_FPS)) + 1):
            t, prev = t0 + k / CLIP_FPS, i
            while i + 1 < len(frames) and frames[i + 1][0] <= t + 1e-6:
                i += 1
            if i != prev:
                decoded = cv2.imdecode(np.frombuffer(frames[i][1], np.uint8), cv2.IMREAD_COLOR)
                if decoded is not None:
                    img = cv2.resize(decoded, (width, height))
            if img is not None:
                writer.write(img)
    finally:
        writer.close()
    return span


def check_posture_down(cam: dict, data: dict, th: dict) -> list[Candidate]:
    """A tracked person whose live posture stays "down" for lying_min_sec."""
    out = []
    for tid, samples in _by_track(data["frames"]).items():
        times = [t for t, _ in samples]
        mask = [b.get("posture") == "down" for _, b in samples]
        for start, end in _runs(mask, times, min_len=th["lying_min_sec"]):
            s, e = _window(start, end, data["durationSec"], pre=2, post=2, max_len=th["max_clip_sec"])
            out.append(Candidate(
                camera_id=cam["id"], event_type="person_down_or_inactivity", start_sec=s, end_sec=e,
                priority="high",
                observations=[
                    f"pose of tracked person #{tid} read as down from {_ts(start)} for {end - start:.1f}s "
                    f"(head dropped toward the shoulder line, shoulders rolled, or torso near horizontal)",
                ],
                signals={"downSec": round(end - start, 2)},
                track_ids=[tid],
            ))
    return out


def append_incident(incident: Incident) -> None:
    with _ledger_lock:
        rows = [Incident(**r) for r in read_ledger() if r["id"] != incident.id]
        write_ledger(rows + [incident])


class LiveMonitor:
    def __init__(self) -> None:
        self.cam = load_live_camera()
        self.th = {**DEFAULTS, **self.cam.get("thresholds", {})}
        self.venue_id = load_config()["venueId"]
        self.backend = resolve_backend()
        self.buffer: deque[tuple[float, bytes, dict]] = deque()
        self.pending: list[tuple[str, Candidate]] = []
        self.recent: list[Candidate] = []
        self.last_check = float("-inf")
        self._events: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._jobs: queue.Queue = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def flush(self) -> None:
        """Send pending candidates now with whatever aftermath is buffered (stream stopped)."""
        for incident_id, c in list(self.pending):
            self.pending.remove((incident_id, c))
            if self.buffer:
                c.end_sec = round(min(c.end_sec, self.buffer[-1][0]), 2)
            self._send(incident_id, c)

    def reset(self) -> None:
        self.flush()
        self.buffer.clear()
        self.pending.clear()
        self.recent.clear()
        self.last_check = float("-inf")

    def add(self, t: float, jpeg: bytes, row: dict) -> None:
        self.buffer.append((t, jpeg, row))
        keep_from = min([t - WINDOW_SEC] + [c.start_sec for _, c in self.pending])
        while self.buffer and self.buffer[0][0] < keep_from:
            self.buffer.popleft()
        if t - self.last_check >= CHECK_EVERY_SEC:
            self.last_check = t
            self._check(t)
        self._dispatch(t)

    def events(self) -> list[dict]:
        with self._lock:
            return list(self._events.values())[-MAX_EVENTS:]

    def _check(self, now: float) -> None:
        rows = [r for tt, _, r in self.buffer if tt >= now - WINDOW_SEC]
        if len(rows) < 5 or rows[-1]["t"] - rows[0]["t"] < MIN_WINDOW_SEC:
            return
        fps = (len(rows) - 1) / (rows[-1]["t"] - rows[0]["t"])
        data = {"fps": fps, "durationSec": rows[-1]["t"], "frames": rows}
        found = (check_restricted_zone(self.cam, data, self.th) + check_near_miss(self.cam, data, self.th)
                 + check_posture_down(self.cam, data, self.th))
        for c in merge(found, self.th["merge_gap_sec"]):
            if any(r.event_type == c.event_type and c.start_sec <= r.end_sec + COOLDOWN_SEC for r in self.recent):
                continue
            end = max(c.end_sec, now + POST_SEC)
            c.start_sec, c.end_sec = round(max(c.start_sec, end - self.th["max_clip_sec"]), 2), round(end, 2)
            incident_id = f"{self.cam['id']}-{c.event_type}-{int(time.time())}"
            self.recent.append(c)
            self.pending.append((incident_id, c))
            self._set(incident_id, c, "recording")
            print(f"[live] {incident_id}: candidate {c.start_sec:.1f}-{c.end_sec:.1f}s", flush=True)

    def _dispatch(self, now: float) -> None:
        for item in [p for p in self.pending if now >= p[1].end_sec]:
            self.pending.remove(item)
            self._send(*item)

    def _send(self, incident_id: str, c: Candidate) -> None:
        frames = [(t, jpeg) for t, jpeg, _ in self.buffer if c.start_sec <= t <= c.end_sec]
        if len(frames) < 3:
            self._set(incident_id, c, "error", "too few frames buffered for a clip")
            return
        self._set(incident_id, c, "verifying")
        self._jobs.put((incident_id, c, frames))

    def _worker(self) -> None:
        while True:
            incident_id, c, frames = self._jobs.get()
            try:
                clip = CLIPS_DIR / f"{incident_id}.mp4"
                write_clip(frames, clip)
                verdict = verify_clip(c, self.cam, clip, incident_id, self.backend)
                append_incident(to_incident(c, self.cam, self.venue_id, incident_id, verdict))
                self._set(incident_id, c, STATUS[verdict.decision], verdict.explanation)
                print(f"[live] {incident_id}: {verdict.decision} ({verdict.verifier})", flush=True)
            except Exception as err:
                self._set(incident_id, c, "error", str(err))
                print(f"[live] {incident_id}: failed: {err}", flush=True)

    def _set(self, incident_id: str, c: Candidate, status: str, explanation: str | None = None) -> None:
        with self._lock:
            event = self._events.pop(incident_id, None) or {
                "id": incident_id, "eventType": c.event_type, "priority": c.priority,
            }
            event.update(status=status, startSec=c.start_sec, endSec=c.end_sec)
            if explanation:
                event["explanation"] = explanation
            self._events[incident_id] = event
