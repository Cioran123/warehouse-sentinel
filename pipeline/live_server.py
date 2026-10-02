"""Live labeling and incident checks for the dashboard's webcam tile.

The browser posts one JPEG frame at a time; each is run through YOLO-pose + ByteTrack (one
pass gives boxes, track IDs, and skeletons) plus optical flow, and the response uses the same
normalized shape as tracks.json, so TrackOverlay draws it unchanged. The client waits for each
response before sending the next frame, so a slow machine drops frames instead of queueing them.

Every frame also goes to live_checks.LiveMonitor, which runs the four candidate checks over
the last 20s and sends each new candidate's clip to the verifier (Cosmos) in the background.
Verified results are appended to the incident ledger; `events` in each response reports
their progress (recording -> verifying -> kept / rejected / candidate, or error).

Each person also gets a posture from pose.torso_tilt (or box shape when the torso is not
visible): "upright", "tilted", or "down". That is a display cue only.

    POST /frame         body: image/jpeg  ->  {"t", "boxes": [{"id", "box", "kp", "posture", ...}],
                                               "flow", "events": [...], "ms"}
    POST /frame?reset=1 same, after clearing track state and the check window (new session)
    POST /stop          stream stopped: verify pending candidates with the frames buffered so far
    GET  /health        {"ok": true, "model": ..., "camera": {...}, "verifier": ...}
    GET  /events        {"events": [...]}  (poll after /stop until the verifier finishes)

Usage:
    python pipeline/live_server.py [--port 8765]

Env: SENTINEL_LIVE_IMGSZ (default 640), SENTINEL_LIVE_CONF (default 0.25), plus
SENTINEL_POSE_MODEL / SENTINEL_TRACKER / SENTINEL_DEVICE as in detect.py and SENTINEL_VERIFIER
as in verify.py. The webcam's zone and restricted polygons are in pipeline/config/live.json.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np

import pose
from detect import DEFAULT_TRACKER, FLOW_WIDTH, device, flow_stats, roi_mask
from live_checks import LiveMonitor
from schema import weights

IMGSZ = int(os.environ.get("SENTINEL_LIVE_IMGSZ", "640"))
CONF = float(os.environ.get("SENTINEL_LIVE_CONF", "0.25"))
MAX_BODY = 8 * 1024 * 1024
DOWN_TILT = 60.0
TILTED_TILT = 35.0
DOWN_ASPECT = 1.2
FULL_FRAME = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]


class Labeler:
    def __init__(self, roi: list[list[float]] | None = None) -> None:
        from ultralytics import YOLO

        self.model = YOLO(weights(pose.POSE_MODEL))
        self.dev = device()
        self.roi = roi or FULL_FRAME
        self.t0: float | None = None
        self.prev_gray: np.ndarray | None = None
        self.prev_t = 0.0
        self.mask: np.ndarray | None = None

    def reset(self) -> None:
        """Start track IDs from scratch without rebuilding the predictor (that costs ~3s)."""
        for tracker in getattr(self.model.predictor, "trackers", None) or []:
            tracker.reset()
        self.t0 = None
        self.prev_gray = None

    def label(self, frame: np.ndarray) -> dict:
        now = time.time()
        if self.t0 is None:
            self.t0 = now
        t = now - self.t0
        h, w = frame.shape[:2]
        r = self.model.track(frame, persist=True, tracker=DEFAULT_TRACKER, imgsz=IMGSZ, conf=CONF,
                             device=self.dev, verbose=False)[0]
        boxes = []
        if r.boxes is not None and r.boxes.id is not None:
            kps = r.keypoints.data.cpu().numpy() if r.keypoints is not None else [None] * len(r.boxes)
            for (x1, y1, x2, y2), tid, score, kp in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.id.cpu().numpy().astype(int),
                                                        r.boxes.conf.cpu().numpy(), kps):
                nb = [round(float(v), 4) for v in (x1 / w, y1 / h, x2 / w, y2 / h)]
                aspect = (x2 - x1) / max(1.0, y2 - y1)
                box = {"id": int(tid), "box": nb, "c": [round((nb[0] + nb[2]) / 2, 4), round((nb[1] + nb[3]) / 2, 4)],
                       "ar": round(float(aspect), 3), "conf": round(float(score), 3)}
                if kp is not None:
                    box["kp"] = [[round(float(x / w), 4), round(float(y / h), 4), round(float(c), 2)] for x, y, c in kp]
                box["posture"] = posture(kp, aspect)
                boxes.append(box)
        return {"t": round(t, 3), "boxes": boxes, "flow": self._flow(frame, t),
                "ms": round((time.time() - now) * 1000)}

    def _flow(self, frame: np.ndarray, t: float) -> dict | None:
        h, w = frame.shape[:2]
        flow_h = round(h * FLOW_WIDTH / w)
        gray = cv2.cvtColor(cv2.resize(frame, (FLOW_WIDTH, flow_h)), cv2.COLOR_BGR2GRAY)
        if self.mask is None or self.mask.shape != gray.shape:
            self.mask = roi_mask(self.roi, FLOW_WIDTH, flow_h)
            self.prev_gray = None
        stats = None
        if self.prev_gray is not None and t > self.prev_t:
            stats = flow_stats(self.prev_gray, gray, self.mask, t - self.prev_t)
        self.prev_gray, self.prev_t = gray, t
        return stats


def posture(kp: np.ndarray | None, aspect: float) -> str:
    tilt = pose.torso_tilt(kp) if kp is not None else None
    if tilt is not None:
        return "down" if tilt >= DOWN_TILT else "tilted" if tilt >= TILTED_TILT else "upright"
    return "down" if aspect >= DOWN_ASPECT else "upright"


def make_handler(labeler: Labeler, monitor: LiveMonitor):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/health":
                cam = monitor.cam
                self._send(200, {"ok": True, "model": pose.POSE_MODEL, "imgsz": IMGSZ, "device": labeler.dev or "cpu",
                                 "verifier": monitor.backend,
                                 "camera": {"id": cam["id"], "zone": cam["zone"],
                                            "restrictedPolygons": cam["restrictedPolygons"]}})
            elif urlparse(self.path).path == "/events":
                self._send(200, {"events": monitor.events()})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            url = urlparse(self.path)
            if url.path == "/stop":
                monitor.flush()
                self._send(200, {"events": monitor.events()})
                return
            if url.path != "/frame":
                self._send(404, {"error": "not found"})
                return
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n <= MAX_BODY:
                self._send(400, {"error": "expected a JPEG body"})
                return
            jpeg = self.rfile.read(n)
            frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                self._send(400, {"error": "could not decode image"})
                return
            if parse_qs(url.query).get("reset"):
                labeler.reset()
                monitor.reset()
            result = labeler.label(frame)
            monitor.add(result["t"], jpeg, {"t": result["t"], "boxes": result["boxes"], "flow": result["flow"]})
            self._send(200, {**result, "events": monitor.events()})

        def log_message(self, *args) -> None:
            pass

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("SENTINEL_LIVE_PORT", "8765")))
    args = ap.parse_args()
    monitor = LiveMonitor()
    labeler = Labeler(monitor.cam.get("roi"))
    labeler.label(np.zeros((360, 640, 3), np.uint8))  # warm up so the first real frame is not slow
    labeler.reset()
    print(f"[live] {pose.POSE_MODEL} + {DEFAULT_TRACKER} on {labeler.dev or 'cpu'}, imgsz {IMGSZ}, "
          f"verifier {monitor.backend}, listening on http://localhost:{args.port}", flush=True)
    # single-threaded on purpose: the model and tracker state are not thread-safe
    HTTPServer(("127.0.0.1", args.port), make_handler(labeler, monitor)).serve_forever()


if __name__ == "__main__":
    main()
