"""
tracker.py — Core hand-detection utilities.

Owns the MediaPipe model, landmark drawing, and hand-info display.
Nothing in here knows about any specific app or game.
"""

import cv2
import mediapipe as mp
import urllib.request
import os

from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python.vision import (
    HandLandmarker,
    HandLandmarkerOptions,
    HandLandmarksConnections,
    RunningMode,
)

MODEL_PATH = "hand_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)

# Landmark indices
FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_PIPS = [3, 6, 10, 14, 18]
FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

HAND_CONNECTIONS = HandLandmarksConnections.HAND_CONNECTIONS


def download_model():
    if not os.path.exists(MODEL_PATH):
        print("Downloading hand landmarker model (~3 MB)...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        print("Model ready.")


def setup_landmarker():
    """Return a configured HandLandmarker context manager (VIDEO mode)."""
    base_opts = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    opts = HandLandmarkerOptions(
        base_options=base_opts,
        running_mode=RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.6,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return HandLandmarker.create_from_options(opts)


def get_raised_fingers(landmarks, handedness_label):
    """
    Return list of raised finger names for one hand.
    handedness_label: "Left" or "Right" as reported by MediaPipe
    (already corrected for mirror flip in the caller).
    """
    raised = []

    thumb_tip_x = landmarks[FINGER_TIPS[0]].x
    thumb_ip_x  = landmarks[FINGER_PIPS[0]].x

    if handedness_label == "Left":
        if thumb_tip_x < thumb_ip_x:
            raised.append("Thumb")
    else:
        if thumb_tip_x > thumb_ip_x:
            raised.append("Thumb")

    for i in range(1, 5):
        if landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y:
            raised.append(FINGER_NAMES[i])

    return raised


def draw_landmarks(frame, landmarks, h, w):
    """Draw skeleton lines and joint dots for one hand."""
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]

    for conn in HAND_CONNECTIONS:
        cv2.line(frame, pts[conn.start], pts[conn.end], (0, 200, 0), 2)

    for pt in pts:
        cv2.circle(frame, pt, 4, (255, 255, 255), -1)
        cv2.circle(frame, pt, 4, (0, 150, 0), 1)


def draw_index_tip_cursor(frame, landmarks, h, w):
    """Draw a bright ring at the index finger tip — useful during mini-games."""
    tip = landmarks[8]
    x, y = int(tip.x * w), int(tip.y * h)
    cv2.circle(frame, (x, y), 14, (0, 240, 255), 2)
    cv2.circle(frame, (x, y),  4, (0, 240, 255), -1)


def draw_info(frame, result):
    """Draw full hand info (skeleton + labels + finger count) for all detected hands."""
    h, w, _ = frame.shape

    if not result or not result.hand_landmarks:
        cv2.putText(frame, "No hands detected", (20, 45),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 220), 2)
        return

    for idx, (landmarks, handedness_list) in enumerate(
        zip(result.hand_landmarks, result.handedness)
    ):
        draw_landmarks(frame, landmarks, h, w)

        # MediaPipe labels are mirrored in selfie view — swap for natural display
        raw_label     = handedness_list[0].category_name
        display_label = "Right" if raw_label == "Left" else "Left"

        raised = get_raised_fingers(landmarks, raw_label)
        count  = len(raised)

        y     = 55 + idx * 165
        color = (50, 220, 120) if display_label == "Right" else (220, 130, 50)

        cv2.putText(frame, f"{display_label} Hand", (20, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.95, color, 2)
        cv2.putText(frame, f"Fingers up: {count}", (20, y + 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.78, (255, 255, 255), 2)
        cv2.putText(frame, (", ".join(raised) if raised else "Fist"),
                    (20, y + 74), cv2.FONT_HERSHEY_SIMPLEX, 0.68, color, 2)

        # Count badge near wrist
        wx = int(landmarks[0].x * w)
        wy = int(landmarks[0].y * h)
        cv2.circle(frame, (wx, wy - 25), 22, color, -1)
        cv2.putText(frame, str(count),
                    (wx - 10 if count < 10 else wx - 14, wy - 17),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2)
