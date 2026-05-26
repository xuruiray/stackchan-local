#!/usr/bin/env python3
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("GLOG_minloglevel", "2")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

try:
    import mediapipe as mp
    import numpy as np
    from PIL import Image
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
except Exception as exc:
    print(f"Face detector dependencies are unavailable: {exc}", file=sys.stderr, flush=True)
    raise SystemExit(2)


DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "face_landmarker.task"
MODEL_PATH = Path(os.environ.get("STACKCHAN_FACE_LANDMARKER_MODEL", str(DEFAULT_MODEL_PATH))).expanduser()
MAX_FACES = int(os.environ.get("STACKCHAN_FACE_TRACKING_MAX_FACES", "1"))
MIN_DETECTION_CONFIDENCE = float(os.environ.get("STACKCHAN_FACE_TRACKING_MIN_DETECTION_CONFIDENCE", "0.25"))
MIN_PRESENCE_CONFIDENCE = float(os.environ.get("STACKCHAN_FACE_TRACKING_MIN_PRESENCE_CONFIDENCE", "0.25"))
MIN_TRACKING_CONFIDENCE = float(os.environ.get("STACKCHAN_FACE_TRACKING_MIN_TRACKING_CONFIDENCE", "0.25"))

LANDMARKER = None


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def create_landmarker():
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"MediaPipe face landmarker model not found at {MODEL_PATH}. "
            "Run `npm run vision:model` from the project root."
        )

    options = vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=max(1, MAX_FACES),
        min_face_detection_confidence=clamp(MIN_DETECTION_CONFIDENCE, 0.0, 1.0),
        min_face_presence_confidence=clamp(MIN_PRESENCE_CONFIDENCE, 0.0, 1.0),
        min_tracking_confidence=clamp(MIN_TRACKING_CONFIDENCE, 0.0, 1.0),
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    return vision.FaceLandmarker.create_from_options(options)


def landmarker():
    global LANDMARKER
    if LANDMARKER is None:
        LANDMARKER = create_landmarker()
    return LANDMARKER


def normalized_bbox(landmarks):
    xs = [float(landmark.x) for landmark in landmarks]
    ys = [float(landmark.y) for landmark in landmarks]
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    pad_x = max((x2 - x1) * 0.08, 0.015)
    pad_y = max((y2 - y1) * 0.10, 0.015)
    x1 = clamp(x1 - pad_x, 0.0, 1.0)
    y1 = clamp(y1 - pad_y, 0.0, 1.0)
    x2 = clamp(x2 + pad_x, 0.0, 1.0)
    y2 = clamp(y2 + pad_y, 0.0, 1.0)
    return {
        "x": x1,
        "y": y1,
        "width": max(0.001, x2 - x1),
        "height": max(0.001, y2 - y1),
    }


def decode_jpeg(data_base64):
    raw = base64.b64decode(data_base64)
    image = Image.open(BytesIO(raw)).convert("RGB")
    return np.asarray(image)


def detect_faces(message):
    frame_id = message["frameId"]
    timestamp_ms = int(message.get("timestampMs") or 0)
    if timestamp_ms < 0:
        timestamp_ms = 0

    image_array = decode_jpeg(message["dataBase64"])
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_array)
    result = landmarker().detect_for_video(mp_image, timestamp_ms)

    face_landmarks = getattr(result, "face_landmarks", None) or []
    faces = []
    for index, landmarks in enumerate(face_landmarks):
        face = normalized_bbox(landmarks)
        face.update(
            {
                "confidence": 1.0,
                "trackingId": f"face-{index}",
                "detector": "mediapipe_tasks_face_landmarker",
            }
        )
        faces.append(face)

    return {"frameId": frame_id, "faces": faces}


def main():
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

    if LANDMARKER is not None:
        LANDMARKER.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
