"use client";

export interface Frame {
  src: string; // JPEG data URL
  w: number;
  h: number;
}

const once = (el: HTMLVideoElement, ev: string, ms = 8000) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`video ${ev} timeout`)), ms);
    el.addEventListener(ev, () => (clearTimeout(t), resolve()), { once: true });
  });

// Grab still frames from a local video at the given times (seconds), using a
// hidden <video> so the visible player isn't disturbed. Kept at up to full HD
// so a small, distant ball survives.
export async function captureFrames(url: string, times: number[], maxW = 1920): Promise<Frame[]> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await once(v, "loadeddata");

  const scale = Math.min(1, maxW / v.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(v.videoWidth * scale);
  canvas.height = Math.round(v.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const out: Frame[] = [];
  for (const t of times) {
    if (Math.abs(v.currentTime - t) > 0.01) {
      const seeked = once(v, "seeked");
      v.currentTime = t;
      await seeked;
    }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    out.push({ src: canvas.toDataURL("image/jpeg", 0.85), w: canvas.width, h: canvas.height });
  }
  v.removeAttribute("src");
  v.load();
  return out;
}

// Draw a number above every detected person (Set-of-Mark), so the reasoning
// model can pick players by number instead of guessing coordinates.
export async function markFrame(frame: Frame, boxes: Array<[number, number, number, number]>): Promise<string> {
  const img = new Image();
  img.src = frame.src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = frame.w;
  c.height = frame.h;
  const ctx = c.getContext("2d");
  if (!ctx) return frame.src;
  ctx.drawImage(img, 0, 0);
  const fs = Math.max(13, Math.round(frame.h / 46));
  ctx.font = `800 ${fs}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  boxes.forEach(([y0, x0, , x1], i) => {
    const x = ((x0 + x1) / 2 / 1000) * frame.w;
    const y = (y0 / 1000) * frame.h - fs * 0.9;
    const label = String(i);
    const w = ctx.measureText(label).width + fs * 0.6;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(x - w / 2, y - fs * 0.62, w, fs * 1.24);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y + 1);
  });
  return c.toDataURL("image/jpeg", 0.9);
}
