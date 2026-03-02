"""
apps/pop_it/pop_it.py — "Pop It" mini-game.

Players use their index finger to pop falling colored balls within a 30-second
session, then view their score and choose to replay or exit.
"""

import cv2
import time
import random
import math

from ..base import BaseApp

# ── Constants ─────────────────────────────────────────────────────────────────

_GAME_DURATION = 30          # seconds

_BALL_COLORS = [             # BGR
    (0,   80, 255),          # red
    (0,  165, 255),          # orange
    (0,  230, 255),          # yellow
    (30, 255, 120),          # green
    (255, 200,  20),         # cyan
    (255,  60,  60),         # blue
    (200,   0, 200),         # purple
    (255,   0, 160),         # pink
    (160, 255,   0),         # lime
]

_SPEED_MIN    = 120          # px / s
_SPEED_MAX    = 340
_RADIUS_MIN   = 28
_RADIUS_MAX   = 58
_SPAWN_MIN    = 0.5          # seconds between ball spawns
_SPAWN_MAX    = 1.5
_POP_DURATION = 0.35         # seconds a pop-burst lasts
_BTN_COOLDOWN = 0.75         # seconds between button triggers


# ── Internal data classes ─────────────────────────────────────────────────────

class _Ball:
    __slots__ = ("x", "y", "radius", "speed", "color")

    def __init__(self, x, y, radius, speed, color):
        self.x      = float(x)
        self.y      = float(y)
        self.radius = radius
        self.speed  = speed
        self.color  = color


class _PopEffect:
    __slots__ = ("x", "y", "radius", "color", "born")

    def __init__(self, x, y, radius, color):
        self.x      = x
        self.y      = y
        self.radius = radius
        self.color  = color
        self.born   = time.time()


# ── App ───────────────────────────────────────────────────────────────────────

