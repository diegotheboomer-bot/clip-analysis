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
// hidden <video> so the visible player isn't disturbed.
export async function captureFrames(url: string, times: number[], maxW = 1280): Promise<Frame[]> {
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
