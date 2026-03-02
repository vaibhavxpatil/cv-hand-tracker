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

// Original BGR tuples from Python, converted to CSS rgb():
// BGR(b,g,r) → CSS rgb(r,g,b)
const BALL_COLORS = [
  'rgb(255,80,0)',    // (0,80,255)   BGR → red-orange
  'rgb(255,165,0)',   // (0,165,255)  BGR → orange
  'rgb(255,230,0)',   // (0,230,255)  BGR → yellow
  'rgb(120,255,30)',  // (30,255,120) BGR → green
  'rgb(20,200,255)',  // (255,200,20) BGR → cyan
  'rgb(60,60,255)',   // (255,60,60)  BGR → blue
  'rgb(200,0,200)',   // (200,0,200)  BGR → purple
  'rgb(160,0,255)',   // (255,0,160)  BGR → violet
  'rgb(0,255,160)',   // (160,255,0)  BGR → lime
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

  processFingertip(fx, fy, w, h) {
    this._checkButtons(fx, fy, w, h);
    if (this._state === 'active') this._tryPop(fx, fy);
  }

  processHand(_landmarks, _w, _h) { /* not used by this app */ }

  updateAndDraw(ctx, w, h) {
    const t  = now();
    const dt = this._lastTick ? t - this._lastTick : 0;
    this._lastTick = t;

    if (this._state === 'active') {
      this._update(t, dt, w, h);
      this._drawActive(ctx, w, h, t);
    } else if (this._state === 'end') {
      this._drawEnd(ctx, w, h);
    }

    if (this._state === 'idle') {
      this._drawButton(ctx, w, h);
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
        return; // one pop per frame
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

    if (this._state === 'idle') {
      if (this._inRect(fx, fy, ...this._btnPopit(w, h)) && ok('start')) this._start();
    } else if (this._state === 'end') {
      if (this._inRect(fx, fy, ...this._btnRestart(w, h)) && ok('restart')) this._start();
      else if (this._inRect(fx, fy, ...this._btnExit(w, h)) && ok('exit')) this._exit();
    }
  }

  _inRect(fx, fy, x1, y1, x2, y2) {
    return fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2;
  }

  // ── Button rects [x1, y1, x2, y2] ──────────────────────────────────────────
  // Positions match the Python version exactly.

  _btnPopit(w, _h)   { return [w - 160, 12, w - 12, 66]; }

  _btnRestart(w, h) {
    const cx = w / 2, cy = h / 2 + 60;
    return [cx - 150, cy - 28, cx - 10, cy + 28];
  }

  _btnExit(w, h) {
    const cx = w / 2, cy = h / 2 + 60;
    return [cx + 10, cy - 28, cx + 150, cy + 28];
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  _drawButton(ctx, w, h) {
    const [x1, y1, x2, y2] = this._btnPopit(w, h);
    ctx.save();
    ctx.fillStyle   = 'rgb(255,160,30)';   // BGR(30,160,255) → RGB
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.font        = 'bold 22px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.fillText('Pop It!', x1 + 10, y1 + 38);
    ctx.restore();
  }

  _drawActive(ctx, w, h, t) {
    // Balls
    for (const b of this._balls) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle   = b.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Pop burst rings
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

    // Timer — top-center
    const remaining  = Math.max(0, GAME_DURATION - (t - this._gameStart));
    const timerText  = `${Math.ceil(remaining)}s`;
    const timerColor = remaining > 10 ? '#ffff00' : '#ff5a00';
    ctx.save();
    ctx.font      = 'bold 54px system-ui, sans-serif';
    ctx.fillStyle = timerColor;
    ctx.textAlign = 'center';
    ctx.fillText(timerText, w / 2, 58);
    ctx.restore();

    // Score box — top-left
    ctx.save();
    ctx.fillStyle   = '#000';
    ctx.fillRect(10, 10, 210, 52);
    ctx.strokeStyle = 'rgb(50,220,100)';  // BGR(100,220,50) → RGB
    ctx.lineWidth   = 2;
    ctx.strokeRect(10, 10, 210, 52);
    ctx.font        = 'bold 32px system-ui, sans-serif';
    ctx.fillStyle   = 'rgb(50,255,120)';
    ctx.fillText(`Score: ${this.score}`, 20, 48);
    ctx.restore();
  }

  _drawEnd(ctx, w, h) {
    // Dark overlay
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const cx = w / 2, cy = h / 2;

    // Title
    ctx.save();
    ctx.font      = 'bold 72px system-ui, sans-serif';
    ctx.fillStyle = 'rgb(0,240,255)';    // BGR(255,240,0) → RGB
    ctx.textAlign = 'center';
    ctx.fillText('Game Over!', cx, cy - 80);
    ctx.restore();

    // Score
    ctx.save();
    ctx.font      = 'bold 52px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(`Score: ${this.score}`, cx, cy - 10);
    ctx.restore();

    // Restart button
    const [rx1, ry1, rx2, ry2] = this._btnRestart(w, h);
    ctx.save();
    ctx.fillStyle   = 'rgb(30,180,30)';   // same in BGR and RGB (symmetric)
    ctx.fillRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
    ctx.font        = 'bold 24px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Restart', (rx1 + rx2) / 2, (ry1 + ry2) / 2);
    ctx.restore();

    // Exit button
    const [ex1, ey1, ex2, ey2] = this._btnExit(w, h);
    ctx.save();
    ctx.fillStyle   = 'rgb(200,30,30)';   // BGR(30,30,200) → RGB
    ctx.fillRect(ex1, ey1, ex2 - ex1, ey2 - ey1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.strokeRect(ex1, ey1, ex2 - ex1, ey2 - ey1);
    ctx.font        = 'bold 24px system-ui, sans-serif';
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Exit', (ex1 + ex2) / 2, (ey1 + ey2) / 2);
    ctx.restore();

    // Prompt
    ctx.save();
    ctx.font        = '18px system-ui, sans-serif';
    ctx.fillStyle   = 'rgb(180,180,180)';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Touch a button with your index finger', cx, cy + 120);
    ctx.restore();
  }
}
