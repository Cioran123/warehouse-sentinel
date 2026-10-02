# Warehouse Sentinel

Evidence-grounded safety review for multi-camera warehouse footage.

YOLO tracks people and vehicles (forklifts, pallet jacks), simple checks over those tracks pick
short candidate windows, a verifier (NVIDIA Cosmos Reason, with a Claude fallback) reviews each
clip, and a human reviews what is kept. The ledger can be mirrored into VAST, and W&B Weave traces
and evaluates the results against ground truth.

Warehouse Sentinel does **not** identify people, judge individual workers (productivity,
discipline, blame), or make medical determinations. It surfaces observable safety events and
prioritizes footage for a safety supervisor.

Started from Stadium Sentinel (HackPrinceton S26, `command-center-ui` branch); the stadium
checks were replaced with warehouse ones.

---

## How it fits together

```
VAST segments bucket ──vast_fetch.py──▶ footage/WH_CAM_0x/*.mp4
                                          │
                       assemble.py      ──▶ storage/videos/WH_CAM_0x.mp4 (+ manifest.json)
                                          │
                       detect.py (YOLO + ByteTrack for people and vehicles, ROI, optical flow, pose)
                                          │          ──▶ storage/pipeline/WH_CAM_0x.tracks.json
                       candidates.py (3 checks)      ──▶ storage/pipeline/WH_CAM_0x.candidates.json
                                          │
                       verify.py (Cosmos / Claude)   ──▶ storage/clips/<incident>.mp4
                                          │
                       run_all.py                     ──▶ storage/db/incidents.json  (the ledger)
                                          │
              ┌───────────────────────────┼─────────────────────────┐
        evaluate.py (Weave)         vast_sync.py (VAST)        Next.js app (command center)
```

| Event type | Candidate check (does not decide an incident occurred) |
|---|---|
| `vehicle_pedestrian_proximity` | a tracked person's foot point within 0.5 body-heights of a vehicle box for 0.4s+ while that vehicle is moving; parked vehicles, and vehicles under 1.8x the person's height (pallet jacks and carts being pushed), are ignored |
| `restricted_zone_entry` | a person's foot point moves from outside to inside a restricted polygon (forklift-only lane, keep-out area) |
| `person_down_or_inactivity` | a track is low and nearly still for 6s+, or a lying-shaped detection stays at one spot for 2s+; pose adds torso tilt |
| `ppe_missing_hard_hat` | on cameras with `"ppeRequired": true`, a tracked person's head reads as bare (or a soft cap) in 70%+ of the frames where it is clear enough to judge |

Thresholds live in `pipeline/candidates.py` (`DEFAULTS`) and can be overridden per camera with a
`thresholds` object in `pipeline/config/cameras.json`. `python pipeline/selftest.py` checks all
three against synthetic tracks, including parked-forklift and far-aisle controls.

**Vehicles.** Stock COCO weights have no forklift class and miss the SDG forklifts entirely, so
vehicles come from a separate open-vocabulary pass: YOLO-World (`SENTINEL_VEHICLE_MODEL`, default
`yolov8m-worldv2.pt`) prompted with `SENTINEL_VEHICLE_PROMPTS` (default
`order picker forklift,forklift,pallet jack`) down to `SENTINEL_VEHICLE_CONF` (0.05). Its score
drops sharply while a forklift turns, so vehicle tracks survive misses of up to 1.6s and are
linearly interpolated across them (`"interpolated": true`). Without those weights, or with
`SENTINEL_VEHICLE_MODEL=""`, vehicles fall back to COCO classes in `SENTINEL_VEHICLE_CLASSES`
(default `forklift,truck,car,bus,motorcycle`). Vehicle tracks are only recorded with ByteTrack
(the default tracker).

---

## Setup

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
brew install ffmpeg
```

Environment goes in `.env.local` (see the variable table in `pipeline/verify.py`,
`pipeline/vast_sync.py`, and `pipeline/vast_fetch.py` docstrings). On the Builders Challenge VM,
`/config/<team>.config` is picked up automatically. With no keys at all everything still runs:
incidents stay unverified `candidate`s and search uses keyword rules.

**Hard hats and robots.** No stock model detects hard hats, and the SDG footage has humanoid
robots that the person detector picks up. `pipeline/ppe.py` runs CLIP (ViT-B/32) zero-shot on each
tracked person's head-and-shoulders crop (hard hat / bare head / robot), with a color check on the
crown that overrides to "hat" when a solid shell is visible. Tracks that are mostly "robot" move to
`robots` in tracks.json and never reach the person checks. `SENTINEL_PPE=0` turns this off.

## Demo footage

| Camera | Zone | Clip | Scenario |
|---|---|---|---|
| WH_CAM_01 | Forklift Lane | `ceiling_04` (10s) | order picker swings into a worker: near miss |
| WH_CAM_02 | Staging Floor (hard hats required) | Warehouse_017 Camera_02 | worker without a hard hat |
| WH_CAM_03 | Cross Aisle | Warehouse_017 Camera | worker walks into the robot lane |
| WH_CAM_04 | Shipping Dock | Warehouse_017 Camera_01 | pallet jack and robot only: normal |

The floor plan (`src/app/lib/floorPlan.ts`) is laid out from what these cameras show, and each
camera's ground calibration (`src/app/lib/cameraGround.ts`) projects its tracks onto it. The Site
Map's 3D and plan views follow each camera's video time when its tile is playing, so markers on
the floor move in step with the footage.

## Getting footage from VAST

The warehouse pack (`sdg_warehouse_cam-2`, ~178 short ceiling and aisle clips) is already in the
team's segments bucket. The endpoint is usually only reachable from the challenge VM.

```bash
python pipeline/vast_fetch.py --list                                 # how the keys are laid out
python pipeline/vast_fetch.py --camera WH_CAM_02 --offset 0 --limit 8
python pipeline/assemble.py --camera WH_CAM_02
```

Then watch the assembled video and update that camera in `pipeline/config/cameras.json`: zone,
`roi`, `restrictedPolygons` (normalized 0-1), `durationSec`, scenario text, and the
`groundTruth` window. The four cameras there now are placeholders.

No footage yet? `python pipeline/assemble.py --placeholder` and `python pipeline/seed_demo.py`
write stand-in videos and synthetic tracks so the UI and verifier can be exercised.

## Running

```bash
npm run pipeline        # detect → candidates → pose → verify → ledger (--redetect, --camera, --verifier none)
npm run eval            # storage/pipeline/eval.json (+ Weave evaluation with WANDB_API_KEY)
python pipeline/vast_sync.py   # ledger + media → VAST (schema warehouse_sentinel)
npm run dev             # or npm run dashboard to also start the live webcam server
```

## App

One command-center screen:

- **Floor plan**: zones shaded by incident count, camera pins that pulse while an incident is on
  screen, zones outlined when the assistant mentions them. Click a zone (or press 1-4) to focus it.
- **Cameras**: replayed footage with person boxes, vehicle boxes, pose, and the restricted polygon.
- **Assistant**: questions about the whole site ("Show every forklift near miss", "Which zones had
  repeated incidents?"), answered from the ledger only, with follow-ups that refine the last answer.
- **Alerts**: incidents appear as playback reaches them.
- **Incident drawer**: player, timeline, verifier evidence, and "Ask about this clip", which
  answers from keyframes plus the record and turns cited timestamps into seek buttons.
