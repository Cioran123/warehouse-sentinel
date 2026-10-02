"""Candidate-generation checks over YOLO tracks.

These checks do not decide that an incident occurred. They select short windows of
footage for the verifier (Cosmos) to review. Every check runs on every camera (the zone
check only where restricted polygons are configured), so normal footage gets a chance
to produce false positives that the verifier must reject.

Per-camera overrides go in cameras.json under "thresholds", keyed by the names in
DEFAULTS below.

Usage:
    python pipeline/candidates.py [--camera CAM_01]
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import asdict

import numpy as np
from shapely.geometry import Point, Polygon

from schema import Candidate, candidates_path, load_config, tracks_path
from tracing import op

DEFAULTS = {
    # restricted zone
    "zone_min_inside_sec": 0.6,
    # vehicle-pedestrian near miss: a person's foot point within this many of their own
    # body-heights of a vehicle box while the vehicle is moving
    "near_max_gap_heights": 0.5,
    "near_high_gap_heights": 0.2,
    "near_min_sec": 0.4,
    # vehicle speed in its own box-widths per second, measured over near_speed_lag_sec;
    # filters out parked forklifts and detector jitter
    "near_min_vehicle_speed": 0.15,
    "near_speed_lag_sec": 1.0,
    # person down / inactivity
    "inactive_min_sec": 6.0,
    "inactive_low_aspect": 1.2,
    "inactive_low_height_ratio": 0.65,
    "inactive_max_displacement": 0.015,
    # person lying on the ground: a wide box that stays put. Someone lying flat usually
    # scores too low to become a track (detect.py keeps these as per-frame `lying` boxes),
    # and racking or passers-by soon hide them, so this needs far less time than inactivity.
    "lying_min_sec": 2.0,
    "lying_min_aspect": 1.2,
    "lying_link_iou": 0.3,
    # chains link across gaps this long (a passer-by briefly hides the person)...
    "lying_max_gap_sec": 1.0,
    # ...but must contain lying_min_sec with no gap longer than this; sparser sightings
    # after that only extend how long they are reported down
    "lying_dense_gap_sec": 0.7,
    # in box widths: a lying person stays put while others move around them
    "lying_max_displacement": 0.5,
    # shared
    "merge_gap_sec": 3.0,
    "max_clip_sec": 12.0,
}


def _ts(t: float) -> str:
    s = int(t)
    return f"{s // 60:02d}:{s % 60:02d}"


def _by_track(frames: list[dict]) -> dict[int, list[tuple[float, dict]]]:
    tracks: dict[int, list[tuple[float, dict]]] = defaultdict(list)
    for f in frames:
        for b in f["boxes"]:
            tracks[b["id"]].append((f["t"], b))
    return tracks


def _runs(mask: list[bool], times: list[float], min_len: float) -> list[tuple[float, float]]:
    """Contiguous True runs in `mask`, as (start, end) times, at least `min_len` long."""
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = times[i]
        if (not m or i == len(mask) - 1) and start is not None:
            end = times[i] if m else times[i - 1]
            if end - start >= min_len:
                out.append((start, end))
            start = None
    return out


def _window(start: float, end: float, duration: float, pre: float = 3.0, post: float = 3.0,
            max_len: float = 12.0, peak: float | None = None) -> tuple[float, float]:
    s, e = max(0.0, start - pre), min(duration, end + post)
    if e - s > max_len:
        center = peak if peak is not None else (s + e) / 2
        s = max(0.0, center - max_len / 2)
        e = min(duration, s + max_len)
    return round(float(s), 2), round(float(e), 2)


def check_restricted_zone(cam: dict, data: dict, th: dict) -> list[Candidate]:
    polys = [Polygon(p) for p in cam.get("restrictedPolygons", [])]
    if not polys:
        return []
    dt = 1.0 / data["fps"]
    min_inside = max(1, math.ceil(th["zone_min_inside_sec"] / dt))
    out = []
    for tid, samples in _by_track(data["frames"]).items():
        for pi, poly in enumerate(polys):
            inside = [poly.contains(Point((b["box"][0] + b["box"][2]) / 2, b["box"][3])) for _, b in samples]
            for i in range(1, len(inside)):
                if inside[i] and not inside[i - 1] and all(inside[i:i + min_inside]) and len(inside[i:i + min_inside]) == min_inside:
                    t_enter = samples[i][0]
                    j = i
                    while j < len(inside) and inside[j]:
                        j += 1
                    dwell = samples[j - 1][0] - t_enter
                    s, e = _window(t_enter, t_enter + min(dwell, 5.0), data["durationSec"], max_len=th["max_clip_sec"])
                    out.append(Candidate(
                        camera_id=cam["id"], event_type="restricted_zone_entry", start_sec=s, end_sec=e,
                        priority="high",
                        observations=[
                            f"tracked person #{tid} foot point moved from outside to inside restricted polygon {pi + 1} at {_ts(t_enter)}",
                            f"remained inside the polygon for {dwell:.1f}s",
                        ],
                        signals={"enterSec": round(t_enter, 2), "dwellSec": round(dwell, 2), "polygon": pi},
                        track_ids=[tid],
                    ))
    return out


def _vehicle_speeds(frames: list[dict], lag_sec: float) -> dict[tuple[int, int], float]:
    """(frame index, vehicle id) -> center speed in vehicle-box-widths per second over ~lag_sec."""
    by_id: dict[int, list[tuple[int, float, dict]]] = defaultdict(list)
    for fi, f in enumerate(frames):
        for v in f.get("vehicles", []):
            by_id[v["id"]].append((fi, f["t"], v))
    out = {}
    for vid, samples in by_id.items():
        j = 0
        for fi, t, v in samples:
            while j < len(samples) - 1 and t - samples[j][1] > lag_sec:
                j += 1
            _, t0, v0 = samples[j]
            width = max(1e-4, v["box"][2] - v["box"][0])
            out[(fi, vid)] = math.dist(v["c"], v0["c"]) / max(t - t0, 1e-3) / width if t > t0 else 0.0
    return out


def _foot_gap(person: dict, vehicle: dict) -> float:
    """Distance from a person's foot point to a vehicle box, in the person's body-heights."""
    fx, fy = (person["box"][0] + person["box"][2]) / 2, person["box"][3]
    x1, y1, x2, y2 = vehicle["box"]
    dx = max(x1 - fx, 0.0, fx - x2)
    dy = max(y1 - fy, 0.0, fy - y2)
    return math.hypot(dx, dy) / max(1e-4, person["box"][3] - person["box"][1])


def check_near_miss(cam: dict, data: dict, th: dict) -> list[Candidate]:
    """A tracked person close to a moving vehicle (forklift, pallet jack, truck) for near_min_sec.

    Parked vehicles are ignored: someone loading a stationary forklift is normal work."""
    frames = data["frames"]
    if not any(f.get("vehicles") for f in frames):
        return []
    speeds = _vehicle_speeds(frames, th["near_speed_lag_sec"])
    close: dict[tuple[int, int], dict[int, tuple[float, float]]] = defaultdict(dict)  # (person, vehicle) -> frame -> (gap, speed)
    for fi, f in enumerate(frames):
        for v in f.get("vehicles", []):
            speed = speeds.get((fi, v["id"]), 0.0)
            if speed < th["near_min_vehicle_speed"]:
                continue
            for p in f["boxes"]:
                gap = _foot_gap(p, v)
                if gap <= th["near_max_gap_heights"]:
                    close[(p["id"], v["id"])][fi] = (gap, speed)

    times = [f["t"] for f in frames]
    out = []
    for (pid, vid), hits in close.items():
        mask = [fi in hits for fi in range(len(frames))]
        for start, end in _runs(mask, times, min_len=th["near_min_sec"]):
            span = [hits[fi] for fi, t in enumerate(times) if start <= t <= end and fi in hits]
            gap = min(g for g, _ in span)
            speed = max(s for _, s in span)
            cls = next((v.get("cls", "vehicle") for fi, t in enumerate(times) if start <= t <= end
                        for v in frames[fi].get("vehicles", []) if v["id"] == vid), "vehicle")
            s, e = _window(start, end, data["durationSec"], pre=3, post=2, max_len=th["max_clip_sec"])
            out.append(Candidate(
                camera_id=cam["id"], event_type="vehicle_pedestrian_proximity", start_sec=s, end_sec=e,
                priority="high" if gap <= th["near_high_gap_heights"] else "medium",
                observations=[
                    f"tracked person #{pid} came within {gap:.1f} body-heights of moving {cls} #{vid} "
                    f"from {_ts(start)} to {_ts(end)}",
                    f"the {cls} was moving about {speed:.1f} of its own widths per second",
                ],
                signals={"minGapHeights": round(gap, 2), "vehicleSpeed": round(speed, 2),
                         "closeSec": round(end - start, 2), "vehicleTrack": float(vid)},
                track_ids=[pid],
            ))
    return out


def check_inactivity(cam: dict, data: dict, th: dict) -> list[Candidate]:
    dt = 1.0 / data["fps"]
    win = max(2, round(th["inactive_min_sec"] / dt))
    out = []
    for tid, samples in _by_track(data["frames"]).items():
        if len(samples) < win:
            continue
        heights = np.array([b["box"][3] - b["box"][1] for _, b in samples])
        median_h = float(np.median(heights))
        centers = np.array([b["c"] for _, b in samples])
        low = [
            b["ar"] >= th["inactive_low_aspect"] or (h < th["inactive_low_height_ratio"] * median_h)
            for (_, b), h in zip(samples, heights)
        ]
        still = []
        for i in range(len(samples)):
            lo, hi = max(0, i - win // 2), min(len(samples), i + win // 2 + 1)
            disp = np.linalg.norm(centers[lo:hi] - centers[lo:hi].mean(axis=0), axis=1).max()
            still.append(bool(disp <= th["inactive_max_displacement"]))
        mask = [l and s for l, s in zip(low, still)]
        times = [t for t, _ in samples]
        for start, end in _runs(mask, times, min_len=th["inactive_min_sec"]):
            dwell = end - start
            s, e = _window(start, start + min(dwell, 6.0), data["durationSec"], max_len=th["max_clip_sec"])
            i0 = times.index(start)
            out.append(Candidate(
                camera_id=cam["id"], event_type="person_down_or_inactivity", start_sec=s, end_sec=e,
                priority="high" if dwell >= 10 else "medium",
                observations=[
                    f"tracked person #{tid} in a low position (box aspect {samples[i0][1]['ar']:.2f}) from {_ts(start)}",
                    f"little to no movement for {dwell:.1f}s",
                ],
                signals={"dwellSec": round(dwell, 2), "aspect": samples[i0][1]["ar"]},
                track_ids=[tid],
            ))
    return out


def _iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def check_lying(cam: dict, data: dict, th: dict) -> list[Candidate]:
    """A wide (lying-shaped) detection that stays at one spot for lying_min_sec.

    Links per-frame `lying` boxes (raw wide detections, any confidence) by overlap, since a
    person on the ground rarely keeps one track ID. Tracks files without `lying` (other
    trackers, synthetic seeds) fall back to wide tracked boxes."""
    dt = 1.0 / data["fps"]
    chains: list[list[dict]] = []
    for f in data["frames"]:
        src = f["lying"] if "lying" in f else f["boxes"]
        obs = [{"box": b["box"], "ar": b["ar"], "conf": b.get("conf", 0.0), "id": b.get("id")}
               for b in src if b["ar"] >= th["lying_min_aspect"]]
        open_chains = [c for c in chains if f["t"] - c[-1]["t"] <= th["lying_max_gap_sec"] and c[-1]["t"] < f["t"]]
        for o in sorted(obs, key=lambda o: -o["conf"]):
            o["t"] = f["t"]
            best = max(open_chains, key=lambda c: _iou(c[-1]["box"], o["box"]), default=None)
            if best is not None and _iou(best[-1]["box"], o["box"]) >= th["lying_link_iou"]:
                best.append(o)
                open_chains.remove(best)
            else:
                chains.append([o])

    def dense_segment(c: list[dict]) -> list[dict] | None:
        """First stretch of the chain lasting lying_min_sec without a gap over lying_dense_gap_sec."""
        seg = [c[0]]
        for o in c[1:]:
            if o["t"] - seg[-1]["t"] > th["lying_dense_gap_sec"] + 1e-6:
                if seg[-1]["t"] - seg[0]["t"] >= th["lying_min_sec"]:
                    return seg
                seg = []
            seg.append(o)
        return seg if seg[-1]["t"] - seg[0]["t"] >= th["lying_min_sec"] else None

    out = []
    for c in chains:
        seg = dense_segment(c)
        if seg is None:
            continue
        boxes = np.array([o["box"] for o in seg])
        centers = (boxes[:, :2] + boxes[:, 2:]) / 2
        width = float(np.median(boxes[:, 2] - boxes[:, 0]))
        if np.linalg.norm(centers - centers.mean(axis=0), axis=1).max() > th["lying_max_displacement"] * width:
            continue
        start, end = seg[0]["t"], c[-1]["t"]
        dur = end - start
        aspect = float(np.median([o["ar"] for o in seg]))
        top_conf = max(o["conf"] for o in c)
        tids = sorted({o["id"] for o in c if o["id"] is not None})
        obs = [f"a wide, low person detection (box {aspect:.1f}x wider than tall) stayed at the same spot "
               f"from {_ts(start)}, seen continuously for {seg[-1]['t'] - start:.1f}s, consistent with someone on the ground"]
        if end > seg[-1]["t"]:
            obs.append(f"still detected there on and off until {_ts(end)} ({dur:.1f}s in total) while partly hidden")
        if not tids:
            obs.append(f"detection confidence stayed low (max {top_conf:.2f}), too low to start a track, "
                       f"which is typical for a person lying down or partly covered")
        s, e = _window(start, end, data["durationSec"], pre=2, post=2, max_len=th["max_clip_sec"])
        out.append(Candidate(
            camera_id=cam["id"], event_type="person_down_or_inactivity", start_sec=s, end_sec=e,
            priority="high", observations=obs,
            signals={"lyingSec": round(dur, 2), "aspect": round(aspect, 2), "maxConf": round(top_conf, 3),
                     "lyingFrames": float(len(c))},
            track_ids=tids,
        ))
    return out


def merge(cands: list[Candidate], gap: float) -> list[Candidate]:
    out: list[Candidate] = []
    rank = {"low": 0, "medium": 1, "high": 2}
    for c in sorted(cands, key=lambda c: (c.event_type, c.start_sec)):
        prev = out[-1] if out else None
        if prev and prev.event_type == c.event_type and c.start_sec <= prev.end_sec + gap:
            prev.end_sec = max(prev.end_sec, c.end_sec)
            prev.observations += [o for o in c.observations if o not in prev.observations]
            prev.track_ids = sorted(set(prev.track_ids) | set(c.track_ids))
            if rank[c.priority] > rank[prev.priority]:
                prev.priority = c.priority
            for k, v in c.signals.items():
                prev.signals[k] = max(prev.signals.get(k, v), v)
        else:
            out.append(c)
    return sorted(out, key=lambda c: c.start_sec)


@op
def generate_candidates(camera_id: str) -> list[dict]:
    cam = next(c for c in load_config()["cameras"] if c["id"] == camera_id)
    data = json.loads(tracks_path(camera_id).read_text())
    th = {**DEFAULTS, **cam.get("thresholds", {})}
    raw = (
        check_restricted_zone(cam, data, th)
        + check_near_miss(cam, data, th)
        + check_inactivity(cam, data, th)
        + check_lying(cam, data, th)
    )
    cands = merge(raw, th["merge_gap_sec"])
    for c in cands:
        if c.end_sec - c.start_sec > th["max_clip_sec"]:
            c.end_sec = round(c.start_sec + th["max_clip_sec"], 2)
    rows = [asdict(c) for c in cands]
    candidates_path(camera_id).write_text(json.dumps(rows, indent=2))
    summary = ", ".join(f"{c.event_type}@{c.start_sec:.0f}s" for c in cands) or "none"
    print(f"[candidates] {camera_id}: {len(cands)} ({summary})")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera")
    args = ap.parse_args()
    for cam in load_config()["cameras"]:
        if args.camera and cam["id"] != args.camera:
            continue
        if not tracks_path(cam["id"]).exists():
            print(f"[candidates] {cam['id']}: no tracks, run detect.py first")
            continue
        generate_candidates(cam["id"])


if __name__ == "__main__":
    main()
