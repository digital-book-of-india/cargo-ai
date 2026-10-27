# AI worker

Reads the enabled cameras' streams, detects packages with a **trained ONNX model**, tracks them, and reports line
crossings and zone events to the API. No model, no events: the worker reports `DEGRADED` instead of guessing.

## Run
```
AI_SERVICE_TOKEN=<same as the API, 32+ chars>  BACKEND_URL=http://localhost:4000  MODEL_PATH=models/packages.onnx  python src/main.py
```
`models/packages.onnx` is YOLOv8-style (output `1 x (4 + classes) x N`, classes named `package`, `box`, `pallet`).
An optional `models/packages.json` can hold `{"name", "version", "classes"}`; otherwise the file name is the model
name and the first 12 characters of the file's SHA-256 are the version. Both are sent with every event.

| Variable | Default | Meaning |
|---|---|---|
| `AI_SERVICE_TOKEN` | none | Must match the API. The worker refuses to start with less than 32 characters. |
| `BACKEND_URL` | `http://localhost:4000` | The API. |
| `WORKER_ID` | `cargo-worker-1` | Name shown in monitoring. |
| `MODEL_PATH` | none | The ONNX model. |
| `DETECT_CONFIDENCE` / `NMS_IOU` | 0.35 / 0.5 | Model thresholds; each zone adds its own `minimumConfidence`. |
| `PROCESS_FPS` | 5 | Frames analysed per second and camera. |
| `ZONE_CONFIRM_FRAMES` | 3 | Frames inside or outside before a zone entry or exit is reported. |
| `SPOOL_PATH` | `src/spool_buffer.db` | Events that could not be delivered wait here and are retried. |

## How it counts
- Direction `IN` = the track moves from the negative to the positive side of the line A -> B (image coordinates, y down);
  `OUT` is the opposite. A zone with `countDirection` `A_TO_B` counts `IN`, `B_TO_A` counts `OUT`, `EITHER` counts both.
  Crossings in the other direction are reported with `countDelta: 0`.
- A track is counted once per line (`countOncePerTrackPerRule`); track ids contain the session id.
- Event keys are `trackId:zoneId:type:occurrence`, so a retry never counts twice. The API also de-duplicates.
- Site time zone (from the API) decides the after-hours window.
- Undeliverable events (API down, 5xx, 429) go to the on-disk spool with growing delays; refused events (4xx) are dropped.

## Tests
`npm run test:worker` (needs `pip install -r requirements.txt`). The events it produces are written to
`tests/fixtures/events.json` and checked against the API's schema by a backend test.
