"""ffmpeg / OpenCV helpers.

Text is burned in with OpenCV rather than ffmpeg `drawtext`, because common ffmpeg
builds (including Homebrew's default) ship without libfreetype.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

# 1080p keeps heads large enough for the hard-hat cue (pipeline/ppe.py); the VAST SDG clips are 1080p.
TARGET_W, TARGET_H, TARGET_FPS = 1920, 1080, 30


def require(bin_name: str) -> str:
    path = shutil.which(bin_name)
    if not path:
        raise SystemExit(f"{bin_name} not found on PATH (brew install ffmpeg)")
    return path


def run(args: list[str]) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        [require("ffprobe"), "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def cut_clip(src: Path, start: float, end: float, out: Path) -> Path:
    """Frame-accurate cut (re-encoded) of [start, end] seconds."""
    out.parent.mkdir(parents=True, exist_ok=True)
    run([
        require("ffmpeg"), "-y", "-ss", f"{max(0.0, start):.2f}", "-i", str(src),
        "-t", f"{max(0.5, end - start):.2f}", "-an",
        # 480p keeps base64 uploads to the verifier small.
        "-vf", "scale=-2:480",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(out),
    ])
    return out


SUBJECT_BGR, OTHER_BGR, ZONE_BGR, VEHICLE_BGR = (40, 40, 230), (200, 200, 200), (0, 0, 255), (0, 170, 255)


def cut_annotated_clip(src: Path, start: float, end: float, out: Path, tracks: dict,
                       subject_ids: list[int], polygons: list) -> Path:
    """Cut [start, end] with the restricted zones, the incident's tracked subjects and everyone else drawn on."""
    cap = cv2.VideoCapture(str(src))
    fps = cap.get(cv2.CAP_PROP_FPS) or TARGET_FPS
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, start) * 1000)
    ok, frame = cap.read()
    if not ok:
        cap.release()
        return cut_clip(src, start, end, out)
    h, w = frame.shape[:2]
    out_h = 480
    out_w = int(round(w * out_h / h / 2)) * 2
    samples = tracks.get("frames", [])
    max_gap = 1.5 / max(tracks.get("fps", 5) or 5, 1e-6)
    subjects = set(subject_ids)
    writer = VideoWriter(out, out_w, out_h, fps)
    t = max(0.0, start)
    try:
        while ok and t <= end + 1e-6:
            frame = cv2.resize(frame, (out_w, out_h))
            overlay = frame.copy()
            for poly in polygons:
                pts = np.array([[x * out_w, y * out_h] for x, y in poly], dtype=np.int32)
                cv2.fillPoly(overlay, [pts], ZONE_BGR)
            cv2.addWeighted(overlay, 0.18, frame, 0.82, 0, frame)
            for poly in polygons:
                pts = np.array([[x * out_w, y * out_h] for x, y in poly], dtype=np.int32)
                cv2.polylines(frame, [pts], True, ZONE_BGR, 2, cv2.LINE_AA)
            nearest = min(samples, key=lambda s: abs(s["t"] - t), default=None)
            if nearest is not None and abs(nearest["t"] - t) <= max_gap:
                for v in nearest.get("vehicles", []):
                    x1, y1, x2, y2 = v["box"]
                    p1, p2 = (int(x1 * out_w), int(y1 * out_h)), (int(x2 * out_w), int(y2 * out_h))
                    cv2.rectangle(frame, p1, p2, VEHICLE_BGR, 2, cv2.LINE_AA)
                    cv2.putText(frame, v.get("cls", "vehicle"), (p1[0] + 3, p1[1] + 16), cv2.FONT_HERSHEY_SIMPLEX,
                                0.5, VEHICLE_BGR, 1, cv2.LINE_AA)
                for b in sorted(nearest["boxes"], key=lambda b: b["id"] in subjects):
                    x1, y1, x2, y2 = b["box"]
                    p1, p2 = (int(x1 * out_w), int(y1 * out_h)), (int(x2 * out_w), int(y2 * out_h))
                    subject = b["id"] in subjects
                    color = SUBJECT_BGR if subject else OTHER_BGR
                    cv2.rectangle(frame, p1, p2, color, 2 if subject else 1, cv2.LINE_AA)
                    if subject:
                        label = f"#{b['id']}"
                        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                        cv2.rectangle(frame, (p1[0], p1[1] - th - 6), (p1[0] + tw + 6, p1[1]), color, -1)
                        cv2.putText(frame, label, (p1[0] + 3, p1[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                                    (255, 255, 255), 1, cv2.LINE_AA)
            writer.write(frame)
            ok, frame = cap.read()
            t += 1.0 / fps
    finally:
        cap.release()
        writer.close()
    return out


class VideoWriter:
    """Pipe BGR frames into ffmpeg/libx264 (browser-playable, unlike cv2's mp4v)."""

    def __init__(self, out: Path, width: int, height: int, fps: float):
        out.parent.mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen(
            [require("ffmpeg"), "-y", "-loglevel", "error",
             "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps:.3f}",
             "-i", "-", "-an", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(out)],
            stdin=subprocess.PIPE,
        )

    def write(self, frame: np.ndarray) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(frame.tobytes())

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        if self.proc.wait() != 0:
            raise RuntimeError("ffmpeg encoder failed")


def mmss(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 60:02d}:{s % 60:02d}"


def draw_banner(frame: np.ndarray, text: str, *, top: bool = True, scale: float = 0.6) -> None:
    h, w = frame.shape[:2]
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), base = cv2.getTextSize(text, font, scale, 1)
    pad = 8
    y0 = 0 if top else h - th - base - 2 * pad
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, y0), (min(w, tw + 2 * pad), y0 + th + base + 2 * pad), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)
    cv2.putText(frame, text, (pad, y0 + pad + th), font, scale, (255, 255, 255), 1, cv2.LINE_AA)


def sample_frames(src: Path, start: float, end: float, n: int) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(src))
    frames = []
    for i in range(n):
        t = start + (end - start) * (i + 0.5) / n
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if ok:
            frames.append(frame)
    cap.release()
    return frames
