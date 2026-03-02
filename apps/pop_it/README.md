# Pop It

A 30-second reflex mini-game. Use your index finger to pop as many falling
colored balls as you can before the timer runs out.

---

## How to play

| Step | Action |
|---|---|
| 1 | Point your index finger at the **"Pop It!"** button (top-right corner) to start |
| 2 | Touch falling balls with your index finger tip to pop them |
| 3 | When the timer hits 0 the game ends and your score is shown |
| 4 | Touch **Restart** to play again or **Exit** to return to the hand tracker |

## Controls

- **Index finger tip** — all interaction (button presses + ball popping)
- **Either hand** supported

## Scoring

- **+1 point** per ball popped
- Balls that reach the bottom of the screen are removed with no penalty
- No time bonuses or multipliers

---

## Configuration (`pop_it.py`)

| Constant | Default | Description |
|---|---|---|
| `_GAME_DURATION` | `30` s | Session length |
| `_SPEED_MIN / _SPEED_MAX` | `120 / 340` px/s | Ball fall speed range |
| `_RADIUS_MIN / _RADIUS_MAX` | `28 / 58` px | Ball size range |
| `_SPAWN_MIN / _SPAWN_MAX` | `0.5 / 1.5` s | Time between ball spawns |
| `_POP_DURATION` | `0.35` s | How long the burst effect lasts |
| `_BTN_COOLDOWN` | `0.75` s | Debounce time between button triggers |

---

## Updates

### v1.0 — Initial release
- 30-second falling-ball game with live score and countdown timer
- 9-color ball palette, randomised size and speed per ball
- 3-ring expanding burst effect on successful pop
- Restart / Exit buttons on the end screen
- Button debounce to prevent accidental double-triggers
- Trigger button always visible in the top-right corner while idle
