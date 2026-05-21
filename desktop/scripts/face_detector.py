#!/usr/bin/env python3
import base64
from io import BytesIO
import json
import math
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
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    return vision.FaceLandmarker.create_from_options(options)


def landmarker():
    global LANDMARKER
    if LANDMARKER is None:
        LANDMARKER = create_landmarker()
    return LANDMARKER


def normalized_point(landmark):
    return {
        "x": clamp(float(landmark.x), 0.0, 1.0),
        "y": clamp(float(landmark.y), 0.0, 1.0),
        "z": clamp(float(landmark.z), -1.0, 1.0),
    }


def averaged_point(landmarks, indices):
    valid = [index for index in indices if index < len(landmarks)]
    if not valid:
        return None
    count = len(valid)
    return {
        "x": clamp(sum(float(landmarks[index].x) for index in valid) / count, 0.0, 1.0),
        "y": clamp(sum(float(landmarks[index].y) for index in valid) / count, 0.0, 1.0),
        "z": clamp(sum(float(landmarks[index].z) for index in valid) / count, -1.0, 1.0),
    }


def landmark_or_none(landmarks, index):
    if index >= len(landmarks):
        return None
    return normalized_point(landmarks[index])


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


def blendshape_map(categories):
    result = {}
    for category in categories or []:
        name = getattr(category, "category_name", "") or getattr(category, "display_name", "")
        score = getattr(category, "score", None)
        if not name or score is None:
            continue
        result[name] = clamp(float(score), 0.0, 1.0)
    return result


def expression_from_blendshapes(blendshapes):
    left_blink = blendshapes.get("eyeBlinkLeft", 0.0)
    right_blink = blendshapes.get("eyeBlinkRight", 0.0)
    smile_values = [
        blendshapes.get("mouthSmileLeft"),
        blendshapes.get("mouthSmileRight"),
    ]
    smile_values = [value for value in smile_values if value is not None]
    expression = {
        "leftEyeOpen": clamp(1.0 - left_blink, 0.0, 1.0),
        "rightEyeOpen": clamp(1.0 - right_blink, 0.0, 1.0),
        "blendshapes": blendshapes,
    }
    if smile_values:
        expression["smile"] = clamp(sum(smile_values) / len(smile_values), 0.0, 1.0)
    return expression


def flatten_matrix(matrix):
    if matrix is None:
        return None
    values = np.asarray(matrix, dtype=float).reshape(-1)
    if values.size != 16:
        return None
    return [float(value) for value in values]


def pose_from_matrix(matrix):
    values = np.asarray(matrix, dtype=float)
    if values.size != 16:
        return None
    transform = values.reshape(4, 4)
    rotation = transform[:3, :3]
    yaw = math.degrees(math.atan2(rotation[0, 2], rotation[2, 2]))
    pitch = math.degrees(math.atan2(-rotation[1, 2], math.sqrt(rotation[1, 0] ** 2 + rotation[1, 1] ** 2)))
    roll = math.degrees(math.atan2(rotation[1, 0], rotation[1, 1]))
    return {
        "yawDeg": clamp(float(yaw), -180.0, 180.0),
        "pitchDeg": clamp(float(pitch), -180.0, 180.0),
        "rollDeg": clamp(float(roll), -180.0, 180.0),
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
    face_blendshapes = getattr(result, "face_blendshapes", None) or []
    transform_matrices = getattr(result, "facial_transformation_matrixes", None) or []

    faces = []
    for index, landmarks in enumerate(face_landmarks):
        face = normalized_bbox(landmarks)
        blendshapes = blendshape_map(face_blendshapes[index] if index < len(face_blendshapes) else [])
        matrix = transform_matrices[index] if index < len(transform_matrices) else None
        face.update(
            {
                "confidence": 1.0,
                "trackingId": f"face-{index}",
                "detector": "mediapipe_tasks_face_landmarker",
                "landmarks": {
                    "all": [normalized_point(landmark) for landmark in landmarks],
                    "nose": landmark_or_none(landmarks, 1),
                    "leftEye": averaged_point(landmarks, [33, 133]),
                    "rightEye": averaged_point(landmarks, [263, 362]),
                    "mouthLeft": landmark_or_none(landmarks, 61),
                    "mouthRight": landmark_or_none(landmarks, 291),
                    "mouthCenter": averaged_point(landmarks, [13, 14]),
                    "chin": landmark_or_none(landmarks, 152),
                },
                "expression": expression_from_blendshapes(blendshapes),
            }
        )
        transform_matrix = flatten_matrix(matrix)
        if transform_matrix:
            face["transformMatrix"] = transform_matrix
        pose = pose_from_matrix(matrix) if matrix is not None else None
        if pose:
            face["pose"] = pose
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