class PopItGame(BaseApp):
    """Pop It mini-game rendered as an OpenCV overlay."""

    def __init__(self):
        self._state      = "idle"   # "idle" | "active" | "end"
        self.score       = 0
        self._balls:   list[_Ball]      = []
        self._effects: list[_PopEffect] = []
        self._game_start  = 0.0
        self._next_spawn  = 0.0
        self._last_tick   = 0.0
        self._btn_times: dict[str, float] = {}

    # ── BaseApp interface ─────────────────────────────────────────────────────

    @property
    def is_idle(self) -> bool:
        return self._state == "idle"

    def process_fingertip(self, fx: int, fy: int, w: int, h: int) -> None:
        self._check_buttons(fx, fy, w, h)
        if self._state == "active":
            self._try_pop(fx, fy)

    def update_and_draw(self, frame) -> None:
        h, w   = frame.shape[:2]
        now    = time.time()
        dt     = now - self._last_tick if self._last_tick else 0.0
        self._last_tick = now

        if self._state == "active":
            self._update(now, dt, w, h)
            self._draw_active(frame, w, h, now)
        elif self._state == "end":
            self._draw_end(frame, w, h)

        # Trigger button is always drawn in idle
        if self._state == "idle":
            self._draw_button(frame, w, h)

    # ── Game flow ─────────────────────────────────────────────────────────────

    def _start(self):
        now = time.time()
        self._state      = "active"
        self.score       = 0
        self._balls      = []
        self._effects    = []
        self._game_start = now
        self._next_spawn = now + random.uniform(_SPAWN_MIN, _SPAWN_MAX)
        self._last_tick  = now

    def _end(self):
        self._state  = "end"
        self._balls  = []

    def _exit(self):
        self._state   = "idle"
        self._balls   = []
        self._effects = []

    # ── Update ────────────────────────────────────────────────────────────────

    def _update(self, now: float, dt: float, w: int, h: int):
        if now - self._game_start >= _GAME_DURATION:
            self._end()
            return

        # Spawn a new ball
        if now >= self._next_spawn:
            r = random.randint(_RADIUS_MIN, _RADIUS_MAX)
            self._balls.append(_Ball(
                x      = random.randint(r, w - r),
                y      = -r,
                radius = r,
                speed  = random.uniform(_SPEED_MIN, _SPEED_MAX),
                color  = random.choice(_BALL_COLORS),
            ))
            self._next_spawn = now + random.uniform(_SPAWN_MIN, _SPAWN_MAX)

        # Move balls, remove those that have left the screen
        alive = []
        for b in self._balls:
            b.y += b.speed * dt
            if b.y - b.radius < h:
                alive.append(b)
        self._balls = alive

        # Expire old pop effects
        self._effects = [e for e in self._effects
                         if now - e.born < _POP_DURATION]

    # ── Interaction ───────────────────────────────────────────────────────────

    def _try_pop(self, fx: int, fy: int):
        for ball in self._balls:
            if math.hypot(fx - ball.x, fy - ball.y) <= ball.radius:
                self._balls.remove(ball)
                self._effects.append(
                    _PopEffect(ball.x, ball.y, ball.radius, ball.color)
                )
                self.score += 1
                return  # one pop per frame per finger

    def _check_buttons(self, fx: int, fy: int, w: int, h: int):
        now = time.time()

        def _ok(name: str) -> bool:
            if now - self._btn_times.get(name, 0) >= _BTN_COOLDOWN:
                self._btn_times[name] = now
                return True
            return False

        if self._state == "idle":
            if self._in(fx, fy, *self._btn_popit(w, h)) and _ok("start"):
                self._start()
        elif self._state == "end":
            if self._in(fx, fy, *self._btn_restart(w, h)) and _ok("restart"):
                self._start()
            elif self._in(fx, fy, *self._btn_exit(w, h)) and _ok("exit"):
                self._exit()

    @staticmethod
    def _in(fx, fy, x1, y1, x2, y2) -> bool:
        return x1 <= fx <= x2 and y1 <= fy <= y2

    # ── Button rects (x1, y1, x2, y2) ────────────────────────────────────────

    @staticmethod
    def _btn_popit(w, h):
        return (w - 160, 12, w - 12, 66)

    @staticmethod
    def _btn_restart(w, h):
        cx, cy = w // 2, h // 2 + 60
        return (cx - 150, cy - 28, cx - 10, cy + 28)

    @staticmethod
    def _btn_exit(w, h):
        cx, cy = w // 2, h // 2 + 60
        return (cx + 10, cy - 28, cx + 150, cy + 28)

    # ── Drawing ───────────────────────────────────────────────────────────────

    def _draw_button(self, frame, w, h):
        x1, y1, x2, y2 = self._btn_popit(w, h)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (30, 160, 255), -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
        cv2.putText(frame, "Pop It!", (x1 + 10, y1 + 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.78, (255, 255, 255), 2)

    def _draw_active(self, frame, w, h, now: float):
        # Balls
        for ball in self._balls:
            x, y, r = int(ball.x), int(ball.y), ball.radius
            cv2.circle(frame, (x, y), r, ball.color, -1)
            cv2.circle(frame, (x, y), r, (255, 255, 255), 2)

        # Pop burst rings
        for e in self._effects:
            progress = (now - e.born) / _POP_DURATION
            for ring in range(3):
                r     = int(e.radius + ring * 14 + progress * 55)
                alpha = max(0.0, 1.0 - progress - ring * 0.25)
                if alpha <= 0:
                    continue
                overlay = frame.copy()
                cv2.circle(overlay, (int(e.x), int(e.y)), r, e.color, 3)
                cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)

        # Timer — top-center
        remaining   = max(0.0, _GAME_DURATION - (now - self._game_start))
        secs        = int(math.ceil(remaining))
        timer_color = (0, 255, 255) if remaining > 10 else (0, 90, 255)
        timer_txt   = f"{secs}s"
        (tw, _), _  = cv2.getTextSize(timer_txt, cv2.FONT_HERSHEY_SIMPLEX, 1.5, 3)
        cv2.putText(frame, timer_txt, (w // 2 - tw // 2, 55),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.5, timer_color, 3)

        # Score — top-left
        score_txt = f"Score: {self.score}"
        cv2.rectangle(frame, (10, 10), (220, 62), (0, 0, 0), -1)
        cv2.rectangle(frame, (10, 10), (220, 62), (50, 220, 100), 2)
        cv2.putText(frame, score_txt, (20, 48),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.1, (50, 255, 120), 2)

    def _draw_end(self, frame, w, h):
        # Dark overlay
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (w, h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

        cx, cy = w // 2, h // 2

        # Title
        title      = "Game Over!"
        (tw, _), _ = cv2.getTextSize(title, cv2.FONT_HERSHEY_SIMPLEX, 2.2, 4)
        cv2.putText(frame, title, (cx - tw // 2, cy - 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 2.2, (0, 240, 255), 4)

        # Score
        score_txt  = f"Score: {self.score}"
        (sw, _), _ = cv2.getTextSize(score_txt, cv2.FONT_HERSHEY_SIMPLEX, 1.6, 3)
        cv2.putText(frame, score_txt, (cx - sw // 2, cy - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 255, 255), 3)

        # Restart button
        x1, y1, x2, y2 = self._btn_restart(w, h)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (30, 180, 30), -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
        lbl        = "Restart"
        (lw, _), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
        cv2.putText(frame, lbl, (x1 + (x2 - x1 - lw) // 2, y1 + 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 255, 255), 2)

        # Exit button
        x1, y1, x2, y2 = self._btn_exit(w, h)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (30, 30, 200), -1)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)
        lbl        = "Exit"
        (lw, _), _ = cv2.getTextSize(lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
        cv2.putText(frame, lbl, (x1 + (x2 - x1 - lw) // 2, y1 + 38),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 255, 255), 2)

        # Prompt
        prompt     = "Touch a button with your index finger"
        (pw, _), _ = cv2.getTextSize(prompt, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        cv2.putText(frame, prompt, (cx - pw // 2, cy + 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)
