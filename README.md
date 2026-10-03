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
four against synthetic tracks, including parked-forklift, far-aisle, and hard-hat controls.

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

## NVIDIA, CoreWeave, and VAST

Built for the VAST Builders Challenge, where VAST provides the storage, database, and video
pipeline, NVIDIA provides the models, and CoreWeave runs them (plus W&B, a CoreWeave company,
for tracing and LLM inference). Status below is honest: **used** means it runs in this repo
today, **wired** means the code path exists but has only run against the challenge VM (or not
yet on this footage), **planned** means it is designed in but not built.

```
                       VAST Builders Challenge stack (team VM)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ VAST DataEngine (VSS)  segmenter → YOLO11 → Cosmos3-Reason → Cosmos-Embed1   │
 │                        → VastDB vss-collection   (pre-ingested SDG footage)  │
 │ VAST S3                team segments bucket ──vast_fetch.py──▶ footage/      │
 │ CoreWeave GPUs         NVIDIA endpoints: COSMOS3_REASON_URL, YOLO_URL, ...   │
 └──────────────────────────────────────────────────────────────────────────────┘
          │ clips                         ▲ incidents + media          ▲ clips to verify
          ▼                               │                            │
   detect.py / candidates.py ──▶ verify.py (Cosmos3-Reason) ──▶ ledger ──▶ vast_sync.py
                                                                  │      (VastDB + S3)
                                                                  ▼
                                    Next.js app  ◀── vast_search.py (INDEX_BACKEND=vast)
                                    Weave traces every search / chat / clip question
```

### NVIDIA

| Piece | How it is (supposed to be) used | Status |
|---|---|---|
| **Cosmos Reason** (`nvidia/cosmos3-reason` on the challenge server, `nvidia/cosmos-reason2-8b` on build.nvidia.com) | The verifier. `pipeline/verify.py` sends each candidate's annotated clip (subject boxes and restricted zones drawn on) as a base64 `video_url` to an OpenAI-compatible endpoint with an event-specific prompt, and gets back keep / drop / unclear plus observable evidence. Only kept incidents count as "Verified" in the app. | **Wired.** Ran against the Builders Challenge server in the stadium version of this pipeline; on the warehouse clips it needs the VM (`SENTINEL_VERIFIER=cosmos`), so incidents here are still "Unverified". Claude on sampled frames is the fallback. |
| **Cosmos Embed1** (`COSMOS_EMBED1_URL`) | Embed every kept incident clip and its evidence text, store the 256-d vectors next to the incident rows in VastDB, and answer "show me more like this" and free-text assistant queries by vector search instead of keyword rules. | **Planned.** |
| **YOLO11 endpoint** (`YOLO_URL`) | Offload person detection to the hosted model on the VM instead of running Ultralytics locally. | **Planned.** Detection runs locally today: YOLO26m + ByteTrack for people, YOLO-World for forklifts and pallet jacks, YOLO-pose, and CLIP for the hard-hat cue. |
| **Canary-1B** (`CANARY_1B_URL`) | Speech-to-text for the assistant ("voice ask") and any audio on camera feeds. | **Planned**, not started; the SDG clips have no audio. |
| **SDG footage** | The demo clips are NVIDIA synthetic warehouse scenes (Warehouse_017 cameras, `ceiling_04`), served from the VAST corpus. | **Used.** |

### CoreWeave and W&B

| Piece | How it is (supposed to be) used | Status |
|---|---|---|
| **CoreWeave GPUs** | Host the NVIDIA endpoints above; the pipeline only talks to them over HTTP, with `GPU_BEARER_TOKEN`. | **Wired** through Cosmos Reason. |
| **W&B Weave tracing** | `pipeline/tracing.py` and `src/app/lib/weave.ts` trace detection, candidate generation, verification, search, chat, and clip Q&A as Weave ops in the team project. | **Used.** |
| **W&B Weave evaluation** | `pipeline/evaluate.py` scores the ledger against ground truth (scenarios surfaced, verifier keep rate, temporal IoU, event-type match, false positives on normal footage) and logs a `weave.Evaluation`, so prompt v1 vs v2 runs can be compared. | **Used.** Current run: 100% surfaced, 100% type match, 0% false positives on the normal camera. |
| **W&B serverless inference** (`WANDB_API_KEY`) | Replace Claude for the assistant's grounded replies, clip Q&A, and query parsing, so every model call stays on the challenge stack. | **Planned.** Claude is used today when `ANTHROPIC_API_KEY` is set, keyword rules otherwise. |

### VAST

| Piece | How it is (supposed to be) used | Status |
|---|---|---|
| **VSS corpus (DataEngine, pre-ingested)** | Source of the footage: ~178 SDG warehouse clips already segmented, captioned by Cosmos, and indexed. Re-ingesting with the `warehouse` scenario (forklift near person, hard hats, walkway obstructions) would make VSS's own search find candidate clips to feed this pipeline. | Footage **used** (clips taken from the VSS archive); re-ingest **planned**. |
| **VAST S3** | `pipeline/vast_fetch.py` lists and downloads warehouse segments from the team's segments bucket into `footage/<camera>/`; `pipeline/vast_sync.py` uploads assembled videos and evidence clips to `warehouse-sentinel-media`. | **Wired**; the endpoint only resolves from the VM. |
| **VAST DataBase** | `vast_sync.py` (re)creates `cameras` and `incidents` tables in schema `warehouse_sentinel` (kept out of `vss-schema`); `pipeline/vast_search.py` serves filtered search with predicates pushed down to VastDB, and the app uses it when `INDEX_BACKEND=vast` (falls back to the local ledger if unreachable). | **Wired**; same code path ran in the stadium version, needs the VM here. |

On the VM, `/config/<team>.config` is read automatically (`pipeline/builders.py`), which fills
`COSMOS_BASE_URL`, `NVIDIA_API_KEY`, `VAST_*`, and `WEAVE_PROJECT`, so the full stack is:

```bash
python pipeline/vast_fetch.py --camera WH_CAM_01 --limit 6 && python pipeline/assemble.py
SENTINEL_VERIFIER=cosmos npm run pipeline -- --redetect
npm run eval && python pipeline/vast_sync.py
python pipeline/vast_search.py & INDEX_BACKEND=vast npm run dev
```

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
`groundTruth` window (see Demo footage for the current four).

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
