"""Mirror the corpus, the detections, and the incident ledger into VAST Data.

  1. Upload assembled camera videos and annotated evidence clips to the VAST S3 media bucket;
     the app streams them from there (src/app/lib/vast.ts).
  2. (Re)create `cameras`, `incidents`, and `detections` tables in VAST DataBase (vastdb SDK),
     schema `warehouse_sentinel`, so search runs against VAST via pipeline/vast_search.py and
     every tracked person, vehicle, and robot is queryable per frame.

run_all.py calls sync() at the end of every run when VAST is configured (see vast.py).

    python pipeline/vast_sync.py [--skip-media]
"""

from __future__ import annotations

import argparse
import json

import vast
from schema import CLIPS_DIR, VIDEOS_DIR, load_config, read_ledger, tracks_path

INCIDENT_COLUMNS = [
    ("id", "string"), ("videoId", "string"), ("venueId", "string"), ("cameraId", "string"),
    ("zone", "string"), ("zoneId", "string"), ("eventType", "string"), ("startSec", "float64"),
    ("endSec", "float64"), ("priority", "string"), ("verificationStatus", "string"),
    ("requiresHumanReview", "bool"), ("sourceType", "string"), ("verifier", "string"),
    ("promptVersion", "string"), ("cosmosExplanation", "string"), ("evidenceClipUrl", "string"),
    ("mediaKey", "string"), ("createdAt", "string"),
    # nested values stored as JSON text
    ("observations", "string"), ("signalNotes", "string"), ("signals", "string"), ("trackIds", "string"),
]
CAMERA_COLUMNS = [
    ("id", "string"), ("zone", "string"), ("zoneId", "string"), ("videoFile", "string"),
    ("mediaKey", "string"), ("durationSec", "float64"), ("sourceType", "string"), ("scenario", "string"),
]
DETECTION_COLUMNS = [
    ("cameraId", "string"), ("t", "float64"), ("trackId", "int64"),
    # person | vehicle | robot
    ("kind", "string"), ("cls", "string"), ("ppe", "string"), ("conf", "float64"),
    ("x1", "float64"), ("y1", "float64"), ("x2", "float64"), ("y2", "float64"),
]
JSON_FIELDS = {"observations", "signalNotes", "signals", "trackIds"}


def arrow_schema(cols):
    import pyarrow as pa

    types = {"string": pa.utf8(), "float64": pa.float64(), "int64": pa.int64(), "bool": pa.bool_()}
    return pa.schema([(name, types[t]) for name, t in cols])


def upload_media(s3, bucket: str, config: dict) -> None:
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        s3.create_bucket(Bucket=bucket)
    for cam in config["cameras"]:
        path = VIDEOS_DIR / cam["videoFile"]
        if path.exists():
            s3.upload_file(str(path), bucket, vast.video_key(cam["videoFile"]), ExtraArgs={"ContentType": "video/mp4"})
            print(f"[vast] uploaded {vast.video_key(cam['videoFile'])}")
    for clip in sorted(CLIPS_DIR.glob("*.mp4")):
        s3.upload_file(str(clip), bucket, vast.clip_key(clip.stem), ExtraArgs={"ContentType": "video/mp4"})
    print(f"[vast] uploaded {len(list(CLIPS_DIR.glob('*.mp4')))} clips")


def recreate_table(schema, name: str, columns):
    existing = schema.table(name, fail_if_missing=False)
    if existing is not None:
        existing.drop()
    return schema.create_table(name, arrow_schema(columns))


def detection_rows(config: dict) -> list[dict]:
    """One row per tracked box per sampled frame, from storage/pipeline/<camera>.tracks.json."""
    rows = []
    for cam in config["cameras"]:
        path = tracks_path(cam["id"])
        if not path.exists():
            continue
        data = json.loads(path.read_text())
        for f in data["frames"]:
            groups = [("person", f["boxes"]), ("vehicle", f.get("vehicles", [])), ("robot", f.get("robots", []))]
            for kind, boxes in groups:
                for b in boxes:
                    x1, y1, x2, y2 = b["box"]
                    rows.append({
                        "cameraId": cam["id"], "t": float(f["t"]), "trackId": int(b["id"]), "kind": kind,
                        "cls": b.get("cls", kind), "ppe": b.get("ppe", ""), "conf": float(b.get("conf", 0.0)),
                        "x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2),
                    })
    return rows


def sync(skip_media: bool = False) -> dict:
    """Upload media and rewrite the project's VastDB tables. Returns row counts."""
    import pyarrow as pa

    vast.require()
    config = load_config()
    ledger = read_ledger()
    zone_of = {c["id"]: c["zoneId"] for c in config["cameras"]}
    media_bucket = vast.media_bucket()

    if not skip_media:
        upload_media(vast.s3_client(), media_bucket, config)

    detections = detection_rows(config)
    with vast.db_session().transaction() as tx:
        schema = vast.schema(tx, create=True)

        cameras = recreate_table(schema, "cameras", CAMERA_COLUMNS)
        cam_rows = [{
            **{k: c.get(k) for k, _ in CAMERA_COLUMNS},
            "mediaKey": f"s3://{media_bucket}/{vast.video_key(c['videoFile'])}",
            "durationSec": float(c["durationSec"]),
        } for c in config["cameras"]]
        cameras.insert(pa.Table.from_pylist(cam_rows, schema=arrow_schema(CAMERA_COLUMNS)))

        incidents = recreate_table(schema, "incidents", INCIDENT_COLUMNS)
        inc_rows = []
        for inc in ledger:
            row = {}
            for name, _ in INCIDENT_COLUMNS:
                value = inc.get(name)
                row[name] = json.dumps(value) if name in JSON_FIELDS else value
            row["zoneId"] = zone_of.get(inc["cameraId"], "")
            row["mediaKey"] = f"s3://{media_bucket}/{vast.clip_key(inc['id'])}"
            inc_rows.append(row)
        if inc_rows:
            incidents.insert(pa.Table.from_pylist(inc_rows, schema=arrow_schema(INCIDENT_COLUMNS)))

        table = recreate_table(schema, "detections", DETECTION_COLUMNS)
        if detections:
            table.insert(pa.Table.from_pylist(detections, schema=arrow_schema(DETECTION_COLUMNS)))
    counts = {"cameras": len(cam_rows), "incidents": len(inc_rows), "detections": len(detections)}
    print(f"[vast] wrote {counts['cameras']} cameras, {counts['incidents']} incidents, and "
          f"{counts['detections']} detections to {vast.db_bucket()}/{vast.schema_name()}")
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-media", action="store_true")
    args = ap.parse_args()
    sync(skip_media=args.skip_media)


if __name__ == "__main__":
    main()
