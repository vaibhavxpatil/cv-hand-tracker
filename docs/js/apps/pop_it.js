/**
 * apps/pop_it.js — "Pop It" mini-game.
 *
 * Direct port of apps/pop_it/pop_it.py.
 * cv2 drawing → Canvas 2D API.
 * time.time()  → performance.now() / 1000  (seconds).
 * BGR colors   → RGB  (channels reversed).
 */

// ── Constants ────────────────────────────────────────────────────────────────

const GAME_DURATION = 30;     // seconds

const BALL_COLORS = [
  '#FF5020', '#FFA800', '#FFE500',
  '#78FF1E', '#14C8FF', '#3C3CFF',
  '#C800C8', '#A000FF', '#00FFA0',
];

const SPEED_MIN    = 120;   // px/s
const SPEED_MAX    = 340;
const RADIUS_MIN   = 28;
const RADIUS_MAX   = 58;
const SPAWN_MIN    = 0.5;   // seconds between spawns
const SPAWN_MAX    = 1.5;
const POP_DURATION = 0.35;  // seconds a burst lasts
const BTN_COOLDOWN = 0.75;  // seconds between button triggers

// ── Helpers ──────────────────────────────────────────────────────────────────

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function now() { return performance.now() / 1000; }

// ── UI helpers ───────────────────────────────────────────────────────────────

