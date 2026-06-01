#!/usr/bin/env python3
import base64
import json
import sys

try:
    import cv2
    import numpy as np
except Exception as exc:
    print(f"OpenCV dependencies are unavailable: {exc}", file=sys.stderr, flush=True)
    raise SystemExit(2)


FRONTAL_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
PROFILE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")


def iou(a, b):
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    intersection = iw * ih
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0


def detect_faces(message):
    frame_id = message["frameId"]
    raw = base64.b64decode(message["dataBase64"])
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return {"frameId": frame_id, "error": "failed to decode jpeg"}

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    detections = []

    frontal_faces = FRONTAL_CASCADE.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=3, minSize=(20, 20))
    for face in frontal_faces:
        detections.append((tuple(face), 0.82))

    profile_faces = PROFILE_CASCADE.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=3, minSize=(20, 20))
    for face in profile_faces:
        detections.append((tuple(face), 0.68))

    flipped = cv2.flip(gray, 1)
    flipped_profile_faces = PROFILE_CASCADE.detectMultiScale(flipped, scaleFactor=1.08, minNeighbors=3, minSize=(20, 20))
    height, width = gray.shape[:2]
    for (x, y, w, h) in flipped_profile_faces:
        detections.append(((width - x - w, y, w, h), 0.68))

    detections.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
    merged = []
    for box, confidence in detections:
        if any(iou(box, existing[0]) > 0.35 for existing in merged):
            continue
        merged.append((box, confidence))

    normalized = []
    for ((x, y, w, h), confidence) in merged:
        normalized.append(
            {
                "x": max(0.0, min(1.0, float(x) / width)),
                "y": max(0.0, min(1.0, float(y) / height)),
                "width": max(0.0, min(1.0, float(w) / width)),
                "height": max(0.0, min(1.0, float(h) / height)),
                "confidence": confidence,
            }
        )

    return {"frameId": frame_id, "faces": normalized}


def main():
    if FRONTAL_CASCADE.empty() or PROFILE_CASCADE.empty():
        print("failed to load OpenCV face cascades", file=sys.stderr, flush=True)
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
