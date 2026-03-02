/**
 * apps/draw.js — Finger-painting app.
 *
 * Direct port of apps/draw/draw.py.
 * Pinch index + thumb to draw on a persistent offscreen canvas.
 * Point at a color swatch to change color.
 * Eraser mode: point at the Eraser button, then pinch to erase.
 * Exit button in the top-left corner.
 *
 * Key differences from Python:
 *   - Offscreen HTMLCanvasElement replaces np.zeros() canvas array.
 *   - ctx.globalCompositeOperation = 'destination-out' replaces black-pixel erase.
 *   - compositing with globalAlpha = 0.65 replaces cv2.addWeighted().
 *   - BGR palette → CSS rgb() (channels reversed).
 */

// ── Constants ────────────────────────────────────────────────────────────────

// BGR(b,g,r) → CSS rgb(r,g,b)
const PALETTE = [
  { color: 'rgb(255,0,0)',   name: 'Red'    },  // BGR(0,0,255)
  { color: 'rgb(255,220,0)', name: 'Yellow' },  // BGR(0,220,255)
  { color: 'rgb(0,200,50)',  name: 'Green'  },  // BGR(50,200,0)
  { color: 'rgb(0,80,255)',  name: 'Blue'   },  // BGR(255,80,0)
  { color: 'rgb(220,0,220)', name: 'Purple' },  // BGR(220,0,220)
];

const STROKE_WIDTH    = 8;
const ERASER_WIDTH    = STROKE_WIDTH * 3;   // 24 px
const PINCH_THRESHOLD = 20;                 // px
const BTN_COOLDOWN    = 0.75;               // seconds
const SWATCH_RADIUS   = 32;                 // px

function now() { return performance.now() / 1000; }

// ── DrawApp ───────────────────────────────────────────────────────────────────

export class DrawApp {
  constructor() {
    this._state      = 'idle';
    this._offscreen  = null;   // HTMLCanvasElement for persistent strokes
    this._offCtx     = null;
    this._colorIdx   = 0;
    this._prevPos    = null;   // {x,y} of last drawn point
    this._isPinching = false;
    this._isErasing  = false;
    this._lastTip    = null;   // {x,y} index tip, for eraser cursor
    this._handDone   = false;  // guard: only first hand drives drawing per frame
    this._btnTimes   = {};
  }

  // ── BaseApp interface ───────────────────────────────────────────────────────

  get isIdle() { return this._state === 'idle'; }

  processFingertip(fx, fy, w, h) {
    const t  = now();
    const ok = (name) => {
      if (t - (this._btnTimes[name] || 0) >= BTN_COOLDOWN) {
        this._btnTimes[name] = t;
        return true;
      }
      return false;
    };

    if (this._state === 'idle') {
      if (this._hit(fx, fy, ...this._btnDraw(w, h)) && ok('open')) {
        this._state     = 'active';
        this._offscreen = null;
        this._prevPos   = null;
        this._handDone  = false;
      }
    } else if (this._state === 'active') {
      // Exit — only register when not pinching so strokes near the corner
      // don't accidentally close the app (matches Python behaviour)
      if (!this._isPinching) {
        if (this._hit(fx, fy, ...this._btnExit(w, h)) && ok('exit')) {
          this._state     = 'idle';
          this._offscreen = null;
          this._prevPos   = null;
          return;
        }
      }

      // Eraser toggle
      if (this._hit(fx, fy, ...this._btnEraser(w, h)) && ok('eraser')) {
        this._isErasing = !this._isErasing;
        this._prevPos   = null;
      }

      // Color swatch selection (also exits eraser mode)
      for (let i = 0; i < PALETTE.length; i++) {
        const [sx, sy] = this._swatchPos(i, w, h);
        if (Math.hypot(fx - sx, fy - sy) <= SWATCH_RADIUS && ok(`c${i}`)) {
          this._colorIdx  = i;
          this._isErasing = false;
        }
      }
    }
  }

