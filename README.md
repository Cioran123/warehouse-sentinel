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

## Features

**Live** tab, the supervisor's main screen:

- **Camera wall.** Each fixed camera replays its footage with the detector's view drawn on top:
  blue person boxes with pose skeletons, orange dashed boxes for forklifts and pallet jacks, gray
  dashed boxes for humanoid robots and AMRs (kept out of every person check), the camera's
  restricted zones in red, "no hard hat" under bare heads in hard-hat areas, and a pink arrow for
  overall floor motion. A tile pulses in the incident's color while one is on screen, and its
  banner opens the incident. Click a tile, or press 1-4, to focus that zone.
- **Live webcam tile.** Labels your own webcam in real time (people, pose, posture), runs the
  restricted-zone and person-down checks on a rolling window, and sends each candidate clip to
  Cosmos for a keep/drop verdict, which lands in the same incident ledger.
- **Full screen.** Every camera tile and the webcam tile has a full-screen button (top-right on
  hover) that letterboxes the footage with its overlay; the header button, or **F**, puts the whole
  app in full screen for a demo. Esc exits.
- **Alerts.** Incidents pop into a strip as each camera's playback reaches them, high priority
  first, with Review and Dismiss.
- **Assistant.** Ask about the whole site in plain language ("Show every forklift near miss",
  "Is anyone missing a hard hat?", "Which zones had repeated incidents?"). Answers come only from
  the incident ledger (VAST DataBase when connected); each matching incident plays its evidence
  clip inline, matching zones are outlined, and follow-ups ("only the verified ones") refine the
  last answer. Out-of-scope asks (identity, blame, productivity, medical) are refused.
- **Evaluation.** Scores against ground truth (scenarios surfaced, verifier keep rate, temporal
  IoU, event-type match, false positives on normal footage), also logged to W&B Weave.

**Incident drawer**, opened from any tile, alert, chat answer, or map pin:

- Player with the overlay, a timeline of ground truth against detections, and jump buttons
  (context before, start, end, after).
- **Evidence:** the verifier's decision and observable evidence, the candidate signals that
  proposed it, the exact annotated clip Cosmos saw, **similar moments in the VAST archive** (see
  below), and source metadata.
- **Ask about this clip:** questions answered from keyframes of the span plus the record, with
  cited timestamps that seek the player. Refuses identity, intent, and medical questions.

**Site Map** tab:

- A floor plan laid out from what the cameras show (dock doors on the north wall, racking down the
  west wall, staging floor, cross aisle with a robot-only lane), in **3D** (orbit, zoom, fly to a
  zone) or as a **2D plan**.
- Every tracked person and vehicle is projected from its camera onto the floor through that
  camera's calibrated ground plane, with trails for movers. Markers follow each camera's video
  time when its tile is playing, otherwise each camera's short clip loops on the site clock, with
  play/pause, scrubbing, and 0.5x-4x speed.
- People and vehicles in an open incident turn red; incident pins mark where it happened.
- A zone inspector shows that zone's camera and incidents, and links to the assistant.

**Detection pipeline** (`pipeline/`): YOLO26m + ByteTrack for people, YOLO-World for forklifts and
pallet jacks, YOLO-pose for posture, CLIP for hard hats and robots, four candidate checks (near
miss, restricted entry, missing hard hat, person down), Cosmos Reason verification, and a ledger
synced to VAST. Details below.

## How VAST video retrieval works

VAST holds both the footage and what is known about it. The challenge's **Video Search &
Summary (VSS)** pipeline runs on VAST DataEngine and was used to pre-ingest the corpus:

```
upload ─▶ VAST S3 chunks bucket
            │  Segmenter: cut into short fixed-length clips
            ▼
          VAST S3 segments bucket ── one object per segment (s3://<team>-vss-chunks-segments/...)
            │  Detector:  YOLO11 (CoreWeave GPU) → object classes, counts, box sidecars
            │  Reasoner:  NVIDIA Cosmos3-Reason → a natural-language description of the segment
            │  Embedder:  NVIDIA Cosmos-Embed1 → 256-d text and visual vectors
            ▼
          VAST DataBase  vss-schema.vss-collection ── one row per segment:
                         source URI, parent video, caption, vectors, detections,
                         camera_id / location / capture_type, timing
```

