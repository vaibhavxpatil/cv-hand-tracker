"""
apps/draw/draw.py — Finger-painting app.

Pinch index + thumb to draw on a persistent canvas overlay.
Point the index finger at a color swatch to change color.
Exit button in the top-left corner.
"""

import cv2
import numpy as np
import time
import math

from ..base import BaseApp

# ── Constants ─────────────────────────────────────────────────────────────────

# Five colors: (BGR, display name)
_PALETTE = [
    ((0,   0,   255), "Red"),
    ((0,  220,  255), "Yellow"),
    ((50, 200,    0), "Green"),
    ((255, 80,    0), "Blue"),
    ((220,  0,  220), "Purple"),
]

_STROKE_WIDTH    = 8                     # px
_ERASER_WIDTH    = _STROKE_WIDTH * 3     # 24 px — 3× the draw radius
_PINCH_THRESHOLD = 20    # px — fingers must be actually touching
_BTN_COOLDOWN    = 0.75  # seconds
_SWATCH_RADIUS   = 32    # px


class DrawApp(BaseApp):
    """Finger-painting overlay app."""

    def __init__(self):
        self._state          = "idle"
        self._canvas         = None   # np.ndarray, initialized on first active frame
        self._color_idx      = 0      # index into _PALETTE
        self._prev_pos       = None   # last drawn point (for continuous strokes)
        self._is_pinching    = False
        self._is_erasing     = False
        self._last_tip       = None   # (ix, iy) stored for eraser cursor
        self._hand_done      = False  # ensures only first hand drives drawing per frame
        self._btn_times: dict[str, float] = {}

    # ── BaseApp interface ─────────────────────────────────────────────────────

    @property
    def is_idle(self) -> bool:
        return self._state == "idle"

    def process_fingertip(self, fx: int, fy: int, w: int, h: int) -> None:
        now = time.time()

        def _ok(name: str) -> bool:
            if now - self._btn_times.get(name, 0) >= _BTN_COOLDOWN:
                self._btn_times[name] = now
                return True
            return False

        if self._state == "idle":
            if self._hit(fx, fy, *self._btn_draw(w, h)) and _ok("open"):
                self._state     = "active"
                self._canvas    = None
                self._prev_pos  = None
                self._hand_done = False

        elif self._state == "active":
            # Exit button — only register when not pinching so strokes near
            # the corner don't accidentally close the app
            if not self._is_pinching:
                if self._hit(fx, fy, *self._btn_exit(w, h)) and _ok("exit"):
                    self._state  = "idle"
                    self._canvas = None
                    self._prev_pos = None
                    return

            # Eraser toggle
            if self._hit(fx, fy, *self._btn_eraser(w, h)) and _ok("eraser"):
                self._is_erasing = not self._is_erasing
                self._prev_pos   = None

            # Color swatch selection (picking a color also exits eraser mode)
            for i, (sx, sy) in enumerate(self._swatch_positions(w, h)):
                if math.hypot(fx - sx, fy - sy) <= _SWATCH_RADIUS and _ok(f"c{i}"):
                    self._color_idx  = i
                    self._is_erasing = False

    def process_hand(self, landmarks, w: int, h: int) -> None:
        """Use thumb + index distance to detect pinch; draw on canvas."""
        if self._state != "active":
            return

        # Only let the first hand per frame drive the stroke so two
        # simultaneous hands don't produce a teleporting line
        if self._hand_done:
            return
        self._hand_done = True

        thumb = landmarks[4]   # thumb tip
        index = landmarks[8]   # index finger tip

        tx, ty = int(thumb.x * w), int(thumb.y * h)
        ix, iy = int(index.x * w), int(index.y * h)

        pinching          = math.hypot(tx - ix, ty - iy) < _PINCH_THRESHOLD
        self._is_pinching = pinching
        self._last_tip    = (ix, iy)

        if self._canvas is not None and pinching:
            if self._is_erasing:
                if self._prev_pos is not None:
                    cv2.line(self._canvas, self._prev_pos, (ix, iy),
                             (0, 0, 0), _ERASER_WIDTH, cv2.LINE_AA)
                else:
                    cv2.circle(self._canvas, (ix, iy),
                               _ERASER_WIDTH // 2, (0, 0, 0), -1)
            else:
                color = _PALETTE[self._color_idx][0]
                if self._prev_pos is not None:
                    cv2.line(self._canvas, self._prev_pos, (ix, iy),
                             color, _STROKE_WIDTH, cv2.LINE_AA)
                else:
                    # Start of a new stroke — draw a dot so tap-marks appear
                    cv2.circle(self._canvas, (ix, iy),
                               _STROKE_WIDTH // 2, color, -1, cv2.LINE_AA)

        self._prev_pos = (ix, iy) if pinching else None

    def update_and_draw(self, frame) -> None:
        h, w = frame.shape[:2]
        self._hand_done = False   # reset for next frame

        if self._state == "idle":
            self._draw_trigger_button(frame, w, h)
            return

        # ── Initialize canvas ──────────────────────────────────────────────
        if self._canvas is None or self._canvas.shape[:2] != (h, w):
            self._canvas = np.zeros((h, w, 3), dtype=np.uint8)

        # ── Blend drawn strokes onto video feed ───────────────────────────
        mask = self._canvas.any(axis=2)
        if mask.any():
            blended = cv2.addWeighted(frame, 0.35, self._canvas, 0.65, 0)
            frame[mask] = blended[mask]

        # ── Color palette (bottom-center) ─────────────────────────────────
        for i, ((sx, sy), (color, name)) in enumerate(
            zip(self._swatch_positions(w, h), _PALETTE)
        ):
            cv2.circle(frame, (sx, sy), _SWATCH_RADIUS, color, -1)
            cv2.circle(frame, (sx, sy), _SWATCH_RADIUS, (255, 255, 255), 2)
            if i == self._color_idx:
                # Highlight selected swatch
                cv2.circle(frame, (sx, sy), _SWATCH_RADIUS + 7, (255, 255, 255), 3)
                # Label below swatch
                (lw, _), _ = cv2.getTextSize(name, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
                cv2.putText(frame, name,
                            (sx - lw // 2, sy + _SWATCH_RADIUS + 20),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

        # ── Eraser cursor (drawn before UI so it doesn't cover buttons) ───
        if self._is_erasing and self._last_tip is not None:
            cv2.circle(frame, self._last_tip, _ERASER_WIDTH // 2,
                       (200, 200, 200), 2, cv2.LINE_AA)

        # ── Eraser toggle button (bottom-right) ───────────────────────────
        self._draw_eraser_button(frame, w, h)

        # ── Pinch status hint ─────────────────────────────────────────────
        if self._is_erasing and self._is_pinching:
            hint, hint_color = "Erasing...",   (200, 200, 200)
        elif self._is_erasing:
            hint, hint_color = "Pinch to erase", (200, 200, 200)
        elif self._is_pinching:
            hint, hint_color = "Drawing...",   _PALETTE[self._color_idx][0]
        else:
            hint, hint_color = "Pinch to draw", (255, 255, 255)
        (hw, _), _ = cv2.getTextSize(hint, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
        cv2.putText(frame, hint, (w // 2 - hw // 2, h - 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, hint_color, 2)

        # ── Exit button (top-left) ────────────────────────────────────────
        self._draw_exit_button(frame, w, h)

    # ── Button / layout helpers ───────────────────────────────────────────────

    @staticmethod
    def _btn_draw(w, h):
        """Trigger button: top-right, directly below Pop It."""
        return (w - 160, 76, w - 12, 130)

    @staticmethod
    def _btn_exit(w, h):
        """Exit button: top-right corner."""
        return (w - 160, 12, w - 12, 56)

    @staticmethod
    def _btn_eraser(w, h):
        """Eraser toggle button: bottom-right corner."""
        return (w - 120, h - 85, w - 10, h - 45)

    @staticmethod
    def _swatch_positions(w, h):
        """Five color swatches in a horizontal row near the bottom-center."""
        spacing    = 80
        total_w    = (len(_PALETTE) - 1) * spacing
        start_x    = w // 2 - total_w // 2
        y          = h - 60
        return [(start_x + i * spacing, y) for i in range(len(_PALETTE))]

    @staticmethod
    def _hit(fx, fy, x1, y1, x2, y2) -> bool:
        return x1 <= fx <= x2 and y1 <= fy <= y2

    def _draw_trigger_button(self, frame, w, h):
        x1, y1, x2, y2 = self._btn_draw(w, h)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (180, 60, 220), -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
        cv2.putText(frame, "Draw", (x1 + 32, y1 + 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.78, (255, 255, 255), 2)

    def _draw_eraser_button(self, frame, w, h):
        x1, y1, x2, y2 = self._btn_eraser(w, h)
        bg     = (80, 80, 80)   if self._is_erasing else (50, 50, 50)
        border = (255, 255, 0)  if self._is_erasing else (180, 180, 180)
        cv2.rectangle(frame, (x1, y1), (x2, y2), bg, -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), border, 2)
        lbl        = "ERASER" if self._is_erasing else "Eraser"
        (lw, _), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.putText(frame, lbl,
                    (x1 + (x2 - x1 - lw) // 2, y1 + 26),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

    def _draw_exit_button(self, frame, w, h):
        x1, y1, x2, y2 = self._btn_exit(w, h)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (40, 40, 180), -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
        lbl        = "Exit"
        (lw, _), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.72, 2)
        cv2.putText(frame, lbl,
                    (x1 + (x2 - x1 - lw) // 2, y1 + 33),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.72, (255, 255, 255), 2)
