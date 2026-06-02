#!/usr/bin/env python3
import base64
import json
import os
from pathlib import Path
import sys

try:
    import cv2
    import numpy as np
except Exception as exc:
    print(f"OpenCV dependencies are unavailable: {exc}", file=sys.stderr, flush=True)
    raise SystemExit(2)


DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "face_detection_yunet_2023mar.onnx"


def clamp01(value):
    return max(0.0, min(1.0, float(value)))


def parse_float_env(name, fallback, min_value, max_value):
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return fallback
    try:
        value = float(raw)
    except ValueError:
        return fallback
    return max(min_value, min(max_value, value))


def parse_int_env(name, fallback, min_value, max_value):
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return max(min_value, min(max_value, value))


class YuNetFaceDetector:
    def __init__(self):
        self.model_path = Path(os.environ.get("STACKCHAN_FACE_TRACKING_YUNET_MODEL", str(DEFAULT_MODEL_PATH)))
        self.score_threshold = parse_float_env("STACKCHAN_FACE_TRACKING_YUNET_SCORE_THRESHOLD", 0.85, 0.0, 1.0)
        self.nms_threshold = parse_float_env("STACKCHAN_FACE_TRACKING_YUNET_NMS_THRESHOLD", 0.3, 0.0, 1.0)
        self.top_k = parse_int_env("STACKCHAN_FACE_TRACKING_YUNET_TOP_K", 500, 1, 5000)
        self.detector = None
        self.input_size = None

    def ensure_ready(self):
        if not self.model_path.exists():
            raise RuntimeError(f"YuNet model not found: {self.model_path}")
        if not hasattr(cv2, "FaceDetectorYN_create"):
            raise RuntimeError("OpenCV FaceDetectorYN_create is unavailable")

    def set_input_size(self, width, height):
        input_size = (int(width), int(height))
        if self.detector is None:
            self.detector = cv2.FaceDetectorYN_create(
                str(self.model_path),
                "",
                input_size,
                score_threshold=self.score_threshold,
                nms_threshold=self.nms_threshold,
                top_k=self.top_k,
            )
            self.input_size = input_size
            return
        if input_size != self.input_size:
            self.detector.setInputSize(input_size)
            self.input_size = input_size

    def detect(self, image):
        height, width = image.shape[:2]
        self.set_input_size(width, height)
        _, faces = self.detector.detect(image)
        if faces is None:
            return []
        return [normalize_yunet_face(face, width, height) for face in faces]


def point(x, y, width, height):
    return {"x": clamp01(x / width), "y": clamp01(y / height)}


def normalize_yunet_face(face, width, height):
    x, y, w, h = [float(value) for value in face[:4]]
    right_eye = point(face[4], face[5], width, height)
    left_eye = point(face[6], face[7], width, height)
    nose = point(face[8], face[9], width, height)
    mouth_right = point(face[10], face[11], width, height)
    mouth_left = point(face[12], face[13], width, height)
    return {
        "x": clamp01(x / width),
        "y": clamp01(y / height),
        "width": clamp01(w / width),
        "height": clamp01(h / height),
        "confidence": clamp01(face[14]),
        "detector": "yunet",
        "landmarks": {
            "all": [right_eye, left_eye, nose, mouth_right, mouth_left],
            "leftEye": left_eye,
            "rightEye": right_eye,
            "nose": nose,
            "mouthLeft": mouth_left,
            "mouthRight": mouth_right,
            "mouthCenter": {
                "x": clamp01((mouth_left["x"] + mouth_right["x"]) / 2),
                "y": clamp01((mouth_left["y"] + mouth_right["y"]) / 2),
            },
        },
    }


DETECTOR = YuNetFaceDetector()


def detect_faces(message):
    frame_id = message["frameId"]
    raw = base64.b64decode(message["dataBase64"])
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return {"frameId": frame_id, "error": "failed to decode jpeg"}

    return {"frameId": frame_id, "faces": DETECTOR.detect(image)}


def main():
    try:
        DETECTOR.ensure_ready()
    except Exception as exc:
        print(str(exc), file=sys.stderr, flush=True)
        return 2

    for line in sys.stdin:
        try:
            message = json.loads(line)
            result = detect_faces(message)
        except Exception as exc:
            frame_id = None
            try:
                frame_id = json.loads(line).get("frameId")
            except Exception:
                pass
            result = {"frameId": frame_id or "unknown", "error": str(exc)}

        print(json.dumps(result, separators=(",", ":")), flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
