import base64
import json
import threading
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

import app
from hand_gestures import FINGER_NAMES


class WebServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.FingerNumberServer(("127.0.0.1", 0))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request_json(self, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"} if body else {},
            method="POST" if body else "GET",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.headers.get_content_type(), json.loads(response.read())

    def test_home_page_and_health_endpoint_are_served(self):
        status, content_type, payload = self.request_json("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"ok": True})

        with urllib.request.urlopen(f"{self.base_url}/", timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "text/html")
            html = response.read().decode("utf-8")
        self.assertIn("Đưa tay lên.", html)
        self.assertIn("/web.js", html)
        self.assertIn('./manifest.webmanifest', html)
        self.assertIn('apple-mobile-web-app-capable', html)
        web_script = (app.APP_DIR / "web.js").read_text(encoding="utf-8")
        self.assertIn("detectForVideo(video", web_script)
        self.assertIn('MEDIAPIPE_VERSION = "0.10.14"', web_script)
        self.assertNotIn('fetch("/api/predict"', web_script)
        self.assertNotIn("challenge-hud", html)
        self.assertNotIn("Bắt đầu thử thách", html)
        self.assertNotIn("stats-title", html)
        self.assertIn('id="camera-finger-count"', html)

    def test_pwa_manifest_service_worker_and_icons_are_served(self):
        with urllib.request.urlopen(f"{self.base_url}/manifest.webmanifest", timeout=5) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("manifest", response.headers.get_content_type())
            manifest = json.loads(response.read())
        self.assertEqual(manifest["short_name"], "Ngón Số")
        self.assertEqual(manifest["display"], "standalone")

        with urllib.request.urlopen(f"{self.base_url}/sw.js", timeout=5) as response:
            self.assertEqual(response.status, 200)
            service_worker = response.read().decode("utf-8")
        self.assertIn("APP_BASE.pathname", service_worker)
        self.assertIn("ASSET_CACHE_NAME", service_worker)
        self.assertIn("HAND_MODEL_PATH", service_worker)

        for path in ("/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"):
            with self.subTest(path=path):
                with urllib.request.urlopen(f"{self.base_url}{path}", timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers.get_content_type(), "image/png")
                    self.assertTrue(response.read().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_prediction_endpoint_accepts_a_camera_jpeg(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        success, jpeg = cv2.imencode(".jpg", frame)
        self.assertTrue(success)

        encoded_image = base64.b64encode(jpeg.tobytes()).decode("ascii")
        for _ in range(3):
            with self.subTest(frame="continuous"):
                status, content_type, result = self.request_json(
                    "/api/predict",
                    {"image": encoded_image},
                )
                self.assertEqual(status, 200)
                self.assertEqual(content_type, "application/json")
                self.assertFalse(result["detected"])
                self.assertIsNone(result["digit"])

    def test_practice_endpoints_are_removed(self):
        for path, method in (("/api/stats", "GET"), ("/api/attempt", "POST")):
            with self.subTest(path=path):
                request = urllib.request.Request(f"{self.base_url}{path}", method=method)
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request, timeout=5)
                self.assertEqual(error.exception.code, 404)

    def test_two_hands_are_counted_and_returned_separately(self):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        success, jpeg = cv2.imencode(".jpg", frame)
        self.assertTrue(success)
        landmarks = SimpleNamespace(
            landmark=[SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]
        )
        fake_hands = SimpleNamespace(
            process=lambda image: SimpleNamespace(multi_hand_landmarks=[landmarks, landmarks])
        )
        hand_states = [
            (True, True, True, False, False),
            (True, True, True, True, False),
        ]
        with patch.object(self.server, "hands", fake_hands):
            with patch.object(app, "finger_states_from_landmarks", side_effect=hand_states):
                status, _, result = self.request_json(
                    "/api/predict",
                    {"image": base64.b64encode(jpeg.tobytes()).decode("ascii")},
                )

        self.assertEqual(status, 200)
        self.assertEqual(result["digit"], 7)
        self.assertEqual([hand["digit"] for hand in result["hands"]], [3, 4])
        self.assertEqual([len(hand["fingers"]) for hand in result["hands"]], [len(FINGER_NAMES)] * 2)


if __name__ == "__main__":
    unittest.main()
