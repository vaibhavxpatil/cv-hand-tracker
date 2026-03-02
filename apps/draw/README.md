# Draw

A finger-painting app. Pinch your index finger and thumb together to draw on a
persistent canvas overlaid on the video feed. Point your index finger at a color
swatch to change the brush color.

---

## How to play

| Step | Action |
|---|---|
| 1 | Point your index finger at the **"Draw"** button (top-right, below Pop It) |
| 2 | Point at a color swatch at the bottom of the screen to select a color |
| 3 | Pinch your **index finger + thumb** together to start drawing |
| 4 | Release the pinch to lift the brush |
| 5 | Touch the **Exit** button (top-left) to return to the hand tracker |

## Controls

| Gesture | Action |
|---|---|
| Index finger tap | Select color / press buttons |
| Index + thumb pinch | Draw |
| Release pinch | Lift brush |

- Either hand supported
- Only one hand drives the brush per frame (first detected hand)

## Color palette

| Swatch | Color |
|---|---|
| 1 | Red |
| 2 | Yellow |
| 3 | Green |
| 4 | Blue |
| 5 | Purple |

---

## Configuration (`draw.py`)

| Constant | Default | Description |
|---|---|---|
| `_STROKE_WIDTH` | `8` px | Brush thickness |
| `_PINCH_THRESHOLD` | `50` px | Max distance between thumb & index tips to count as a pinch |
| `_BTN_COOLDOWN` | `0.75` s | Debounce between button / color triggers |
| `_SWATCH_RADIUS` | `32` px | Hit radius of each color swatch |

---

## Updates

### v1.0 — Initial release
- Persistent canvas blended onto the live video feed (35% video / 65% drawing)
- 5-color palette selectable by index finger tap (Red, Yellow, Green, Blue, Purple)
- Pinch-to-draw with anti-aliased `cv2.LINE_AA` strokes
- Single-dot tap marks when pinching from a standstill
- Exit button top-left; draw trigger button top-right (below Pop It)
- Pinch guard on exit button — won't close while actively drawing
- First-hand-only drawing to prevent stroke teleportation with two hands in frame
