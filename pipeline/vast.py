"""VAST Data connections shared by the pipeline: VAST S3 for media, VAST DataBase for tables.

Warehouse Sentinel keeps VAST as its system of record when the team's cluster is reachable:

  * Footage comes in from the VSS segments bucket (`vast_fetch.py`).
  * Assembled camera videos and annotated evidence clips go to the media bucket, where the app
    streams them from (`vast_sync.py`, src/app/lib/vast.ts).
  * Cameras, incidents, and every per-frame detection (people, vehicles, robots) are tables in
    VAST DataBase, schema `warehouse_sentinel` (`vast_sync.py`), and the app's incident search
    runs against them (`vast_search.py`, INDEX_BACKEND=vast).

On the Builders Challenge VM the settings come from /config/<team>.config (see builders.py);
elsewhere from .env.local. When none are set, or the cluster does not answer, the pipeline
keeps working on local files and says so.

    VAST_S3_ENDPOINT / VAST_ACCESS_KEY / VAST_SECRET_KEY   (S3_ENDPOINT, ACCESS_KEY, SECRET_KEY)
    VAST_DB_ENDPOINT    defaults to VAST_S3_ENDPOINT        (VDB_ENDPOINT)
    VAST_DB_BUCKET      database bucket                     (VASTDB_BUCKET)
    VAST_DB_SCHEMA      default warehouse_sentinel
    VAST_MEDIA_BUCKET   default warehouse-sentinel-media
    S3_SEGMENTS_BUCKET  VSS segments bucket, read by vast_fetch.py
"""

from __future__ import annotations

import os

from schema import load_env

DEFAULT_SCHEMA = "warehouse_sentinel"
DEFAULT_MEDIA_BUCKET = "warehouse-sentinel-media"
DEFAULT_DB_BUCKET = "sentinel-db"


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def configured() -> bool:
    """True when VAST credentials are present (not a reachability check)."""
    load_env()
    return all(_env(k) for k in ("VAST_S3_ENDPOINT", "VAST_ACCESS_KEY", "VAST_SECRET_KEY"))


def require() -> None:
    if not configured():
        raise SystemExit("VAST is not configured: set VAST_S3_ENDPOINT, VAST_ACCESS_KEY, VAST_SECRET_KEY "
                         "(or run on the Builders Challenge VM, which provides /config/<team>.config)")


def media_bucket() -> str:
    return _env("VAST_MEDIA_BUCKET") or DEFAULT_MEDIA_BUCKET


def db_bucket() -> str:
    return _env("VAST_DB_BUCKET") or DEFAULT_DB_BUCKET


def schema_name() -> str:
    return _env("VAST_DB_SCHEMA") or DEFAULT_SCHEMA


def segments_bucket() -> str | None:
    return _env("S3_SEGMENTS_BUCKET") or None


def video_key(video_file: str) -> str:
    return f"videos/{video_file}"


def clip_key(incident_id: str) -> str:
    return f"clips/{incident_id}.mp4"


def s3_client(read_timeout: int = 60):
    import boto3
    from botocore.config import Config

    require()
    return boto3.client(
        "s3",
        endpoint_url=_env("VAST_S3_ENDPOINT"),
        aws_access_key_id=_env("VAST_ACCESS_KEY"),
        aws_secret_access_key=_env("VAST_SECRET_KEY"),
        config=Config(connect_timeout=10, read_timeout=read_timeout, retries={"max_attempts": 2}),
    )


def db_session():
    import vastdb

    require()
    return vastdb.connect(
        endpoint=_env("VAST_DB_ENDPOINT") or _env("VAST_S3_ENDPOINT"),
        access=_env("VAST_ACCESS_KEY"),
        secret=_env("VAST_SECRET_KEY"),
    )


def schema(tx, create: bool = False):
    """The project's schema in the team database bucket, never `vss-schema`."""
    bucket = tx.bucket(db_bucket())
    found = bucket.schema(schema_name(), fail_if_missing=False)
    if found is None and create:
        found = bucket.create_schema(schema_name())
    return found
