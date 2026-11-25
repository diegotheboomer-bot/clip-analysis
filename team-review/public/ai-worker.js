let session, ort, modelName;
const SIZE = 640;
async function init(name) {
  if (session && modelName === name) return;
  ort = await import(
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.webgpu.min.mjs"
  );
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/";
  const response = await fetch("/api/admin/model", {
    credentials: "same-origin",
    cache: "reload",
  });
  if (!response.ok)
    throw new Error("Upload an AI model before importing clips.");
  const bytes = await response.arrayBuffer();
  const actualName = decodeURIComponent(
    response.headers.get("x-model-name") || "YOLOX-S pretrained",
  );
  let backend = "WebAssembly";
  try {
    if (!navigator.gpu) throw new Error("WebGPU unavailable");
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
    backend = "WebGPU";
  } catch {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
  modelName = name;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const modelHash = [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  self.postMessage({
    type: "ready",
    backend,
    modelHash,
    modelName: actualName,
  });
}
async function detect(bitmap) {
  const canvas = new OffscreenCanvas(SIZE, SIZE),
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  const regions = [[0, 0, bitmap.width, bitmap.height]];
  const side = Math.min(
    bitmap.width,
    bitmap.height,
    Math.max(208, Math.round(bitmap.height * 0.578)),
  );
  for (const y of [0, bitmap.height - side]) {
    for (let i = 0; i < 4; i++)
      regions.push([
        Math.round(((bitmap.width - side) * i) / 3),
        y,
        side,
        side,
      ]);
  }
  let best = null;
  for (const [left, top, width, height] of regions) {
    const scale = Math.min(SIZE / width, SIZE / height);
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(
      bitmap,
      left,
      top,
      width,
      height,
      0,
      0,
      Math.floor(width * scale),
      Math.floor(height * scale),
    );
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data,
      data = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      data[i] = rgba[i * 4 + 2];
      data[SIZE * SIZE + i] = rgba[i * 4 + 1];
      data[2 * SIZE * SIZE + i] = rgba[i * 4];
    }
    const input = new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]);
    const outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]],
      columns = output.dims.at(-1);
    if (![6, 85].includes(columns) || output.data.length / columns !== 8400)
      throw new Error(
        "Use a YOLOX model with 640 × 640 input and raw 8400-row output.",
      );
    const values = output.data,
      classOffset = columns === 85 ? 37 : 5;
    let row = 0;
    for (const stride of [8, 16, 32]) {
      const count = SIZE / stride;
      for (let gy = 0; gy < count; gy++)
        for (let gx = 0; gx < count; gx++, row++) {
          const at = row * columns,
            confidence = values[at + 4] * values[at + classOffset];
          if (confidence < 0.25 || confidence <= (best?.confidence || 0))
            continue;
          const cx = ((values[at] + gx) * stride) / scale + left,
            cy = ((values[at + 1] + gy) * stride) / scale + top;
          const w = (Math.exp(values[at + 2]) * stride) / scale,
            h = (Math.exp(values[at + 3]) * stride) / scale;
          const x0 = Math.max(0, cx - w / 2),
            y0 = Math.max(0, cy - h / 2);
          const x1 = Math.min(bitmap.width, cx + w / 2),
            y1 = Math.min(bitmap.height, cy + h / 2);
          if (
            [x0, y0, x1, y1].every(Number.isFinite) &&
            x1 - x0 >= 1 &&
            y1 - y0 >= 1
          ) {
            best = {
              bbox: [x0, y0, x1 - x0, y1 - y0].map(
                (v) => Math.round(v * 10) / 10,
              ),
              confidence,
            };
          }
        }
    }
    input.dispose();
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
  return best;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      await init(data.name);
      return;
    }
    const started = performance.now();
    try {
      self.postMessage({
        type: "prediction",
        id: data.id,
        proposal: await detect(data.bitmap),
        elapsed: performance.now() - started,
      });
    } finally {
      data.bitmap.close();
    }
  } catch (error) {
    self.postMessage({ type: "error", id: data.id, message: error.message });
  }
};
