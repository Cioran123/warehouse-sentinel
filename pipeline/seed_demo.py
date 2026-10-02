"""Write synthetic tracks for every camera so the UI and verifier can be exercised
before real footage is assembled.

The tracks follow each camera's scripted scenario (see selftest.py scenes), shifted
to its ground-truth window. They are NOT detections. Once real footage exists, run
`python pipeline/run_all.py --redetect` to replace them with YOLO tracks.

    python pipeline/seed_demo.py && python pipeline/run_all.py
"""

from __future__ import annotations

import json

from shapely.geometry import Point, Polygon

import selftest as S
from schema import load_config, tracks_path

SCENES = {
    "restricted_zone_entry": S.scene_zone,
    "vehicle_pedestrian_proximity": lambda t, w: S.scene_worker(t),
    "person_down_or_inactivity": S.scene_down,
}
VEHICLES = {
    "vehicle_pedestrian_proximity": S.forklift_pass,
}


def main() -> None:
    for cam in load_config()["cameras"]:
        gt = cam.get("groundTruth")
        if not gt:
            continue
        window = (gt["startSec"], gt["endSec"])
        scene = SCENES.get(gt["eventType"])
        if scene is None:
            continue
        if gt["eventType"] == "restricted_zone_entry" and cam.get("restrictedPolygons"):
            poly = Polygon(cam["restrictedPolygons"][0])
            ix, iy = poly.centroid.x, poly.centroid.y
            # start beside the polygon, at the same depth, so the walk-in crosses its edge
            ox = next((x for x in (0.05, 0.95, 0.2, 0.8) if not poly.contains(Point(x, iy))), 0.0)

            def scene(t, window=window, ix=ix, iy=iy, ox=ox):
                yield from S.scene_calm(t)
                x = ox if t < window[0] + 2 else ix
                yield 99, (x, iy - 0.08, 0.04, 0.16)

            data = S.frames_from(scene)
        else:
            vehicles = VEHICLES.get(gt["eventType"])
            data = S.frames_from(lambda t, f=scene, w=window: f(t, w), None,
                                 (lambda t, f=vehicles, w=window: f(t, w)) if vehicles else None)
        data["cameraId"] = cam["id"]
        data["synthetic"] = True
        tracks_path(cam["id"]).write_text(json.dumps(data))
        print(f"[seed_demo] {cam['id']}: synthetic {gt['eventType']} tracks at {window}")


if __name__ == "__main__":
    main()
