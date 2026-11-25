import { api } from "./team-router.js";

let ai,
  requestId = 0,
  waiting = new Map(),
  starting;
export function resetModel() {
  ai?.terminate();
  ai = null;
  starting = null;
  for (const p of waiting.values()) p.reject(new Error("Model changed."));
  waiting.clear();
}
function startModel(name, onStatus) {
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    ai = new Worker("/ai-worker.js", { type: "module" });
    ai.onmessage = ({ data }) => {
      if (data.type === "ready") {
        onStatus("AI ready · " + data.backend);
        resolve({ modelHash: data.modelHash, modelName: data.modelName });
      } else if (data.type === "error" && data.id === undefined) {
        ai.terminate();
        ai = null;
        starting = null;
        reject(new Error(data.message));
      } else {
        const promise = waiting.get(data.id);
        if (!promise) return;
        waiting.delete(data.id);
        if (data.type === "error") promise.reject(new Error(data.message));
        else promise.resolve(data);
      }
    };
    ai.onerror = (error) => {
      ai?.terminate();
      ai = null;
      starting = null;
      reject(
        new Error(
          error.message ||
            "Could not load AI. Try Chrome or Edge on your computer.",
        ),
      );
      for (const p of waiting.values()) p.reject(new Error("AI stopped."));
      waiting.clear();
    };
    ai.postMessage({ type: "init", name });
  });
  return starting;
}
function predict(bitmap) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    waiting.set(id, { resolve, reject });
    ai.postMessage({ type: "detect", id, bitmap }, [bitmap]);
  });
}
function once(video, event, action, ms = 15000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, success);
      video.removeEventListener("error", failure);
    };
    const success = () => {
      cleanup();
      resolve();
    };
    const failure = () => {
      cleanup();
      reject(
        new Error("The browser couldn't decode this video. Try an MP4 export."),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Video decoding timed out. Retry this clip."));
    }, ms);
    video.addEventListener(event, success, { once: true });
    video.addEventListener("error", failure, { once: true });
    action?.();
  });
}
async function fingerprint(file, group) {
  const start = await file.slice(0, 1_048_576).arrayBuffer(),
    end = await file.slice(Math.max(0, file.size - 1_048_576)).arrayBuffer();
  const meta = new TextEncoder().encode(group + "|" + file.size),
    bytes = new Uint8Array(start.byteLength + end.byteLength + meta.length);
  bytes.set(new Uint8Array(start));
  bytes.set(new Uint8Array(end), start.byteLength);
  bytes.set(meta, start.byteLength + end.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function capture(video, time, canvas) {
  const target = Math.max(0, Math.min(video.duration - 0.05, time));
  if (Math.abs(video.currentTime - target) > 0.001)
    await once(video, "seeked", () => {
      video.currentTime = target;
    });
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.93),
  );
  if (!blob) throw new Error("Couldn't encode this frame.");
  return { blob, time: video.currentTime };
}
export async function importClips({
  files,
  project,
  group,
  interval,
  modelName,
  onStatus,
  onProgress,
  paused,
}) {
  if (!("OffscreenCanvas" in window))
    throw new Error(
      "Use Chrome or Edge on your computer to import and run AI.",
    );
  onStatus("Loading AI model. The first load may take a minute.");
  const loadedModel = await startModel(modelName, onStatus);
  let completed = 0;
  for (const file of files) {
    if (paused()) return;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const objectUrl = URL.createObjectURL(file);
    try {
      await once(video, "loadeddata", () => {
        video.src = objectUrl;
        video.load();
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0)
        throw new Error("This video has no readable duration.");
      const expected = Math.ceil(video.duration / interval);
      const imported = await api("/api/admin/clips", {
        method: "POST",
        body: JSON.stringify({
          title: file.name,
          project,
          matchGroup: group,
          duration: video.duration,
          interval,
          expectedFrames: expected,
          fingerprint: await fingerprint(
            file,
            project + "|" + group + "|" + interval,
          ),
        }),
      });
      const clip = imported.clip;
      if (clip.status === "ready") {
        onStatus(file.name + " already imported.");
        completed++;
        continue;
      }
      const previous = await api("/api/admin/clips/" + clip.id),
        existing = new Set(previous.frames.map((f) => f.seq));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      for (let seq = 0; seq < expected; seq++) {
        if (paused()) {
          onStatus("Paused. Choose the same clips and settings to resume.");
          return;
        }
        if (existing.has(seq)) {
          onProgress((completed + seq / expected) / files.length);
          continue;
        }
        const time = Math.min(video.duration - 0.05, seq * interval);
        onStatus(
          file.name +
            " · frame " +
            (seq + 1) +
            " / " +
            expected +
            " · finding the ball",
        );
        const current = await capture(video, time, canvas);
        const bitmap = await createImageBitmap(canvas);
        const prediction = await predict(bitmap);
        const before = await capture(video, time - 0.15, canvas);
        const after = await capture(video, time + 0.15, canvas);
        onStatus(
          file.name +
            " · frame " +
            (seq + 1) +
            " / " +
            expected +
            " · saving " +
            (prediction.proposal ? "AI proposal" : "frame for human search"),
        );
        await Promise.all(
          [
            ["image", current.blob],
            ["before", before.blob],
            ["after", after.blob],
          ].map(([kind, blob]) =>
            api("/api/admin/assets/" + clip.id + "/" + seq + "/" + kind, {
              method: "PUT",
              body: blob,
              headers: { "Content-Type": "image/jpeg" },
            }),
          ),
        );
        await api("/api/admin/clips/" + clip.id + "/frames", {
          method: "POST",
          body: JSON.stringify({
            seq,
            time: current.time,
            width: canvas.width,
            height: canvas.height,
            proposal: prediction.proposal,
            modelName: loadedModel.modelName,
            modelHash: loadedModel.modelHash,
          }),
        });
        onProgress((completed + (seq + 1) / expected) / files.length);
      }
      await api("/api/admin/clips/" + clip.id + "/publish", { method: "POST" });
      completed++;
      onStatus(file.name + " is ready for reviewers.");
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }
  }
  onStatus("Import finished. Reviewers can claim these frames now.");
  onProgress(1);
}
