/**
 * sidebar.js — Liquid glass app dock on the right edge.
 *
 * Behaviour
 * ─────────
 * • Expanded:  full glass pill, 60 % of screen height, app cards centred inside.
 * • Active game: panel fades to ~15 % opacity so it doesn't intrude on gameplay.
 * • Collapsed (user toggle): panel slides off-screen to the right; only a
 *   small glass tab remains visible for re-expanding.
 * • Tab toggle works at all times (even during a game).
 * • App card launch only works when no other app is running.
 *
 * Visual technique (liquid glass)
 * ────────────────────────────────
 * 1. Capture the canvas pixels behind the panel each frame (expanded by the
 *    blur radius so edges don't darken).
 * 2. Re-draw those pixels through a CSS blur filter inside a clip mask.
 * 3. Stack: base tint → vertical specular → left-edge specular → border.
 */

const APP_CONFIGS = [
  { name: 'Pop It', icon: '🎯', rgb: [230, 110,  20] },
  { name: 'Draw',   icon: '✏️', rgb: [160,  40, 220] },
];

// ── Layout ────────────────────────────────────────────────────────────────────
const PANEL_W    = 88;    // panel width (px)
const PANEL_FRAC = 0.60;  // panel height as fraction of screen
const EDGE_GAP   = 8;     // gap from right edge (px)
const PANEL_R    = 24;    // panel corner radius
const CARD_W     = 66;
const CARD_H     = 80;
const CARD_GAP   = 14;
const CARD_R     = 16;
const BLUR_R     = 22;    // backdrop blur (px)
const TAB_W      = 20;    // collapse tab width
const TAB_H      = 48;    // collapse tab height
const BTN_CD     = 0.75;  // button cooldown (s)

// Animation lerp rates (per frame at ~60 fps)
const SLIDE_RATE   = 0.14;  // panel slide in/out
const OPACITY_RATE = 0.08;  // opacity fade

function now()             { return performance.now() / 1000; }
function rgba(r, g, b, a)  { return `rgba(${r},${g},${b},${a})`; }
function lerp(a, b, t)     { return a + (b - a) * t; }

// ── Sidebar ───────────────────────────────────────────────────────────────────

export class Sidebar {
  constructor() {
    this._btnTimes    = {};
    this._tmpCanvas   = null;
    this._tmpCtx      = null;
    this._expanded    = true;
    this._slideOffset = 0;          // px — 0 = fully in, positive = slid right
    this._opacity     = 1.0;
  }

  /**
   * Call every frame.
   * allowLaunch — false while a game is active (tab toggle still works).
   */
  processFingertip(fx, fy, w, h, apps, allowLaunch = true) {
    const t = now();

    // ── Collapse / expand tab ─────────────────────────────────────────────
    const [tx1, ty1, tx2, ty2] = this._tabRect(w, h);
    if (fx >= tx1 && fx <= tx2 && fy >= ty1 && fy <= ty2) {
      const key = 'toggle';
      if (t - (this._btnTimes[key] || 0) >= BTN_CD) {
        this._btnTimes[key] = t;
        this._expanded = !this._expanded;
      }
    }

    // ── App card launch ───────────────────────────────────────────────────
    if (!allowLaunch) return;
    apps.forEach((app, i) => {
      if (!app.isIdle) return;
      const [x1, y1, x2, y2] = this._cardRect(i, w, h, apps.length);
      if (fx >= x1 && fx <= x2 && fy >= y1 && fy <= y2) {
        const key = `card${i}`;
        if (t - (this._btnTimes[key] || 0) >= BTN_CD) {
          this._btnTimes[key] = t;
          app.open();
        }
      }
    });
  }