  /**
   * processHand — called with full landmark list each frame.
   * Uses thumb (4) + index (8) distance to detect pinch, then draws.
   * Matches process_hand() in draw.py.
   */
  processHand(landmarks, w, h) {
    if (this._state !== 'active') return;
    if (this._handDone) return;    // only first hand per frame
    this._handDone = true;

    // lmToScreen mirror: x = (1 - lm.x) * w  (matches tracker.lmToScreen)
    const thumb = landmarks[4];
    const index = landmarks[8];
    const tx = (1 - thumb.x) * w,  ty = thumb.y * h;
    const ix = (1 - index.x) * w,  iy = index.y * h;

    const pinching    = Math.hypot(tx - ix, ty - iy) < PINCH_THRESHOLD;
    this._isPinching  = pinching;
    this._lastTip     = { x: ix, y: iy };

    // Ensure offscreen canvas exists (may be initialised later in updateAndDraw,
    // but processHand is called first in main loop — guard here)
    if (!this._offCtx) return;

    if (pinching) {
      const ctx = this._offCtx;
      ctx.save();
      ctx.lineCap  = 'round';
      ctx.lineJoin = 'round';

      if (this._isErasing) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.fillStyle   = 'rgba(0,0,0,1)';
        ctx.lineWidth   = ERASER_WIDTH;
      } else {
        ctx.strokeStyle = PALETTE[this._colorIdx].color;
        ctx.fillStyle   = PALETTE[this._colorIdx].color;
        ctx.lineWidth   = STROKE_WIDTH;
      }

      if (this._prevPos) {
        ctx.beginPath();
        ctx.moveTo(this._prevPos.x, this._prevPos.y);
        ctx.lineTo(ix, iy);
        ctx.stroke();
      } else {
        // First point of a new stroke — draw a dot so tap-marks appear
        ctx.beginPath();
        const r = this._isErasing ? ERASER_WIDTH / 2 : STROKE_WIDTH / 2;
        ctx.arc(ix, iy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    this._prevPos = pinching ? { x: ix, y: iy } : null;
  }

  updateAndDraw(ctx, w, h) {
    this._handDone = false;   // reset for next frame

    if (this._state === 'idle') {
      this._drawTriggerButton(ctx, w, h);
      return;
    }

    // ── Ensure offscreen canvas is the right size ─────────────────────────
    if (!this._offscreen || this._offscreen.width !== w || this._offscreen.height !== h) {
      const prev = this._offscreen;
      this._offscreen      = document.createElement('canvas');
      this._offscreen.width  = w;
      this._offscreen.height = h;
      this._offCtx = this._offscreen.getContext('2d');
      // Copy existing strokes if canvas was resized
      if (prev) this._offCtx.drawImage(prev, 0, 0, w, h);
    }

    // ── Blend strokes onto video feed (65% strokes, 35% video) ───────────
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.drawImage(this._offscreen, 0, 0);
    ctx.restore();

    // ── Color palette — bottom-center ─────────────────────────────────────
    for (let i = 0; i < PALETTE.length; i++) {
      const [sx, sy] = this._swatchPos(i, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, SWATCH_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE[i].color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();

      if (i === this._colorIdx) {
        // Highlight ring
        ctx.beginPath();
        ctx.arc(sx, sy, SWATCH_RADIUS + 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 3;
        ctx.stroke();
        // Label below swatch
        ctx.font      = '16px system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(PALETTE[i].name, sx, sy + SWATCH_RADIUS + 20);
      }
      ctx.restore();
    }

    // ── Eraser cursor ─────────────────────────────────────────────────────
    if (this._isErasing && this._lastTip) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this._lastTip.x, this._lastTip.y, ERASER_WIDTH / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgb(200,200,200)';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();
    }

    // ── Eraser toggle button — bottom-right ───────────────────────────────
    this._drawEraserButton(ctx, w, h);

    // ── Pinch status hint — bottom-center ─────────────────────────────────
    let hint, hintColor;
    if (this._isErasing && this._isPinching) {
      hint = 'Erasing…';      hintColor = 'rgb(200,200,200)';
    } else if (this._isErasing) {
      hint = 'Pinch to erase'; hintColor = 'rgb(200,200,200)';
    } else if (this._isPinching) {
      hint = 'Drawing…';       hintColor = PALETTE[this._colorIdx].color;
    } else {
      hint = 'Pinch to draw';  hintColor = '#fff';
    }
    ctx.save();
    ctx.font      = '22px system-ui, sans-serif';
    ctx.fillStyle = hintColor;
    ctx.textAlign = 'center';
    ctx.fillText(hint, w / 2, h - 85);
    ctx.restore();

    // ── Exit button — top-left ────────────────────────────────────────────
    this._drawExitButton(ctx, w, h);
  }

  // ── Layout helpers ────────────────────────────────────────────────────────

  _swatchPos(i, w, h) {
    const spacing = 80;
    const totalW  = (PALETTE.length - 1) * spacing;
    const startX  = w / 2 - totalW / 2;
    return [startX + i * spacing, h - 60];
  }

  // Button rects [x1, y1, x2, y2] — match Python positions exactly
  _btnDraw(w, _h)   { return [w - 160, 76, w - 12, 130]; }
  _btnExit(_w, _h)  { return [12, 12, 120, 56]; }
  _btnEraser(w, h)  { return [w - 120, h - 85, w - 10, h - 45]; }

  _hit(fx, fy, x1, y1, x2, y2) {
    return fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2;
  }

  // ── Button drawing ────────────────────────────────────────────────────────

  _drawTriggerButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnDraw(w, h);
    ctx.save();
    ctx.fillStyle   = 'rgb(220,60,180)';   // BGR(180,60,220) → RGB
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.font        = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.fillText('Draw', x1 + 32, y1 + 38);
    ctx.restore();
  }

  _drawEraserButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnEraser(w, h);
    ctx.save();
    ctx.fillStyle   = this._isErasing ? 'rgb(80,80,80)' : 'rgb(50,50,50)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = this._isErasing ? 'rgb(255,255,0)' : 'rgb(180,180,180)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.font        = '16px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = 'center';
    ctx.fillText(this._isErasing ? 'ERASER' : 'Eraser', (x1 + x2) / 2, y1 + 26);
    ctx.restore();
  }

  _drawExitButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnExit(w, h);
    ctx.save();
    ctx.fillStyle   = 'rgb(180,40,40)';    // BGR(40,40,180) → RGB
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.font        = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Exit', (x1 + x2) / 2, (y1 + y2) / 2);
    ctx.restore();
  }
}
