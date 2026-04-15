/**
 * main.js — Entry point. Owns the webcam loop and MediaPipe session.
 *
 * Equivalent to main.py, rewritten for the browser:
 *   cv2.VideoCapture    → navigator.mediaDevices.getUserMedia
 *   cv2.imshow          → <canvas> element
 *   cv2.flip(frame, 1)  → ctx.scale(-1, 1) when drawing video
 *   mp.Image + detect   → handLandmarker.detectForVideo
 *
 * Coordinate convention
 * ─────────────────────
 * MediaPipe returns landmarks in unmirrored [0,1] space (raw camera).
 * We display a mirrored (selfie) view by drawing the video flipped.
 * To keep finger positions consistent with the visual, x is mirrored:
 *   screenX = (1 - landmark.x) * width
 * This matches Python where cv2.flip() is called before MediaPipe runs.
 */

import { setupHandLandmarker, drawInfo, drawLandmarks, drawIndexTipCursor }
  from './tracker.js';
import { PopItGame } from './apps/pop_it.js';
import { DrawApp }   from './apps/draw.js';
import { Sidebar }   from './sidebar.js';

async function main() {
  const video   = document.getElementById('webcam');
  const canvas  = document.getElementById('canvas');
  const ctx     = canvas.getContext('2d');
  const loading = document.getElementById('loading');
  const loadMsg = document.getElementById('loading-msg');

  // ── 1. Camera ─────────────────────────────────────────────────────────────
  loadMsg.textContent = 'Requesting camera…';

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width:  { ideal: 1280 },
      height: { ideal: 720  },
    },
    audio: false,
  });

  video.srcObject = stream;
  await new Promise(resolve => { video.onloadedmetadata = resolve; });
  await video.play();

  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;

  // ── 2. MediaPipe ──────────────────────────────────────────────────────────
  loadMsg.textContent = 'Loading hand tracking model…';
  const handLandmarker = await setupHandLandmarker();
  loading.classList.add('hidden');

  // ── 3. Apps + sidebar ────────────────────────────────────────────────────
  // Add new apps here (same pattern as main.py)
  const apps = [
    new PopItGame(),
    new DrawApp(),
  ];
  const sidebar = new Sidebar();

  // ── 4. Main loop ──────────────────────────────────────────────────────────
  let lastTimestamp = -1;

  function loop(now) {
    const w = canvas.width;
    const h = canvas.height;

    // Draw mirrored video frame (selfie view, same as cv2.flip(frame, 1))
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // Detect hands — skip if timestamp didn't advance (paused tab, etc.)
    let result = null;
    if (now !== lastTimestamp) {
      try {
        result = handLandmarker.detectForVideo(video, now);
        lastTimestamp = now;
      } catch {
        /* timestamp ordering error — skip this frame */
      }
    }

    // Only the active app receives input — prevents launching another app
    // while one is already running (mirrors main.py lines 67-76).
    const activeApp = apps.find(a => !a.isIdle) ?? null;
    const targets   = activeApp ? [activeApp] : apps;

    if (result?.landmarks?.length) {
      for (const landmarks of result.landmarks) {
        const tip = landmarks[8]; // index finger tip
        // Mirror x to match selfie display (see coordinate convention above)
        const fx = Math.round((1 - tip.x) * w);
        const fy = Math.round(tip.y * h);
        // Sidebar: tab toggle works always; launching only when nothing is active
        sidebar.processFingertip(fx, fy, w, h, apps, !activeApp);
        for (const app of targets) {
          app.processFingertip(fx, fy, w, h);
          app.processHand(landmarks, w, h);
        }
      }
    }

    // Draw hand skeleton / labels
    // Full info in idle, skeleton-only when an app is active (avoids clutter)
    const anyActive = apps.some(a => !a.isIdle);
    if (!anyActive) {
      drawInfo(ctx, result, w, h);

      // ── CV Playground title — shown on idle home screen ─────────────────
      ctx.save();
      ctx.font      = 'bold 52px system-ui, sans-serif';
      ctx.textAlign = 'center';

      // Dark glass pill behind title + subtitle for camera readability
      const titleMetrics    = ctx.measureText('CV Playground');
      const pillPadX = 28, pillPadY = 14;
      const pillW = titleMetrics.width + pillPadX * 2 + 40; // +40 for subtitle wider
      const pillH = 90;
      const pillX = w / 2 - pillW / 2;
      const pillY = 6;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillW, pillH, 18);
      ctx.fillStyle = 'rgba(8, 10, 28, 0.62)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Main title
      ctx.textBaseline  = 'middle';
      ctx.fillStyle     = 'rgba(255,255,255,0.92)';
      ctx.shadowColor   = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur    = 8;
      ctx.fillText('CV Playground', w / 2, 46);

      // Subtitle
      ctx.font          = '17px system-ui, sans-serif';
      ctx.fillStyle     = 'rgba(200,210,255,0.70)';
      ctx.shadowColor   = 'transparent';
      ctx.shadowBlur    = 0;
      ctx.fillText('Point your index finger at an app to begin', w / 2, 82);
      ctx.restore();
    } else if (result?.landmarks?.length) {
      for (const landmarks of result.landmarks) {
        drawLandmarks(ctx, landmarks, w, h);
        drawIndexTipCursor(ctx, landmarks, w, h);
      }
    }

    // Render apps — pass true so apps never draw their own idle trigger
    // buttons (the sidebar dock replaces them).
    for (const app of apps) {
      app.updateAndDraw(ctx, w, h, true);
    }

    // Sidebar always rendered last so it sits on top of everything.
    sidebar.updateAndDraw(ctx, w, h, apps);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

main().catch(err => {
  const msg = document.getElementById('loading-msg');
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = 'none';
  if (msg) {
    msg.textContent = `Error: ${err.message}`;
    msg.style.color = '#ff5252';
  }
  console.error(err);
});