**Retrieval** is a query against that table:

1. The app logs in to the VSS backend (`POST /api/v1/auth/login`) with the team account and gets a
   JWT, kept on the server.
2. `POST /api/v1/search` takes a plain-language query ("forklift close to a person in an aisle").
   VSS embeds it with Cosmos-Embed1 and runs **hybrid search** in VAST DataBase: similarity against
   the caption-text vectors and the visual vectors, blended, then filtered by tags, metadata
   (`camera_id`, `location`), time window, and a minimum similarity.
3. It returns ranked segment hits (source URI, similarity, caption, timing), the same hits grouped
   by parent video, and optionally an LLM synthesis over the top few.
4. Playback is `GET /api/v1/videos/stream?source=s3://...`, a range-capable stream straight out of
   the VAST segments bucket.

**How Warehouse Sentinel uses it:**

- **Footage in.** The demo clips are VSS segments (their filenames are VSS segment names);
  `pipeline/vast_fetch.py` lists and pulls more straight from the segments bucket.
- **Similar moments.** Each incident drawer sends the incident's description to VSS search and
  lists matching segments from the rest of the archive with their captions and match scores;
  "Play segment" streams them through `/api/vss/stream`, a server-side proxy so the JWT never
  reaches the browser (`src/app/lib/vss.ts`).
- **Our own index lives in VAST too.** `vast_sync.py` writes `cameras`, `incidents`, and every
  per-frame detection to VAST DataBase (schema `warehouse_sentinel`, separate from `vss-schema`)
  and uploads videos and evidence clips to a VAST S3 media bucket. The assistant's incident search
  runs against those tables with filters pushed down (`vast_search.py`), and the app streams media
  from VAST through presigned URLs (`src/app/lib/vast.ts`).