  /** Call last in the render loop — sits on top of everything. */
  updateAndDraw(ctx, w, h, apps) {
    const anyActive = apps.some(a => !a.isIdle);

    // ── Animate opacity ───────────────────────────────────────────────────
    // Fade to ~15 % when a game is running so the panel doesn't intrude.
    const targetOpacity = anyActive ? 0.15 : 1.0;
    this._opacity = lerp(this._opacity, targetOpacity, OPACITY_RATE);

    // ── Animate slide ─────────────────────────────────────────────────────
    const panelH       = h * PANEL_FRAC;
    // Slide far enough that the panel exits, but the tab (TAB_W wide) remains
    // visible at the right edge — so the user can always tap to re-expand.
    const fullSlide    = PANEL_W + EDGE_GAP - TAB_W + 4; // tab stays ~TAB_W px on-screen
    const targetOffset = this._expanded ? 0 : fullSlide;
    this._slideOffset  = lerp(this._slideOffset, targetOffset, SLIDE_RATE);

    const panelX = w - PANEL_W - EDGE_GAP + this._slideOffset;
    const panelY = (h - panelH) / 2;

    // ── Glass panel ───────────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = this._opacity;
    this._drawGlass(ctx, panelX, panelY, PANEL_W, panelH, PANEL_R, w, h);

    // Cards — anchored to top of panel with a fixed top padding
    const n           = apps.length;
    const cardsStartY = panelY + 18;
    const cardX       = panelX + (PANEL_W - CARD_W) / 2;
    apps.forEach((app, i) => {
      const cfg      = APP_CONFIGS[i] ?? { name: `App ${i}`, icon: '?', rgb: [80, 80, 80] };
      const isActive = !app.isIdle;
      const isLocked = anyActive && !isActive;
      const cardY    = cardsStartY + i * (CARD_H + CARD_GAP);
      this._drawCard(ctx, cardX, cardY, cfg, isActive, isLocked);
    });
    ctx.restore();

    // ── Collapse / expand tab (always full opacity) ───────────────────────
    this._drawTab(ctx, w, h);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _drawGlass(ctx, x, y, w, h, r, canvasW, canvasH) {
    const b    = BLUR_R;
    const cx   = Math.max(0, x - b);
    const cy   = Math.max(0, y - b);
    const capW = Math.min(canvasW - cx, w + b * 2);
    const capH = Math.min(canvasH - cy, Math.ceil(h) + b * 2);

    let imageData = null;
    if (capW > 0 && capH > 0) {
      try { imageData = ctx.getImageData(cx, cy, capW, capH); } catch { /* tainted */ }
    }

    if (imageData) {
      if (!this._tmpCanvas ||
          this._tmpCanvas.width  !== capW ||
          this._tmpCanvas.height !== capH) {
        this._tmpCanvas        = document.createElement('canvas');
        this._tmpCanvas.width  = capW;
        this._tmpCanvas.height = capH;
        this._tmpCtx           = this._tmpCanvas.getContext('2d');
      }
      this._tmpCtx.putImageData(imageData, 0, 0);
    }

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.clip();

    if (imageData) {
      ctx.filter = `blur(${b}px)`;
      ctx.drawImage(this._tmpCanvas, cx, cy);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = 'rgba(4, 14, 50, 0.88)';
      ctx.fillRect(x, y, w, h);
    }

    // Base tint — deep navy blue
    ctx.fillStyle = 'rgba(6, 20, 80, 0.55)';
    ctx.fillRect(x, y, w, h);

    // Vertical specular: soft blue-white at top fading out
    const vSpec = ctx.createLinearGradient(x, y, x, y + h);
    vSpec.addColorStop(0,    'rgba(120,160,255,0.28)');
    vSpec.addColorStop(0.12, 'rgba(80,120,220,0.10)');
    vSpec.addColorStop(0.45, 'rgba(40,80,180,0.03)');
    vSpec.addColorStop(1,    'rgba(0,0,20,0.12)');
    ctx.fillStyle = vSpec;
    ctx.fillRect(x, y, w, h);

    // Left-edge specular: thin bright sliver on the left rim
    const lSpec = ctx.createLinearGradient(x, y, x + 18, y);
    lSpec.addColorStop(0, 'rgba(140,180,255,0.30)');
    lSpec.addColorStop(1, 'rgba(100,140,255,0)');
    ctx.fillStyle = lSpec;
    ctx.fillRect(x, y, w, h);

    ctx.restore();

    // Outer rim — blue-tinted
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.strokeStyle = 'rgba(100,150,255,0.45)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    // Inner top shadow (depth)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r - 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.07)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();
  }

  _drawCard(ctx, x, y, cfg, isActive, isLocked) {
    const [r, g, b] = cfg.rgb;
    const w = CARD_W, h = CARD_H;

    ctx.save();
    ctx.globalAlpha *= isLocked ? 0.28 : 1;

    // Fill
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, CARD_R);
    if (isActive) {
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0,   rgba(r, g, b, 0.92));
      grad.addColorStop(0.6, rgba(r, g, b, 0.76));
      grad.addColorStop(1,   rgba(r, g, b, 0.88));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
    }
    ctx.fill();

