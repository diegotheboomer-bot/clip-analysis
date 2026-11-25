import { api } from "./team-router.js";
import { VideoReader } from "./video-reader.mjs";
import { runImportQueue } from "./import-queue.mjs";

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
async function capture(reader, time, canvas, withThumbnail = false) {
  const actualTime = await reader.seek(time);
  const video = reader.video;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.93),
  );
  if (!blob) throw new Error("Couldn't encode this frame.");
  let thumbnail;
  if (withThumbnail) {
    const small = document.createElement("canvas"),
      scale = Math.min(1, 320 / canvas.width);
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
    thumbnail = await new Promise((resolve) =>
      small.toBlob(resolve, "image/jpeg", 0.8),
    );
    if (!thumbnail) throw new Error("Couldn't encode the frame thumbnail.");
  }
  return { blob, thumbnail, time: actualTime };
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
  // Look up completed work before opening videos or allocating an AI session.
  const dashboard = await api("/api/admin/dashboard");
  const known = new Map(
    dashboard.clips.map((clip) => [clip.fingerprint, clip]),
  );
  const fingerprints = new Map();
  let reader, loadedModel;
  const model = async () => {
    if (!loadedModel) {
      onStatus("Loading AI model. The first load may take a minute.");
      try {
        loadedModel = await startModel(modelName, onStatus);
      } catch (error) {
        error.fatal = true;
        throw error;
      }
    }
    return loadedModel;
  };
  try {
    const result = await runImportQueue(files, {
      paused,
      onStatus,
      onProgress,
      processFile: async (file, index, attempt) => {
        const prefix = `${index + 1} / ${files.length} · ${file.name}`;
        if (!fingerprints.has(file))
          fingerprints.set(
            file,
            await fingerprint(file, project + "|" + group + "|" + interval),
          );
        const hash = fingerprints.get(file);
        let clip = known.get(hash);
        if (clip?.status === "ready") {
          onStatus(prefix + " · already imported");
          return;
        }
        let existing = new Set();
        if (clip) {
          const prior = await api("/api/admin/clips/" + clip.id);
          clip = prior.clip;
          existing = new Set(prior.frames.map((frame) => frame.seq));
          if (clip.status === "ready") {
            known.set(hash, clip);
            return;
          }
          if (existing.size === clip.expected_frames) {
            await api("/api/admin/clips/" + clip.id + "/publish", {
              method: "POST",
            });
            known.set(hash, { ...clip, status: "ready" });
            return;
          }
        }
        reader ||= new VideoReader({ paused });
        onStatus(
          prefix + (attempt ? " · reopening video" : " · opening video"),
        );
        try {
          const media = await reader.open(file);
          if (!clip) {
            const imported = await api("/api/admin/clips", {
              method: "POST",
              body: JSON.stringify({
                title: file.name,
                project,
                matchGroup: group,
                duration: media.duration,
                interval,
                expectedFrames: Math.ceil(media.duration / interval),
                fingerprint: hash,
              }),
            });
            clip = imported.clip;
            known.set(hash, clip);
            if (clip.status === "ready") return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = media.width;
          canvas.height = media.height;
          const expected = clip.expected_frames;
          for (let seq = 0; seq < expected; seq++) {
            if (paused()) {
              const error = new Error("Import paused.");
              error.name = "ImportPaused";
              throw error;
            }
            if (existing.has(seq)) {
              onProgress((index + (seq + 1) / expected) / files.length);
              continue;
            }
            const aiModel = await model();
            const time = seq * interval;
            onStatus(
              prefix +
                ` · decoding frame ${seq + 1} / ${expected} at ${time.toFixed(2)} s`,
            );
            // Read nearby frames in time order, keeping the AI bitmap tied to
            // the centre image even while the decoder advances to the context.
            const before = await capture(reader, time - 0.15, canvas);
            const current = await capture(reader, time, canvas, true);
            const bitmap = await createImageBitmap(canvas);
            let after, prediction;
            try {
              after = await capture(reader, time + 0.15, canvas);
              onStatus(
                prefix +
                  ` · finding the ball in frame ${seq + 1} / ${expected}`,
              );
              prediction = await predict(bitmap);
            } finally {
              bitmap.close();
            }
            onStatus(prefix + ` · saving frame ${seq + 1} / ${expected}`);
            await Promise.all(
              [
                ["image", current.blob],
                ["thumb", current.thumbnail],
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
                modelName: aiModel.modelName,
                modelHash: aiModel.modelHash,
              }),
            });
            existing.add(seq);
            onProgress((index + (seq + 1) / expected) / files.length);
          }
          await api("/api/admin/clips/" + clip.id + "/publish", {
            method: "POST",
          });
          known.set(hash, { ...clip, status: "ready" });
          onStatus(prefix + " · ready for reviewers");
        } finally {
          reader.releaseSource();
        }
      },
    });
    if (result.paused)
      onStatus("Paused. Saved frames are kept. Resume when you're ready.");
    else if (result.failed.length)
      onStatus(
        `${result.completed} of ${files.length} clips ready. ${result.failed.length} clip${result.failed.length === 1 ? " needs" : "s need"} retry. Other clips have finished.`,
      );
    else
      onStatus(
        `${result.completed} clip${result.completed === 1 ? " is" : "s are"} ready for reviewers.`,
      );
    return result;
  } finally {
    reader?.close();
  }
}
