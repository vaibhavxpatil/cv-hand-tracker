"""
apps/base.py — Contract every hand-tracking mini-app must follow.

To add a new app:
  1. Create apps/my_app.py
  2. Subclass BaseApp and implement the three abstract members
  3. Import and add an instance to the `apps` list in main.py
"""

from abc import ABC, abstractmethod


class BaseApp(ABC):
    """
    main.py calls these methods each frame in this order:
      1. process_fingertip(fx, fy, w, h)  — once per detected index-finger tip
      2. update_and_draw(frame)            — once per frame to render the overlay

    It also checks `is_idle` to decide whether to show full hand-tracking labels
    or just the skeleton (so game HUDs aren't cluttered with hand info text).
    """

    @abstractmethod
    def process_fingertip(self, fx: int, fy: int, w: int, h: int) -> None:
        """Handle an index-finger tip at pixel (fx, fy) in a frame of size w×h."""

    @abstractmethod
    def update_and_draw(self, frame) -> None:
        """Update internal state and render overlay onto frame in-place."""

    @property
    @abstractmethod
    def is_idle(self) -> bool:
        """True when only the trigger button is showing (no active session)."""

    def process_hand(self, landmarks, w: int, h: int) -> None:
        """
        Optional. Called once per detected hand per frame with the full landmark
        list. Override when you need data beyond the index-finger tip — e.g.
        thumb position for pinch detection.
        """
