from __future__ import annotations

import base64
import binascii
import json
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import cv2
import mediapipe as mp
import numpy as np

from hand_gestures import FINGER_NAMES, finger_states_from_landmarks, predict_digit, train_digit_classifier


APP_DIR = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8000
MAX_REQUEST_BYTES = 1_500_000
MAX_IMAGE_BYTES = 1_000_000
MAX_IMAGE_PIXELS = 640 * 480
MAX_HANDS = 2
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/web.js": ("web.js", "text/javascript; charset=utf-8"),
    "/manifest.webmanifest": ("manifest.webmanifest", "application/manifest+json; charset=utf-8"),
    "/sw.js": ("sw.js", "text/javascript; charset=utf-8"),
    "/icons/icon-192.png": ("icons/icon-192.png", "image/png"),
    "/icons/icon-512.png": ("icons/icon-512.png", "image/png"),
    "/icons/apple-touch-icon.png": ("icons/apple-touch-icon.png", "image/png"),
}


class FingerNumberServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int]) -> None:
        super().__init__(address, FingerNumberHandler)
        self.classifier = train_digit_classifier()
        self.hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=MAX_HANDS,
            model_complexity=1,
            min_detection_confidence=0.7,
            min_tracking_confidence=0.7,
        )
        self.hands_lock = threading.Lock()

    def close(self) -> None:
        self.hands.close()
        super().server_close()

    def recognize(self, encoded_image: str) -> dict[str, object]:
        if not isinstance(encoded_image, str) or len(encoded_image) > MAX_IMAGE_BYTES * 2:
            raise ValueError("Ảnh nhận diện không hợp lệ hoặc vượt quá dung lượng cho phép.")
        if encoded_image.startswith("data:"):
            header, separator, encoded_image = encoded_image.partition(",")
            if not separator or header != "data:image/jpeg;base64":
                raise ValueError("Ảnh cần được gửi ở định dạng JPEG.")
        try:
            image_bytes = base64.b64decode(encoded_image, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Không giải mã được ảnh JPEG.") from error
        if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES or not image_bytes.startswith(b"\xff\xd8"):
            raise ValueError("Ảnh JPEG không hợp lệ hoặc vượt quá dung lượng cho phép.")

        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Không đọc được ảnh JPEG từ camera.")
        height, width = frame.shape[:2]
        if height < 1 or width < 1 or width * height > MAX_IMAGE_PIXELS:
            raise ValueError("Ảnh camera vượt quá giới hạn kích thước 640 × 480.")

        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with self.hands_lock:
            result = self.hands.process(image)
        if not result.multi_hand_landmarks:
            return {"detected": False, "digit": None, "hands": [], "fingers": [], "landmarks": []}

        hands = []
        for hand_landmarks in result.multi_hand_landmarks[:MAX_HANDS]:
            finger_states = finger_states_from_landmarks(hand_landmarks, (width, height))
            hands.append({
                "digit": predict_digit(self.classifier, finger_states),
                "fingers": [
                    {"name": name, "extended": extended}
                    for name, extended in zip(FINGER_NAMES, finger_states)
                ],
                "landmarks": [{"x": point.x, "y": point.y} for point in hand_landmarks.landmark],
            })
        return {
            "detected": True,
            "digit": sum(hand["digit"] for hand in hands),
            "hands": hands,
            "fingers": hands[0]["fingers"],
            "landmarks": hands[0]["landmarks"],
        }


class FingerNumberHandler(BaseHTTPRequestHandler):
    server: FingerNumberServer
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
            return
        asset = STATIC_FILES.get(path)
        if asset is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Không tìm thấy trang yêu cầu."})
            return
        file_path = APP_DIR / asset[0]
        try:
            content = file_path.read_bytes()
        except OSError as error:
            print(f"Could not read static asset {file_path.name}: {error}")
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Không đọc được tệp giao diện."})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", asset[1])
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/predict":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Không tìm thấy API yêu cầu."})
            return
        try:
            payload = self._read_json()
            self._send_json(HTTPStatus.OK, self.server.recognize(payload.get("image")))
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            return
        except (RuntimeError, cv2.error) as error:
            print(f"Could not analyze the webcam frame: {error}")
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Bộ nhận diện gặp lỗi khi phân tích khung hình."})

    def _read_json(self) -> dict[str, object]:
        content_length = self.headers.get("Content-Length")
        if content_length is None:
            raise ValueError("Yêu cầu cần có Content-Length.")
        try:
            length = int(content_length)
        except ValueError as error:
            raise ValueError("Kích thước yêu cầu không hợp lệ.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Yêu cầu vượt quá giới hạn dung lượng.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Yêu cầu cần chứa JSON hợp lệ.") from error
        if not isinstance(payload, dict):
            raise ValueError("Nội dung yêu cầu phải là một đối tượng JSON.")
        return payload

    def _send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")


def main() -> None:
    server = FingerNumberServer((HOST, PORT))
    try:
        print(f"Finger number app listening on {HOST}:{PORT}")
        if HOST == "0.0.0.0":
            print(f"On this computer, open http://127.0.0.1:{PORT}")
        else:
            print(f"Open http://{HOST}:{PORT} in a browser")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐang dừng máy chủ.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
