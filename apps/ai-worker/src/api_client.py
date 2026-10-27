"""The worker's only way to talk to the API: service-token header, timeouts, no exceptions to the caller."""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional, Tuple

import config


class ApiClient:
    def __init__(self, base_url: str = config.BACKEND_URL, token: str = config.SERVICE_TOKEN):
        self.base_url = base_url
        self.token = token

    def _headers(self, extra: Optional[dict] = None) -> dict:
        headers = {"x-service-token": self.token, "Accept": "application/json"}
        if extra:
            headers.update(extra)
        return headers

    def _send(self, req: urllib.request.Request) -> Tuple[int, dict]:
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8"))
            except Exception:  # noqa: BLE001 - an error body that is not JSON
                return e.code, {}
        except Exception as e:  # noqa: BLE001 - network down, DNS, timeout: the caller treats 0 as "could not reach"
            return 0, {"error": str(e)}

    def get_json(self, path: str, query: Optional[dict] = None) -> Tuple[int, dict]:
        url = self.base_url + path + (("?" + urllib.parse.urlencode(query)) if query else "")
        return self._send(urllib.request.Request(url, headers=self._headers()))

    def post_json(self, path: str, payload: dict, extra_headers: Optional[dict] = None) -> Tuple[int, dict]:
        headers = self._headers({"Content-Type": "application/json", **(extra_headers or {})})
        req = urllib.request.Request(self.base_url + path, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        return self._send(req)

    def upload_snapshot(self, site_id: str, camera_id: str, jpeg_bytes: bytes) -> Optional[str]:
        """Uploads a picture; the API chooses the storage key and returns it. None when it could not be stored."""
        try:
            import requests  # type: ignore

            resp = requests.post(
                f"{self.base_url}/internal/v1/evidence/upload",
                headers={"x-service-token": self.token},
                data={"siteId": site_id, "cameraId": camera_id},
                files={"file": ("snapshot.jpg", jpeg_bytes, "image/jpeg")},
                timeout=10,
            )
            if resp.status_code == 201:
                return resp.json().get("data", {}).get("objectKey")
        except Exception as e:  # noqa: BLE001 - a picture must never crash the worker
            print(f"[snapshot upload failed] {e}")
        return None