/** Filled rounded-rect button with centered label. */
function drawBtn(ctx, x1, y1, x2, y2, label, bg, options = {}) {
  const { r = 14, border = 'rgba(255,255,255,0.25)', fontSize = 20, bold = true } = options;
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
  ctx.strokeStyle = border;
  ctx.lineWidth   = 1.5;
  ctx.stroke();
  ctx.font          = `${bold ? 'bold ' : ''}${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle     = '#fff';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  ctx.fillText(label, x1 + bw / 2, y1 + bh / 2);
  ctx.restore();
}

/** Dark glass panel. */
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

// ── PopItGame ─────────────────────────────────────────────────────────────────

export class PopItGame {
  constructor() {
    this._state     = 'idle';   // 'idle' | 'active' | 'end'
    this.score      = 0;
    this._balls     = [];
    this._effects   = [];
    this._gameStart = 0;
    this._nextSpawn = 0;
    this._lastTick  = 0;
    this._btnTimes  = {};
  }

  // ── BaseApp interface ───────────────────────────────────────────────────────

  get isIdle() { return this._state === 'idle'; }

  /** Called by the sidebar dock to launch this app. */
  open() {
    if (this._state !== 'idle') return;
    this._start();
  }

  processFingertip(fx, fy, w, h) {
    this._checkButtons(fx, fy, w, h);
    if (this._state === 'active') this._tryPop(fx, fy);
  }

  processHand(_landmarks, _w, _h) { /* not used by this app */ }

  updateAndDraw(ctx, w, h, anyActive = false) {
    const t  = now();
    const dt = this._lastTick ? t - this._lastTick : 0;
    this._lastTick = t;

    if (this._state === 'active') {
      this._update(t, dt, w, h);
      this._drawActive(ctx, w, h, t);
    } else if (this._state === 'end') {
      this._drawEnd(ctx, w, h);
    }

    // Hide the trigger button while another app is running
    if (this._state === 'idle' && !anyActive) {
      this._drawIdleButton(ctx, w, h);
    }
  }

  // ── Game flow ───────────────────────────────────────────────────────────────

  _start() {
    const t        = now();
    this._state    = 'active';
    this.score     = 0;
    this._balls    = [];
    this._effects  = [];
    this._gameStart = t;
    this._nextSpawn = t + rand(SPAWN_MIN, SPAWN_MAX);
    this._lastTick  = t;
  }

  _end()  { this._state = 'end';  this._balls = []; }

  _exit() {
    this._state   = 'idle';
    this._balls   = [];
    this._effects = [];
    // Prevent the idle trigger from firing immediately while the finger is
    // still hovering over the exit button area.
    this._btnTimes['start'] = now();
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  _update(t, dt, w, h) {
    if (t - this._gameStart >= GAME_DURATION) { this._end(); return; }

    if (t >= this._nextSpawn) {
      const r = randInt(RADIUS_MIN, RADIUS_MAX);
      this._balls.push({
        x: rand(r, w - r),
        y: -r,
        radius: r,
        speed: rand(SPEED_MIN, SPEED_MAX),
        color: pick(BALL_COLORS),
      });
      this._nextSpawn = t + rand(SPAWN_MIN, SPAWN_MAX);
    }

    this._balls = this._balls.filter(b => {
      b.y += b.speed * dt;
      return b.y - b.radius < h;
    });

    this._effects = this._effects.filter(e => t - e.born < POP_DURATION);
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  _tryPop(fx, fy) {
    for (let i = 0; i < this._balls.length; i++) {
      const b = this._balls[i];
      if (Math.hypot(fx - b.x, fy - b.y) <= b.radius) {
        this._effects.push({ x: b.x, y: b.y, radius: b.radius, color: b.color, born: now() });
        this._balls.splice(i, 1);
        this.score++;
        return;
      }
    }
  }

  _checkButtons(fx, fy, w, h) {
    const t  = now();
    const ok = (name) => {
      if (t - (this._btnTimes[name] || 0) >= BTN_COOLDOWN) {
        this._btnTimes[name] = t;
        return true;
      }
      return false;
    };

    if (this._state === 'active') {
      if (this._inRect(fx, fy, ...this._btnActiveExit(w, h)) && ok('exit')) this._exit();
    } else if (this._state === 'end') {
      if (this._inRect(fx, fy, ...this._btnRestart(w, h)) && ok('restart')) this._start();
      else if (this._inRect(fx, fy, ...this._btnExit(w, h)) && ok('exit')) this._exit();
    }
  }

  _inRect(fx, fy, x1, y1, x2, y2) {
    return fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2;
  }

  // ── Button rects [x1, y1, x2, y2] ──────────────────────────────────────────

  _btnPopit(w, _h)       { return [w - 160, 12, w - 12, 66]; }
  _btnActiveExit(_w, _h) { return [12, 12, 120, 56]; }  // top-LEFT — away from idle trigger

  _btnRestart(w, h) {
    const cx = w / 2, cy = h / 2 + 60;
    return [cx - 150, cy - 28, cx - 10, cy + 28];
  }

  _btnExit(w, h) {
    const cx = w / 2, cy = h / 2 + 60;
    return [cx + 10, cy - 28, cx + 150, cy + 28];
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  _drawIdleButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnPopit(w, h);
    drawBtn(ctx, x1, y1, x2, y2, 'Pop It!', 'rgba(230, 110, 20, 0.88)');
  }

  _drawActive(ctx, w, h, t) {
    // ── Balls ──────────────────────────────────────────────────────────────
    for (const b of this._balls) {
      ctx.save();
      // Radial gradient for depth
      const grad = ctx.createRadialGradient(
        b.x - b.radius * 0.3, b.y - b.radius * 0.35, b.radius * 0.1,
        b.x, b.y, b.radius,
      );
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.3, b.color);
      grad.addColorStop(1, b.color + '88');
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // ── Pop burst rings ────────────────────────────────────────────────────
    for (const e of this._effects) {
      const progress = (t - e.born) / POP_DURATION;
      for (let ring = 0; ring < 3; ring++) {
        const alpha = Math.max(0, 1 - progress - ring * 0.25);
        if (alpha <= 0) continue;
        const r = e.radius + ring * 14 + progress * 55;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = e.color;
        ctx.lineWidth   = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Score + Timer — combined panel, top-center ─────────────────────────
    const remaining = Math.max(0, GAME_DURATION - (t - this._gameStart));
    const urgent    = remaining <= 10;
    const timerText = `${Math.ceil(remaining)}s`;
    const panelW = 320, panelH = 58;
    const panelX = w / 2 - panelW / 2;
    drawPanel(ctx, panelX, 8, panelW, panelH, 14);

    // Score (left half)
    ctx.save();
    ctx.font         = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle    = '#30E88A';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Score: ${this.score}`, panelX + 16, 37);
    ctx.restore();

    // Divider
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 + 10, 18);
    ctx.lineTo(w / 2 + 10, 54);
    ctx.stroke();
    ctx.restore();

    // Timer (right half)
    ctx.save();
    ctx.font         = 'bold 38px system-ui, sans-serif';
    ctx.fillStyle    = urgent ? '#FF5020' : '#FFE040';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = urgent ? 'rgba(255,80,20,0.5)' : 'transparent';
    ctx.shadowBlur   = urgent ? 10 : 0;
    ctx.fillText(timerText, panelX + panelW - 16, 37);
    ctx.restore();

    // ── Exit — top-right ───────────────────────────────────────────────────
    const [ex1, ey1, ex2, ey2] = this._btnActiveExit(w, h);
    drawBtn(ctx, ex1, ey1, ex2, ey2, '← Exit', 'rgba(210, 40, 40, 0.88)', { fontSize: 17 });
  }

  _drawEnd(ctx, w, h) {
    // Dark overlay
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle   = 'rgba(8, 8, 18, 1)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2, cy = h / 2;

    // Card panel
    drawPanel(ctx, cx - 220, cy - 130, 440, 280, 22);

    // Title
    ctx.save();
    ctx.font          = 'bold 58px system-ui, sans-serif';
    ctx.fillStyle     = '#FFE040';
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'alphabetic';
    ctx.shadowColor   = 'rgba(255,220,0,0.4)';
    ctx.shadowBlur    = 16;
    ctx.fillText('Game Over!', cx, cy - 48);
    ctx.restore();

    // Score
    ctx.save();
    ctx.font          = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle     = '#fff';
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'alphabetic';
    ctx.fillText(`Score: ${this.score}`, cx, cy + 14);
    ctx.restore();

    // Restart button
    const [rx1, ry1, rx2, ry2] = this._btnRestart(w, h);
    drawBtn(ctx, rx1, ry1, rx2, ry2, 'Restart', 'rgba(30, 170, 60, 0.90)', { fontSize: 20 });

    // Exit button
    const [bx1, by1, bx2, by2] = this._btnExit(w, h);
    drawBtn(ctx, bx1, by1, bx2, by2, 'Exit', 'rgba(210, 40, 40, 0.90)', { fontSize: 20 });

    // Prompt
    ctx.save();
    ctx.font         = '15px system-ui, sans-serif';
    ctx.fillStyle    = 'rgba(160,160,180,0.9)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Point your index finger at a button', cx, cy + 120);
    ctx.restore();
  }
}
