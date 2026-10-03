"""Pull warehouse clips from the VAST segments bucket into footage/<CAMERA_ID>/.

The Builders Challenge corpus is pre-ingested: the Segmenter already cut every source video
into short clips in the team's segments bucket (S3_SEGMENTS_BUCKET). The warehouse pack is
~178 ceiling / aisle clips from `sdg_warehouse_cam-2`. This lists matching keys, and copies
a chosen slice of them into a camera's footage folder, where assemble.py concatenates them.

Start with --list to see how the keys are laid out, then assign slices to cameras:

    python pipeline/vast_fetch.py --list
    python pipeline/vast_fetch.py --camera WH_CAM_02 --offset 0 --limit 8
    python pipeline/assemble.py --camera WH_CAM_02

Environment (from /config/<team>.config on the VM, or .env.local):
  VAST_S3_ENDPOINT / VAST_ACCESS_KEY / VAST_SECRET_KEY  (filled from S3_ENDPOINT, ACCESS_KEY, SECRET_KEY)
  S3_SEGMENTS_BUCKET   e.g. team-14-vss-chunks-segments (or pass --bucket)

The S3 endpoint is usually only reachable from the challenge VM.
"""

from __future__ import annotations

import argparse
import re
from collections import Counter

import vast
from schema import ROOT, load_config

FOOTAGE_DIR = ROOT / "footage"
DEFAULT_MATCH = "sdg_warehouse,warehouse"
VIDEO_EXT = (".mp4",)


def list_keys(s3, bucket: str, prefix: str, match: list[str]) -> list[tuple[str, int]]:
    out = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.lower().endswith(VIDEO_EXT) and (not match or any(m in key.lower() for m in match)):
                out.append((key, obj["Size"]))
    return sorted(out)


def safe_name(key: str) -> str:
    return re.sub(r"[^\w.-]+", "_", key.rsplit("/", 1)[-1])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", default=None, help="segments bucket (default: $S3_SEGMENTS_BUCKET)")
    ap.add_argument("--prefix", default="", help="only keys under this prefix")
    ap.add_argument("--match", default=DEFAULT_MATCH,
                    help="comma-separated substrings; a key matching any is kept ('' keeps all)")
    ap.add_argument("--list", action="store_true", help="print matching keys and folder counts, download nothing")
    ap.add_argument("--camera", help="camera id from cameras.json to download into")
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--limit", type=int, default=6)
    ap.add_argument("--clean", action="store_true", help="remove the camera's existing footage first")
    args = ap.parse_args()
    vast.require()
    bucket = args.bucket or vast.segments_bucket()
    if not bucket:
        raise SystemExit("S3_SEGMENTS_BUCKET is not set; pass --bucket (e.g. team-14-vss-chunks-segments)")
    match = [m.strip().lower() for m in args.match.split(",") if m.strip()]
    s3 = vast.s3_client()
    keys = list_keys(s3, bucket, args.prefix, match)
    print(f"[vast_fetch] {len(keys)} clips in s3://{bucket}/{args.prefix} matching {match or 'anything'}")

    if args.list or not args.camera:
        folders = Counter(k.rsplit("/", 1)[0] if "/" in k else "." for k, _ in keys)
        for folder, n in folders.most_common():
            print(f"  {n:4d}  {folder}/")
        for i, (key, size) in enumerate(keys[:40]):
            print(f"  [{i:3d}] {size / 1e6:6.1f} MB  {key}")
        if len(keys) > 40:
            print(f"  ... {len(keys) - 40} more (use --offset/--limit to pick a slice)")
        if not args.camera:
            print("[vast_fetch] pass --camera WH_CAM_0x to download a slice")
        return

    if not any(c["id"] == args.camera for c in load_config()["cameras"]):
        raise SystemExit(f"{args.camera} is not in pipeline/config/cameras.json")
    chosen = keys[args.offset:args.offset + args.limit]
    if not chosen:
        raise SystemExit("no clips in that slice")
    dest = FOOTAGE_DIR / args.camera
    dest.mkdir(parents=True, exist_ok=True)
    if args.clean:
        for old in dest.glob("*"):
            old.unlink()
    for i, (key, size) in enumerate(chosen):
        out = dest / f"{i:03d}_{safe_name(key)}"
        if out.exists() and out.stat().st_size == size:
            print(f"[vast_fetch] have {out.name}")
            continue
        s3.download_file(bucket, key, str(out))
        print(f"[vast_fetch] {key} -> footage/{args.camera}/{out.name} ({size / 1e6:.1f} MB)")
    print(f"[vast_fetch] {len(chosen)} clips in footage/{args.camera}/; next: python pipeline/assemble.py --camera {args.camera}")


if __name__ == "__main__":
    main()