VSS answers "where else in the archive does something like this happen?" by semantic similarity;
the `warehouse_sentinel` tables answer "which incidents match these exact filters?". Both run on
VAST. Off the challenge VM the endpoints do not resolve, so the app says so (the **VAST** chip in
the header, `npm run doctor`) and falls back to local files; see the status tables below.

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
today, **wired** means the code path is built, on by default, and switches on when the
challenge VM's endpoints are reachable, but has not run end to end from outside the VM,
**planned** means it is designed in but not built.

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
| **Cosmos Reason** (`nvidia/cosmos3-nano-reasoner` on the challenge's CoreWeave server, `nvidia/cosmos-reason2-8b` on build.nvidia.com) | The verifier. `pipeline/verify.py` sends each candidate's annotated clip (subject boxes and restricted zones drawn on) as a base64 `video_url` to an OpenAI-compatible endpoint with an event-specific prompt, and gets back keep / drop / unclear plus observable evidence. Only kept incidents count as "Verified" in the app. The live webcam server sends its clips the same way. | **Used.** All three warehouse incidents and the live webcam incidents were verified by Cosmos (`run_all.py --verifier cosmos`). For the hard-hat clip its evidence largely restates the tracker's signals, so treat that verdict as weaker. Claude on sampled frames is the fallback. |
| **Cosmos Embed1** (`COSMOS_EMBED1_URL`) | Embed every kept incident clip and its evidence text, store the 256-d vectors next to the incident rows in VastDB, and answer "show me more like this" and free-text assistant queries by vector search instead of keyword rules. | **Planned.** |
| **YOLO11 endpoint** (`YOLO_URL`) | Offload person detection to the hosted model on the VM instead of running Ultralytics locally. | **Planned.** Detection runs locally today: YOLO26m + ByteTrack for people, YOLO-World for forklifts and pallet jacks, YOLO-pose, and CLIP for the hard-hat cue. |
| **Canary-1B** (`CANARY_1B_URL`) | Speech-to-text for the assistant ("voice ask") and any audio on camera feeds. | **Planned**, not started; the SDG clips have no audio. |
| **SDG footage** | The demo clips are NVIDIA synthetic warehouse scenes (Warehouse_017 cameras, `ceiling_04`), served from the VAST corpus. | **Used.** |

### CoreWeave and W&B

| Piece | How it is (supposed to be) used | Status |
|---|---|---|
| **CoreWeave GPUs** | Host the NVIDIA endpoints above; the pipeline only talks to them over HTTP, with `GPU_BEARER_TOKEN`. | **Used** through Cosmos Reason. |
| **W&B Weave tracing** | `pipeline/tracing.py` and `src/app/lib/weave.ts` trace detection, candidate generation, verification, search, chat, and clip Q&A as Weave ops in the team project. | **Used.** |
| **W&B Weave evaluation** | `pipeline/evaluate.py` scores the ledger against ground truth (scenarios surfaced, verifier keep rate, temporal IoU, event-type match, false positives on normal footage) and logs a `weave.Evaluation`, so prompt v1 vs v2 runs can be compared. | **Used.** Current run with Cosmos: 100% surfaced, 100% kept, 100% type match, 0% false positives on the normal camera. |
| **W&B serverless inference** (`WANDB_API_KEY`) | Replace Claude for the assistant's grounded replies, clip Q&A, and query parsing, so every model call stays on the challenge stack. | **Planned.** Claude is used today when `ANTHROPIC_API_KEY` is set, keyword rules otherwise. |

### VAST

VAST is the project's system of record whenever the team cluster is reachable; every path falls
back to local files when it is not (the S3 / VastDB endpoint resolves from the challenge VM,
not from an outside laptop). The header's **VAST** chip and `npm run doctor` show which mode
is live.

| Piece | How it is used | Code | Status |
|---|---|---|---|
| **VSS corpus** (VAST DataEngine, pre-ingested) | Source of the footage: ~178 SDG warehouse clips segmented, captioned by Cosmos3-Reason, embedded with Cosmos-Embed1, and indexed in VastDB `vss-collection`. | `footage/` came from the VSS archive | **Used** |
| **VAST S3, segments bucket** | Lists and downloads warehouse segments into `footage/<camera>/`. | `pipeline/vast_fetch.py` | **Wired** (VM) |
| **VAST S3, media bucket** | Every run uploads the assembled camera videos and annotated evidence clips; the app's video and clip routes stream them from VAST through presigned URLs, falling back to local files. | `pipeline/vast_sync.py`, `src/app/lib/vast.ts`, `src/app/api/cameras/[id]/video`, `src/app/api/clips/[id]` | **Wired** (VM) |
| **VAST DataBase** | Schema `warehouse_sentinel` (kept out of `vss-schema`) with three tables: `cameras`, `incidents` (the verified ledger), and `detections` (every tracked person, vehicle, and robot per frame, with class and hard-hat cue). `run_all.py` rewrites them at the end of every run. | `pipeline/vast.py`, `pipeline/vast_sync.py`, `pipeline/run_all.py` | **Wired** (VM) |
| **VastDB incident search** | The assistant's and the alert feed's incident queries run against VastDB with predicates pushed down (`vast_search.py`); this is the default whenever VAST is configured (`INDEX_BACKEND=local` opts out). | `pipeline/vast_search.py`, `src/app/lib/search.ts` | **Wired** (VM) |
| **VSS archive search** | Each incident's drawer shows "Similar moments in the VAST archive": the incident description goes to VSS hybrid search (`POST /api/v1/search`), and hits play back from the segments bucket through a server-side proxy (`/api/v1/videos/stream`). | `src/app/lib/vss.ts`, `src/app/api/vss/*`, `src/app/components/ArchiveMatches.tsx` | **Wired** (VM, needs `INGRESS_URL` + team login) |
| **VSS re-ingest** | Re-run DataEngine on the warehouse pack with the `warehouse` scenario so VSS captions name forklifts, hard hats, and walkways. | VAST Builders `ingest/reingest-videos` skill | **Planned** |

On the VM, `/config/<team>.config` is read automatically (`pipeline/builders.py`), which fills
`COSMOS_BASE_URL`, `NVIDIA_API_KEY`, `VAST_*`, and `WEAVE_PROJECT`, so the full stack is:

```bash
python pipeline/vast_fetch.py --camera WH_CAM_01 --limit 6 && python pipeline/assemble.py
SENTINEL_VERIFIER=cosmos npm run pipeline -- --redetect   # ends by syncing media + tables to VAST
npm run eval
python pipeline/vast_search.py & npm run dev               # search and media now come from VAST
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