    // Specular top-half highlight
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, CARD_R);
    const spec = ctx.createLinearGradient(x, y, x, y + h * 0.65);
    spec.addColorStop(0, isActive ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.20)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = spec;
    ctx.fill();

    // Border / glow
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, CARD_R);
    if (isActive) {
      ctx.shadowColor = rgba(r, g, b, 0.60);
      ctx.shadowBlur  = 20;
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth   = 1.5;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth   = 0.75;
    }
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    // Icon
    ctx.font         = '26px system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#fff';
    ctx.shadowColor  = 'rgba(0,0,0,0.30)';
    ctx.shadowBlur   = 5;
    ctx.fillText(cfg.icon, x + w / 2, y + h / 2 - 11);

    // Label — midnight blue liquid glass pill
    ctx.shadowBlur = 0;
    const pillH = 18, pillW = w - 10;
    const pillX = x + 5, pillY = y + h - pillH - 7;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 6);
    ctx.fillStyle = isActive ? 'rgba(8, 18, 60, 0.85)' : 'rgba(8, 18, 55, 0.72)';
    ctx.fill();
    // Subtle specular on pill
    const pSpec = ctx.createLinearGradient(pillX, pillY, pillX, pillY + pillH);
    pSpec.addColorStop(0, 'rgba(130,170,255,0.18)');
    pSpec.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pSpec;
    ctx.fill();
    ctx.strokeStyle = isActive ? 'rgba(120,160,255,0.40)' : 'rgba(80,120,220,0.25)';
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.font      = `${isActive ? 'bold ' : ''}11px system-ui, sans-serif`;
    ctx.fillStyle = isActive ? 'rgba(190,215,255,0.96)' : 'rgba(160,190,255,0.82)';
    ctx.fillText(cfg.name, x + w / 2, pillY + pillH / 2);

    ctx.restore();
  }

  /**
   * Small glass tab on the LEFT side of the panel — fixed position, always
   * fully opaque, so the user can always tap it regardless of panel state.
   * Rounded on the left, flush on the right (butts up against the panel).
   */
  _drawTab(ctx, w, h) {
    const [x1, y1, x2, y2] = this._tabRect(w, h);
    const tw = x2 - x1, th = y2 - y1;
    // Rounded left corners, flush right (panel is to the right of the tab)
    const corners = [10, 0, 0, 10];

    ctx.save();

    ctx.beginPath();
    ctx.roundRect(x1, y1, tw, th, corners);
    ctx.fillStyle = 'rgba(6, 20, 80, 0.72)';
    ctx.fill();

    // Specular
    const spec = ctx.createLinearGradient(x1, y1, x1, y1 + th);
    spec.addColorStop(0, 'rgba(120,160,255,0.22)');
    spec.addColorStop(1, 'rgba(40,80,180,0.04)');
    ctx.fillStyle = spec;
    ctx.beginPath();
    ctx.roundRect(x1, y1, tw, th, corners);
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.roundRect(x1, y1, tw, th, corners);
    ctx.strokeStyle = 'rgba(100,150,255,0.45)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Arrow: ‹ = collapse (panel visible), › = expand (panel hidden)
    ctx.font         = 'bold 12px system-ui, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.shadowColor  = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur   = 3;
    ctx.fillText(this._expanded ? '›' : '‹', x1 + tw / 2, y1 + th / 2);

    ctx.restore();
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  _tabRect(w, h) {
    // Tab slides with the panel so it's always flush on the panel's left edge.
    // When collapsed, fullSlide is sized so the tab remains partially visible.
    const panelX = w - PANEL_W - EDGE_GAP + this._slideOffset;
    return [panelX - TAB_W, h / 2 - TAB_H / 2, panelX, h / 2 + TAB_H / 2];
  }

  _cardRect(i, w, h, _count) {
    const panelH      = h * PANEL_FRAC;
    const panelX      = w - PANEL_W - EDGE_GAP + this._slideOffset;
    const panelY      = (h - panelH) / 2;
    const cardsStartY = panelY + 18;
    const cardX       = panelX + (PANEL_W - CARD_W) / 2;
    const cardY       = cardsStartY + i * (CARD_H + CARD_GAP);
    return [cardX, cardY, cardX + CARD_W, cardY + CARD_H];
  }
}
