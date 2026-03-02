"""
main.py — Entry point.

Owns the webcam loop and MediaPipe session.
To add a new app: import it and append an instance to `apps`.
"""

import cv2
import mediapipe as mp

from tracker import (
    download_model,
    setup_landmarker,
    draw_info,
    draw_landmarks,
    draw_index_tip_cursor,
)
from apps.pop_it import PopItGame
from apps.draw import DrawApp


def main():
    download_model()

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Error: Could not open webcam.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT,  720)

    print("Hand Detector running — press Q to quit.")

    # ── Register apps here ────────────────────────────────────────────────────
    apps = [
        PopItGame(),
        DrawApp(),
        # MyNextApp(),
    ]
    # ─────────────────────────────────────────────────────────────────────────

    with setup_landmarker() as landmarker:
        start_ms = None

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)

            if start_ms is None:
                start_ms = cv2.getTickCount()
            timestamp_ms = int(
                (cv2.getTickCount() - start_ms) / cv2.getTickFrequency() * 1000
            )

            rgb      = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result   = landmarker.detect_for_video(mp_image, timestamp_ms)

            h, w, _ = frame.shape

            # Feed every detected hand to all apps
            if result and result.hand_landmarks:
                for landmarks in result.hand_landmarks:
                    tip  = landmarks[8]
                    fx   = int(tip.x * w)
                    fy   = int(tip.y * h)
                    for app in apps:
                        app.process_fingertip(fx, fy, w, h)
                        app.process_hand(landmarks, w, h)

            # Draw hand skeleton/labels — full info in idle, skeleton-only in game
            any_active = any(not app.is_idle for app in apps)
            if not any_active:
                draw_info(frame, result)
            elif result and result.hand_landmarks:
                for landmarks in result.hand_landmarks:
                    draw_landmarks(frame, landmarks, h, w)
                    draw_index_tip_cursor(frame, landmarks, h, w)

            # Render each app's overlay
            for app in apps:
                app.update_and_draw(frame)

            cv2.putText(frame, "Press Q to quit",
                        (w - 205, h - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (160, 160, 160), 1)

            cv2.imshow("Hand & Finger Detector", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
