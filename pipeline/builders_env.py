"""Map VAST Builders Challenge settings onto Warehouse Sentinel's env names.

The workshop VM exports `/config/<team>.config` (and you can copy the same
keys into `.env.local`). Sentinel already reads `VAST_S3_ENDPOINT`,
`VAST_ACCESS_KEY`, `COSMOS_BASE_URL`, and `NVIDIA_API_KEY`. This fills those
only when they are unset, so a laptop `.env.local` still wins.

The video index schema (`vss-schema` / `vss-collection`) is left alone.
Incident rows go in the `warehouse_sentinel` schema inside the team's database bucket.
"""

from __future__ import annotations

import os
from pathlib import Path

from schema import ROOT


def _parse_config(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("'\"")
        if not value or value.startswith("<"):
            continue
        out[key.strip()] = value
    return out


def _load_file(path: Path) -> None:
    if not path.is_file():
        return
    for key, value in _parse_config(path.read_text()).items():
        os.environ.setdefault(key, value)


def _load_team_config() -> None:
    explicit = os.environ.get("BUILDERS_CONFIG")
    if explicit:
        _load_file(Path(explicit))
        return
    config_dir = Path("/config")
    if not config_dir.is_dir():
        local = ROOT / "builders.config"
        _load_file(local)
        return
    files = sorted(p for p in config_dir.glob("*.config") if p.is_file())
    if len(files) == 1:
        _load_file(files[0])


def _setdefault(key: str, value: str | None) -> None:
    if value and not os.environ.get(key):
        os.environ[key] = value


def _openai_base(url: str) -> str:
    url = url.rstrip("/")
    return url if url.endswith("/v1") else f"{url}/v1"


def apply_builders_env() -> None:
    """Load the team config, then alias challenge names onto Sentinel names."""
    _load_team_config()

    reason_url = os.environ.get("COSMOS3_REASON_URL")
    if reason_url:
        _setdefault("COSMOS_BASE_URL", _openai_base(reason_url))
        _setdefault(
            "COSMOS_MODEL",
            os.environ.get("COSMOS3_REASON_MODEL") or "nvidia/cosmos3-reason",
        )
        # The workshop bearer is for this host, not api.nvidia.com.
        _setdefault("NVIDIA_API_KEY", os.environ.get("GPU_BEARER_TOKEN"))

    _setdefault("VAST_S3_ENDPOINT", os.environ.get("S3_ENDPOINT"))
    _setdefault("VAST_ACCESS_KEY", os.environ.get("ACCESS_KEY"))
    _setdefault("VAST_SECRET_KEY", os.environ.get("SECRET_KEY"))
    _setdefault(
        "VAST_DB_ENDPOINT",
        os.environ.get("VDB_ENDPOINT") or os.environ.get("S3_ENDPOINT"),
    )
    _setdefault("VAST_DB_BUCKET", os.environ.get("VASTDB_BUCKET"))
