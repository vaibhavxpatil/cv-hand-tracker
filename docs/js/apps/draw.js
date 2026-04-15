/**
 * apps/draw.js — Finger-painting app.
 *
 * Tools:  Freehand draw, Rectangle, Circle, Line, Paint fill.
 * Pinch index + thumb to draw / drag shapes.
 * Exit button: top-LEFT (away from trigger buttons, which are top-right).
 *
 * Fluidity:
 *   - Pinch in normalised 3-D landmark space (scale-invariant, palm-independent).
 *   - EMA position smoothing removes per-frame jitter.
 *   - Quadratic bezier curves for smooth freehand strokes.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  { color: '#FF3B3B', name: 'Red'    },
  { color: '#FFD600', name: 'Yellow' },
  { color: '#00D45A', name: 'Green'  },
  { color: '#1E8FFF', name: 'Blue'   },
  { color: '#CC40FF', name: 'Purple' },
];

const STROKE_WIDTH  = 8;
const ERASER_WIDTH  = STROKE_WIDTH * 3;

// Pinch in normalised 3-D landmark space — scale-invariant.
// Typical: not pinching ≈ 0.12-0.25 · pinching ≈ 0.02-0.06
const PINCH_ON      = 0.07;
const PINCH_OFF     = 0.11;

const SMOOTH_ALPHA  = 0.4;   // EMA weight for current frame
const BTN_COOLDOWN  = 0.75;  // seconds
const SWATCH_RADIUS = 28;    // px

// Shape tool cycle order
const SHAPE_CYCLE = ['rect', 'circle', 'line'];

function now() { return performance.now() / 1000; }

// ── UI helpers ───────────────────────────────────────────────────────────────

function drawBtn(ctx, x1, y1, x2, y2, label, bg, options = {}) {
  const { r = 14, border = 'rgba(255,255,255,0.25)', fontSize = 18, bold = true, active = false } = options;
  const bw = x2 - x1, bh = y2 - y1;
  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.roundRect(x1, y1, bw, bh, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // Active highlight ring
  if (active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth   = 2.5;
  } else {
    ctx.strokeStyle = border;
    ctx.lineWidth   = 1.5;
  }
  ctx.stroke();
  ctx.font         = `${bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle    = '#fff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x1 + bw / 2, y1 + bh / 2);
  ctx.restore();
}

function drawPanel(ctx, x, y, w, h, r = 16) {
  ctx.save();
  ctx.shadowColor   = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur    = 12;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = 'rgba(12, 12, 22, 0.72)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.restore();
}

// ── DrawApp ───────────────────────────────────────────────────────────────────

export class DrawApp {
  constructor() {
    this._state      = 'idle';
    this._offscreen  = null;
    this._offCtx     = null;
    this._colorIdx   = 0;

    // Freehand bezier state
    this._prevPos    = null;   // last bezier anchor {x,y}
    this._ctrlPos    = null;   // last smoothed pos (control point)
    this._smoothPos  = null;   // EMA-smoothed index tip {x,y}

    // Tool state
    this._tool       = 'draw';  // 'draw' | 'rect' | 'circle' | 'line' | 'fill'
    this._isErasing  = false;
    this._shapeStart   = null;  // {x,y} — set when pinch starts in shape mode
    this._shapeCurrent = null;  // {x,y} — updated while holding

    this._isPinching = false;
    this._lastTip    = null;
    this._handDone   = false;
    this._btnTimes   = {};
  }

  // ── BaseApp interface ───────────────────────────────────────────────────────

  get isIdle() { return this._state === 'idle'; }

  /** Called by the sidebar dock to launch this app. */
  open() {
    if (this._state !== 'idle') return;
    this._state    = 'active';
    this._offscreen = null;
    this._tool     = 'draw';
    this._isErasing = false;
    this._resetStroke();
    this._handDone = false;
  }

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
        this._resetStroke();
        this._handDone  = false;
      }
      return;
    }

    // active — exit only when not pinching (avoid accidental close mid-stroke)
    if (!this._isPinching) {
      if (this._hit(fx, fy, ...this._btnExit(w, h)) && ok('exit')) {
        // Cooldown 'open' so trigger can't fire immediately when going idle
        this._btnTimes['open'] = t;
        this._state     = 'idle';
        this._offscreen = null;
        this._resetStroke();
        return;
      }
    }

    // Clear canvas
    if (this._hit(fx, fy, ...this._btnClear(w, h)) && ok('clear')) {
      if (this._offCtx) {
        this._offCtx.clearRect(0, 0, this._offscreen.width, this._offscreen.height);
      }
      this._resetStroke();
      return;
    }

    // Shape tool — cycles rect → circle → line → draw (back to freehand)
    if (this._hit(fx, fy, ...this._btnShape(w, h)) && ok('shape')) {
      const idx = SHAPE_CYCLE.indexOf(this._tool);
      if (idx === -1) {
        this._tool = 'rect'; // enter shape mode
      } else if (idx === SHAPE_CYCLE.length - 1) {
        this._tool = 'draw'; // exit shape mode back to freehand
      } else {
        this._tool = SHAPE_CYCLE[idx + 1];
      }
      this._isErasing  = false;
      this._shapeStart = null;
      this._shapeCurrent = null;
      this._resetStroke();
    }

    // Fill tool toggle
    if (this._hit(fx, fy, ...this._btnFill(w, h)) && ok('fill-tool')) {
      this._tool      = this._tool === 'fill' ? 'draw' : 'fill';
      this._isErasing = false;
      this._resetStroke();
    }

    // Eraser toggle (only in draw mode)
    if (this._hit(fx, fy, ...this._btnEraser(w, h)) && ok('eraser')) {
      if (this._tool !== 'draw') {
        this._tool = 'draw';
        this._isErasing = true;
      } else {
        this._isErasing = !this._isErasing;
      }
      this._resetStroke();
    }

    // Color swatch selection
    for (let i = 0; i < PALETTE.length; i++) {
      const [sx, sy] = this._swatchPos(i, w, h);
      if (Math.hypot(fx - sx, fy - sy) <= SWATCH_RADIUS && ok(`c${i}`)) {
        this._colorIdx  = i;
        this._isErasing = false;
      }
    }
  }

  /**
   * processHand — pinch in normalised 3-D landmark space.
   *
   * Why not pixel distance:
   *   • Scale-invariant: same threshold works at any hand distance.
   *   • Z component: flat open hand with close-in-2D fingers doesn't trigger.
   *   • Palm & other fingers don't affect landmarks 4 (thumb tip) and 8 (index tip).
   */
  processHand(landmarks, w, h) {
    if (this._state !== 'active') return;
    if (this._handDone) return;
    this._handDone = true;

    const thumb = landmarks[4];
    const index = landmarks[8];

    // ── Pinch detection — normalised 3-D ───────────────────────────────────
    const dist3d = Math.hypot(
      thumb.x - index.x,
      thumb.y - index.y,
      thumb.z - index.z,
    );
    const prevPinching = this._isPinching;
    this._isPinching = prevPinching ? dist3d < PINCH_OFF : dist3d < PINCH_ON;

    // ── EMA smoothing (screen space) ───────────────────────────────────────
    const rawX = (1 - index.x) * w;
    const rawY = index.y * h;
    if (!this._smoothPos) {
      this._smoothPos = { x: rawX, y: rawY };
    } else {
      this._smoothPos = {
        x: SMOOTH_ALPHA * rawX + (1 - SMOOTH_ALPHA) * this._smoothPos.x,
        y: SMOOTH_ALPHA * rawY + (1 - SMOOTH_ALPHA) * this._smoothPos.y,
      };
    }
    const ix = this._smoothPos.x;
    const iy = this._smoothPos.y;
    this._lastTip = { x: ix, y: iy };

    if (!this._offCtx) return;

    if (this._tool === 'draw') {
      this._processFreehand(ix, iy);
    } else if (this._tool === 'fill') {
      // Trigger fill on the leading edge of a pinch
      if (!prevPinching && this._isPinching) {
        this._floodFill(Math.round(ix), Math.round(iy));
      }
    } else {
      // Shape tools
      this._processShape(ix, iy, prevPinching);
    }
  }

  updateAndDraw(ctx, w, h, anyActive = false) {
    this._handDone = false;

    if (this._state === 'idle') {
      if (!anyActive) this._drawTriggerButton(ctx, w, h);
      return;
    }

    // ── Ensure offscreen canvas is the right size ─────────────────────────
    if (!this._offscreen || this._offscreen.width !== w || this._offscreen.height !== h) {
      const prev = this._offscreen;
      this._offscreen        = document.createElement('canvas');
      this._offscreen.width  = w;
      this._offscreen.height = h;
      this._offCtx = this._offscreen.getContext('2d');
      if (prev) this._offCtx.drawImage(prev, 0, 0, w, h);
    }

    // ── Blend strokes onto video ──────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.drawImage(this._offscreen, 0, 0);
    ctx.restore();

    // ── Live shape preview (dashed) ───────────────────────────────────────
    if (this._shapeStart && this._shapeCurrent) {
      ctx.save();
      ctx.globalAlpha  = 0.75;
      ctx.strokeStyle  = PALETTE[this._colorIdx].color;
      ctx.lineWidth    = STROKE_WIDTH;
      ctx.lineCap      = 'round';
      ctx.setLineDash([10, 6]);
      this._applyShapePath(ctx, this._shapeStart, this._shapeCurrent);
      ctx.stroke();
      ctx.restore();
    }

    // ── Color palette panel — bottom-center ───────────────────────────────
    const spacing = 72;
    const panelW  = (PALETTE.length - 1) * spacing + SWATCH_RADIUS * 4 + 16;
    const panelH  = SWATCH_RADIUS * 2 + 36;
    const panelX  = w / 2 - panelW / 2;
    const panelY  = h - panelH - 10;
    drawPanel(ctx, panelX, panelY, panelW, panelH, 18);

    for (let i = 0; i < PALETTE.length; i++) {
      const [sx, sy] = this._swatchPos(i, w, h);
      ctx.save();
      if (i === this._colorIdx && !this._isErasing) {
        ctx.beginPath();
        ctx.arc(sx, sy, SWATCH_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, SWATCH_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle   = PALETTE[i].color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // ── Eraser cursor ─────────────────────────────────────────────────────
    if (this._isErasing && this._lastTip) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this._lastTip.x, this._lastTip.y, ERASER_WIDTH / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(220,220,220,0.8)';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();
    }

    // ── Buttons ───────────────────────────────────────────────────────────
    this._drawExitButton(ctx, w, h);
    this._drawClearButton(ctx, w, h);
    this._drawShapeButton(ctx, w, h);
    this._drawFillButton(ctx, w, h);
    this._drawEraserButton(ctx, w, h);

    // ── Status hint ───────────────────────────────────────────────────────
    let hint, hintColor;
    if (this._tool === 'fill') {
      hint = 'Pinch to fill area';  hintColor = '#FFD600';
    } else if (this._tool !== 'draw') {
      const name = this._tool.charAt(0).toUpperCase() + this._tool.slice(1);
      hint = this._shapeStart ? `Drawing ${name}…` : `Pinch & drag to draw ${name}`;
      hintColor = PALETTE[this._colorIdx].color;
    } else if (this._isErasing && this._isPinching) {
      hint = 'Erasing…';       hintColor = 'rgba(200,200,200,0.9)';
    } else if (this._isErasing) {
      hint = 'Pinch to erase'; hintColor = 'rgba(180,180,180,0.9)';
    } else if (this._isPinching) {
      hint = 'Drawing…';       hintColor = PALETTE[this._colorIdx].color;
    } else {
      hint = 'Pinch to draw';  hintColor = 'rgba(255,255,255,0.85)';
    }
    ctx.save();
    ctx.font         = '600 18px system-ui, sans-serif';
    ctx.fillStyle    = hintColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 6;
    ctx.fillText(hint, w / 2, panelY - 12);
    ctx.restore();
  }

  // ── Tool logic ────────────────────────────────────────────────────────────

  _processFreehand(ix, iy) {
    if (this._isPinching) {
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
      if (this._ctrlPos && this._prevPos) {
        const mx = (this._ctrlPos.x + ix) / 2;
        const my = (this._ctrlPos.y + iy) / 2;
        ctx.beginPath();
        ctx.moveTo(this._prevPos.x, this._prevPos.y);
        ctx.quadraticCurveTo(this._ctrlPos.x, this._ctrlPos.y, mx, my);
        ctx.stroke();
        this._prevPos = { x: mx, y: my };
      } else {
        ctx.beginPath();
        const r = this._isErasing ? ERASER_WIDTH / 2 : STROKE_WIDTH / 2;
        ctx.arc(ix, iy, r, 0, Math.PI * 2);
        ctx.fill();
        this._prevPos = { x: ix, y: iy };
      }
      ctx.restore();
      this._ctrlPos = { x: ix, y: iy };
    } else {
      this._prevPos   = null;
      this._ctrlPos   = null;
      this._smoothPos = null; // fresh EMA on next stroke
    }
  }

  _processShape(ix, iy, prevPinching) {
    if (this._isPinching) {
      if (!this._shapeStart) this._shapeStart = { x: ix, y: iy };
      this._shapeCurrent = { x: ix, y: iy };
    } else if (prevPinching && !this._isPinching) {
      // Pinch released — commit shape
      if (this._shapeStart && this._shapeCurrent) {
        const ctx = this._offCtx;
        ctx.save();
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = STROKE_WIDTH;
        if (this._isErasing) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.strokeStyle = PALETTE[this._colorIdx].color;
        }
        this._applyShapePath(ctx, this._shapeStart, this._shapeCurrent);
        ctx.stroke();
        ctx.restore();
      }
      this._shapeStart   = null;
      this._shapeCurrent = null;
    }
  }

  /** Builds the path for the current shape tool on any context. */
  _applyShapePath(ctx, start, end) {
    ctx.beginPath();
    if (this._tool === 'rect') {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const rw = Math.abs(end.x - start.x);
      const rh = Math.abs(end.y - start.y);
      ctx.roundRect(x, y, rw, rh, 4);
    } else if (this._tool === 'circle') {
      const r = Math.hypot(end.x - start.x, end.y - start.y);
      ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
    } else if (this._tool === 'line') {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }
  }

  /**
   * Flood fill at (startX, startY) using current palette color.
   * Operates only on the offscreen (strokes) canvas.
   * Stops at pixels that differ from the target color (tolerance 30).
   * Aborts if the fill would cover >40% of the canvas (prevents full-canvas flooding).
   */
  _floodFill(startX, startY) {
    if (!this._offCtx || !this._offscreen) return;
    const cw = this._offscreen.width;
    const ch = this._offscreen.height;
    startX = Math.max(0, Math.min(cw - 1, startX));
    startY = Math.max(0, Math.min(ch - 1, startY));

    const imageData = this._offCtx.getImageData(0, 0, cw, ch);
    const data      = imageData.data;
    const fill      = this._hexToRgb(PALETTE[this._colorIdx].color);

    const idx0 = (startY * cw + startX) * 4;
    const tR = data[idx0], tG = data[idx0+1], tB = data[idx0+2], tA = data[idx0+3];

    // Nothing to do if already fill color
    if (tA === 255 && tR === fill.r && tG === fill.g && tB === fill.b) return;

    const TOL = 30;
    const matches = (i) => (
      Math.abs(data[i]   - tR) <= TOL &&
      Math.abs(data[i+1] - tG) <= TOL &&
      Math.abs(data[i+2] - tB) <= TOL &&
      Math.abs(data[i+3] - tA) <= TOL
    );

    const visited = new Uint8Array(cw * ch);
    const stack   = [startY * cw + startX];
    visited[startY * cw + startX] = 1;

    let count = 0;
    const limit = cw * ch * 0.4; // abort if filling >40% of canvas

    while (stack.length && count < limit) {
      const pos = stack.pop();
      const px = pos % cw, py = (pos / cw) | 0;
      const i4 = pos * 4;
      data[i4] = fill.r; data[i4+1] = fill.g; data[i4+2] = fill.b; data[i4+3] = 255;
      count++;

      for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
        if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
        const np = ny * cw + nx;
        if (!visited[np] && matches(np * 4)) { visited[np] = 1; stack.push(np); }
      }
    }

    this._offCtx.putImageData(imageData, 0, 0);
  }

  _hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  _resetStroke() {
    this._prevPos    = null;
    this._ctrlPos    = null;
    this._smoothPos  = null;
    this._shapeStart = null;
    this._shapeCurrent = null;
  }

  // ── Layout helpers ────────────────────────────────────────────────────────

  _swatchPos(i, w, h) {
    const spacing = 72;
    const totalW  = (PALETTE.length - 1) * spacing;
    const startX  = w / 2 - totalW / 2;
    return [startX + i * spacing, h - 46];
  }

  // Button rects [x1, y1, x2, y2]
  _btnDraw(w, _h)    { return [w - 160, 76, w - 12, 130]; }
  _btnExit(_w, _h)   { return [12, 12, 120, 56]; }           // top-LEFT — away from triggers
  _btnClear(_w, h)   { return [10, h - 85, 110, h - 45]; }   // bottom-left
  _btnShape(_w, h)   { return [120, h - 85, 240, h - 45]; }  // bottom, beside clear
  _btnFill(w, h)     { return [w - 240, h - 85, w - 130, h - 45]; } // bottom, beside eraser
  _btnEraser(w, h)   { return [w - 120, h - 85, w - 10, h - 45]; }  // bottom-right

  _hit(fx, fy, x1, y1, x2, y2) {
    return fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2;
  }

  // ── Button drawing ────────────────────────────────────────────────────────

  _drawTriggerButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnDraw(w, h);
    drawBtn(ctx, x1, y1, x2, y2, 'Draw', 'rgba(160, 40, 220, 0.88)');
  }

  _drawExitButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnExit(w, h);
    drawBtn(ctx, x1, y1, x2, y2, '← Exit', 'rgba(210, 40, 40, 0.88)', { fontSize: 17 });
  }

  _drawClearButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnClear(w, h);
    drawBtn(ctx, x1, y1, x2, y2, 'Clear', 'rgba(30, 60, 160, 0.88)', { fontSize: 15 });
  }

  _drawShapeButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnShape(w, h);
    const inShapeMode = SHAPE_CYCLE.includes(this._tool);
    const labels = { rect: '▭ Rect', circle: '○ Circle', line: '/ Line' };
    const label  = inShapeMode ? labels[this._tool] : '▭ Shape';
    const bg     = inShapeMode ? 'rgba(200, 120, 20, 0.92)' : 'rgba(60, 60, 80, 0.82)';
    drawBtn(ctx, x1, y1, x2, y2, label, bg, { fontSize: 14, active: inShapeMode });
  }

  _drawFillButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnFill(w, h);
    const active = this._tool === 'fill';
    drawBtn(ctx, x1, y1, x2, y2, '⬟ Fill', active ? 'rgba(0, 160, 200, 0.92)' : 'rgba(40, 40, 55, 0.82)',
      { fontSize: 15, active });
  }

  _drawEraserButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnEraser(w, h);
    const active = this._isErasing;
    drawBtn(
      ctx, x1, y1, x2, y2,
      active ? 'Eraser ✕' : 'Eraser',
      active ? 'rgba(90, 90, 100, 0.92)' : 'rgba(40, 40, 55, 0.82)',
      { border: active ? 'rgba(255,255,100,0.6)' : 'rgba(255,255,255,0.2)', fontSize: 15, active },
    );
  }
}
