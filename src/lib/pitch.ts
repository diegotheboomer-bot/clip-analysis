// Pitch calibration: image points → real pitch metres via a homography.
//
// The 32 landmarks follow the order of Roboflow's football-field-detection
// model (index i ↔ vertex i, as in roboflow/sports SoccerPitchConfiguration),
// but with the sizes fixed by the Laws of the Game: penalty area 16.5 × 40.32m,
// goal area 5.5 × 18.32m, penalty spot 11m, centre circle 9.15m. Pitch
// length/width vary (esp. amateur); 105 × 68m is assumed for the outer points.

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

const PB_L = 16.5;
const PB_W = 40.32;
const GB_L = 5.5;
const GB_W = 18.32;
const SPOT = 11;
const R = 9.15;

const L = PITCH_LENGTH;
const W = PITCH_WIDTH;

// [x along the length, y across the width] in metres.
export const VERTICES: Array<[number, number]> = [
  [0, 0], // 1
  [0, (W - PB_W) / 2], // 2
  [0, (W - GB_W) / 2], // 3
  [0, (W + GB_W) / 2], // 4
  [0, (W + PB_W) / 2], // 5
  [0, W], // 6
  [GB_L, (W - GB_W) / 2], // 7
  [GB_L, (W + GB_W) / 2], // 8
  [SPOT, W / 2], // 9
  [PB_L, (W - PB_W) / 2], // 10
  [PB_L, (W - GB_W) / 2], // 11
  [PB_L, (W + GB_W) / 2], // 12
  [PB_L, (W + PB_W) / 2], // 13
  [L / 2, 0], // 14
  [L / 2, W / 2 - R], // 15
  [L / 2, W / 2 + R], // 16
  [L / 2, W], // 17
  [L - PB_L, (W - PB_W) / 2], // 18
  [L - PB_L, (W - GB_W) / 2], // 19
  [L - PB_L, (W + GB_W) / 2], // 20
  [L - PB_L, (W + PB_W) / 2], // 21
  [L - SPOT, W / 2], // 22
  [L - GB_L, (W - GB_W) / 2], // 23
  [L - GB_L, (W + GB_W) / 2], // 24
  [L, 0], // 25
  [L, (W - PB_W) / 2], // 26
  [L, (W - GB_W) / 2], // 27
  [L, (W + GB_W) / 2], // 28
  [L, (W + PB_W) / 2], // 29
  [L, W], // 30
  [L / 2 - R, W / 2], // 31
  [L / 2 + R, W / 2], // 32
];

export type Mat3 = number[]; // row-major 3×3

// Solve A x = b (n×n) by Gaussian elimination with partial pivoting.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export function apply(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// Least-squares homography (h33 = 1) from ≥4 point pairs, src → dst.
export function homography(src: Array<[number, number]>, dst: Array<[number, number]>): Mat3 | null {
  if (src.length < 4) return null;
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  src.forEach(([x, y], i) => {
    const [u, v] = dst[i];
    const rows: Array<[number[], number]> = [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ];
    for (const [a, b] of rows) {
      for (let r = 0; r < 8; r++) {
        Atb[r] += a[r] * b;
        for (let c = 0; c < 8; c++) AtA[r][c] += a[r] * a[c];
      }
    }
  });
  const h = solve(AtA, Atb);
  return h ? [...h, 1] : null;
}

export interface Calibration {
  H: Mat3; // image (0-1 normalized) → pitch metres
  points: number; // landmarks used
  error: number; // mean reprojection error, metres
}

// Keypoints in 0-1000 image coords (null = not confidently seen) → calibration.
// Refuses when the landmarks can't pin the view down reliably.
export function calibrate(keypoints: Array<[number, number] | null>): Calibration | null {
  const src: Array<[number, number]> = [];
  const dst: Array<[number, number]> = [];
  keypoints.forEach((k, i) => {
    if (k && VERTICES[i]) {
      src.push([k[0] / 1000, k[1] / 1000]); // normalize for numerical stability
      dst.push(VERTICES[i]);
    }
  });
  if (src.length < 4) return null;

  // Landmarks must span an area, not sit on one line.
  const xs = dst.map((d) => d[0]);
  const ys = dst.map((d) => d[1]);
  if (Math.max(...xs) - Math.min(...xs) < 3 || Math.max(...ys) - Math.min(...ys) < 3) return null;

  const H = homography(src, dst);
  if (!H) return null;
  const error = src.reduce((a, [x, y], i) => a + Math.hypot(apply(H, x, y)[0] - dst[i][0], apply(H, x, y)[1] - dst[i][1]), 0) / src.length;
  if (!Number.isFinite(error) || error > 2.5) return null;
  return { H, points: src.length, error };
}

// Image point (0-1000, [x, y]) → pitch metres [along length, across width].
export const toPitch = (cal: Calibration, x: number, y: number) => apply(cal.H, x / 1000, y / 1000);

export const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// A projected point is only trusted if it lands on (or just off) the pitch.
export const onPitch = ([x, y]: [number, number]) => x > -8 && x < L + 8 && y > -8 && y < W + 8;
