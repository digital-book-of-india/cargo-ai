"""DBI Intelligence — AI Monitoring Worker.

Currently heartbeat-only: the cargo detector and tracker are not built yet, so the worker
reports DEGRADED (never ONLINE) and watches no streams. See docs for the cargo pipeline plan.
"""

import os
import sys
import time
import json
import threading
import datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")  # avoid garbled output on Windows consoles
except Exception:
    pass

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except ImportError:
    pass

try:
    import requests  # type: ignore
except ImportError:
    requests = None

import urllib.request
import urllib.error


BACKEND_URL = (os.getenv("BACKEND_URL") or os.getenv("BACKEND_BASE_URL", "http://localhost:4000")).rstrip("/")
AI_SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "dbi-ai-worker-secret-token")
WORKER_ID = os.getenv("WORKER_ID", "worker-1")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "30"))

_stop = threading.Event()
_active_streams_lock = threading.Lock()
_active_streams = 0


def post_json(endpoint: str, payload: dict) -> "tuple[int, dict]":
    """Helper to send HTTP POST requests with x-service-token."""
    url = f"{BACKEND_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-service-token": AI_SERVICE_TOKEN,
    }

    if requests is not None:
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=8)
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            return resp.status_code, body
        except Exception as e:
            return 0, {"error": str(e)}

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            status = response.getcode()
            body = json.loads(response.read().decode("utf-8"))
            return status, body
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def get_json(endpoint: str) -> "tuple[int, dict]":
    url = f"{BACKEND_URL}{endpoint}"
    headers = {"x-service-token": AI_SERVICE_TOKEN}

    if requests is not None:
        try:
            resp = requests.get(url, headers=headers, timeout=8)
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            return resp.status_code, body
        except Exception as e:
            return 0, {"error": str(e)}

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return response.getcode(), json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def send_heartbeat(status: str = "DEGRADED") -> bool:
    with _active_streams_lock:
        streams = _active_streams
    payload = {
        "serviceName": WORKER_ID,
        "status": status,
        "activeStreams": streams,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    status_code, resp = post_json("/internal/v1/ai/health", payload)
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    if status_code == 200:
        print(f"[{ts}] Heartbeat sent (status={status}, activeStreams={streams})")
        return True
    print(f"[{ts}] Heartbeat failed (code {status_code}): {resp}")
    return False


def main() -> None:
    print("=========================================")
    print("  DBI Intelligence - AI Monitoring Worker")
    print(f"  Backend: {BACKEND_URL}")
    print("  No detector is installed yet: reporting DEGRADED, watching no streams.")
    print("=========================================")

    send_heartbeat(status="DEGRADED")

    print(f"Starting heartbeat loop (interval: {HEARTBEAT_INTERVAL}s). Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(HEARTBEAT_INTERVAL)
            send_heartbeat(status="DEGRADED")
    except KeyboardInterrupt:
        print("\nAI Worker shutting down gracefully.")
        _stop.set()
        send_heartbeat(status="OFFLINE")


if __name__ == "__main__":
    main()
