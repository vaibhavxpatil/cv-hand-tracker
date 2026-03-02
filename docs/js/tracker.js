/**
 * tracker.js — Hand landmarker setup + drawing utilities.
 *
 * Replaces tracker.py. Uses MediaPipe Tasks Vision JS (WebAssembly).
 * All landmark coordinates from MediaPipe are in unmirrored [0,1] space;
 * lmToScreen() applies the horizontal mirror so the canvas matches a
 * selfie-mode view (same as cv2.flip(frame, 1) in the Python version).
 */

import { HandLandmarker, FilesetResolver } from
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Pairs of landmark indices that form the hand skeleton
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [0, 9], [9, 10], [10, 11], [11, 12],     // middle
  [0, 13], [13, 14], [14, 15], [15, 16],   // ring
  [0, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [5, 9], [9, 13], [13, 17],               // palm
];

/**
 * Build and return a HandLandmarker in VIDEO running mode.
 * Tries GPU delegate first, falls back to CPU.
 */
export async function setupHandLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_PATH);

  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  });

  try {
    return await HandLandmarker.createFromOptions(filesetResolver, opts('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(filesetResolver, opts('CPU'));
  }
}

/**
 * Convert a normalized MediaPipe landmark to mirrored canvas pixel coords.
 * Mirrors x so the result matches a horizontally-flipped (selfie) display.
 */
export function lmToScreen(lm, w, h) {
  return { x: (1 - lm.x) * w, y: lm.y * h };
}

/**
 * Draw hand skeleton + joint dots onto ctx.
 * Equivalent to draw_landmarks() in tracker.py.
 */
export function drawLandmarks(ctx, landmarks, w, h) {
  ctx.save();

  // Connections
  ctx.beginPath();
  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = 2;
  for (const [a, b] of CONNECTIONS) {
    const pa = lmToScreen(landmarks[a], w, h);
    const pb = lmToScreen(landmarks[b], w, h);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }
  ctx.stroke();

  // Joint dots
  for (const lm of landmarks) {
    const p = lmToScreen(lm, w, h);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ff1744';
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw a white ring cursor at the index finger tip (landmark 8).
 * Equivalent to draw_index_tip_cursor() in tracker.py.
 */
export function drawIndexTipCursor(ctx, landmarks, w, h) {
  const tip = lmToScreen(landmarks[8], w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw full hand info (skeleton + handedness label) for all detected hands.
 * Called only when no app is active — equivalent to draw_info() in tracker.py.
 */
export function drawInfo(ctx, result, w, h) {
  if (!result?.landmarks?.length) return;

  for (let i = 0; i < result.landmarks.length; i++) {
    const landmarks = result.landmarks[i];
    drawLandmarks(ctx, landmarks, w, h);
    drawIndexTipCursor(ctx, landmarks, w, h);

    // Handedness label near the wrist
    const handedness = result.handedness?.[i]?.[0];
    if (handedness) {
      const wrist = lmToScreen(landmarks[0], w, h);
      ctx.save();
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(
        `${handedness.displayName} ${(handedness.score * 100).toFixed(0)}%`,
        wrist.x + 12,
        wrist.y + 12,
      );
      ctx.restore();
    }
  }
}
