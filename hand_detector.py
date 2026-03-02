import cv2
import mediapipe as mp
import urllib.request
import os

from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
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


def get_raised_fingers(landmarks, handedness_label):
    """
    Returns a list of finger names that are raised.
    handedness_label: "Left" or "Right" as reported by MediaPipe
    (already corrected for mirror flip in the caller).
    """
    raised = []

    thumb_tip_x = landmarks[FINGER_TIPS[0]].x
    thumb_ip_x = landmarks[FINGER_PIPS[0]].x

    # In mirrored (selfie) view the logic is flipped between hands
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
    """Draw skeleton lines and joint dots."""
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]

    for conn in HAND_CONNECTIONS:
        cv2.line(frame, pts[conn.start], pts[conn.end], (0, 200, 0), 2)

    for pt in pts:
        cv2.circle(frame, pt, 4, (255, 255, 255), -1)
        cv2.circle(frame, pt, 4, (0, 150, 0), 1)


def draw_info(frame, result):
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
        raw_label = handedness_list[0].category_name
        display_label = "Right" if raw_label == "Left" else "Left"

        raised = get_raised_fingers(landmarks, raw_label)
        count = len(raised)

        y = 55 + idx * 165
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
        cv2.putText(frame, str(count), (wx - 10 if count < 10 else wx - 14, wy - 17),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2)


def main():
    download_model()

    base_opts = mp_python.BaseOptions(model_asset_path=MODEL_PATH)
    opts = HandLandmarkerOptions(
        base_options=base_opts,
        running_mode=RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.6,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: Could not open webcam.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    print("Hand Detector running — press Q to quit.")

    with HandLandmarker.create_from_options(opts) as landmarker:
        start_ms = None

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)

            timestamp_ms = int(cap.get(cv2.CAP_PROP_POS_MSEC))
            # Ensure timestamp is always increasing (some cameras report 0)
            if start_ms is None:
                start_ms = cv2.getTickCount()
            timestamp_ms = int((cv2.getTickCount() - start_ms) / cv2.getTickFrequency() * 1000)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            draw_info(frame, result)

            cv2.putText(frame, "Press Q to quit",
                        (frame.shape[1] - 205, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)

            cv2.imshow("Hand & Finger Detector", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
