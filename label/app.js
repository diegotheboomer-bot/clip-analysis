import {
  SCHEMA,
  names,
  needsBox,
  fitBox,
  validateAnswer,
  validateSubmission,
  collectOptions,
  toCoco,
} from "./core.mjs";

import { bindImageGestures } from "./gestures.mjs";

const $ = (id) => document.getElementById(id);
const elements = { overview: $("overview"), focus: $("focus") };
const imageCache = new Map();
const cancelGestures = [];
let overviewView,
  previewBox = null,
  gesturing = false;
let batch,
  storageKey,
  state,
  currentIndex = 0,
  draft,
  image,
  context = "image";
let focusCenter,
  focusWidth,
  frameReady = false,
  loadingToken = 0;
let storageOK = true,
  drawPending = false;
const initialDraft = () => ({
  status: null,
  bbox: null,
  edgeClipped: false,
  reason: null,
});
const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : [...crypto.getRandomValues(new Uint32Array(4))].join("-");
const frame = () => batch.frames[currentIndex];
const centerOf = (box) => [box[0] + box[2] / 2, box[1] + box[3] / 2];

function persist() {
  state.currentId = frame().id;
  state.drafts[frame().id] = draft;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    storageOK = true;
  } catch {
    storageOK = false;
  }
  $("save-state").textContent = storageOK
    ? "Saved on this device"
    : "Save unavailable · export results";
}

function error(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function imageAt(path) {
  if (!imageCache.has(path)) {
    const img = new Image();
    const promise = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => {
        imageCache.delete(path);
        reject(
          new Error(
            "Couldn't load the frame. Check your connection and try again.",
          ),
        );
      };
    });
    img.src = path;
    imageCache.set(path, promise);
    // Bounded caching avoids retaining the full batch of decoded images on phones.
    if (imageCache.size > 14) imageCache.delete(imageCache.keys().next().value);
  }
  return imageCache.get(path);
}

function syncButtons() {
  $("workspace").classList.toggle(
    "has-focus",
    Boolean(focusCenter && needsBox(draft.status) && context === "image"),
  );
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.status === draft.status),
    );
  });
  document.querySelectorAll("[data-reason]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.reason === draft.reason),
    );
  });
  $("absence-reasons").hidden = draft.status !== "not_visible";
  $("edge-option").hidden = !needsBox(draft.status);
  $("edge-clipped").checked = draft.edgeClipped;
  $("focus-panel").hidden = !focusCenter || !needsBox(draft.status);
  $("box-controls").hidden = !draft.bbox;
  if (draft.bbox) {
    $("width-value").textContent = draft.bbox[2] + " px";
    $("height-value").textContent = draft.bbox[3] + " px";
  }
  const help = {
    visible: draft.bbox
      ? "Check the outline, then save. Drag again to replace the box."
      : "Drag a box around the ball. Pinch with two fingers to zoom.",
    partial:
      "Outline the visible part of the ball. Use Not visible if it is completely hidden.",
    not_visible: "Choose a reason. A completely hidden ball has no box.",
    unsure: "This frame will be kept for another review.",
  };
  $("decision-help").textContent =
    help[draft.status] ||
    "Follow the ball being played. If you can't identify it, choose Unsure.";
  let valid = false;
  try {
    validateAnswer(draft, frame());
    valid = true;
  } catch {}
  $("save-next-button").disabled =
    !valid || !frameReady || context !== "image" || gesturing;
  $("previous-button").disabled = currentIndex === 0;
  $("save-next-button").firstChild.textContent =
    currentIndex === batch.frames.length - 1
      ? "Save & finish "
      : "Save & next ";
  $("refine-box").hidden =
    !draft.bbox || Boolean(focusCenter) || context !== "image";
  $("zoom-level").textContent =
    (frame().width / overviewView[2]).toFixed(1) + "×";
  $("zoom-in").disabled = focusWidth <= 24;
  $("zoom-out").disabled = focusWidth >= frame().width;
}

function updateProgress() {
  const count = Object.keys(state.answers).length;
  $("total-badge").textContent = count;
  $("progress-label").textContent =
    currentIndex +
    1 +
    " of " +
    batch.frames.length +
    " · " +
    count +
    " reviewed";
  $("progress-fill").style.width = (count / batch.frames.length) * 100 + "%";
}

function paintCanvas(canvas, source, sourceCrop, box) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width),
    height = Math.max(1, rect.height);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = canvas !== elements.focus;
  const [sx, sy, sw, sh] = sourceCrop;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  if (!box || context !== "image") return;
  const [x, y, w, h] = box;
  const px = ((x - sx) / sw) * width,
    py = ((y - sy) / sh) * height;
  const pw = (w / sw) * width,
    ph = (h / sh) * height;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#102214";
  ctx.strokeRect(px, py, pw, ph);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#d2ff78";
  ctx.strokeRect(px, py, pw, ph);
  const cx = px + pw / 2,
    cy = py + ph / 2;
  ctx.fillStyle = "#d2ff78";
  // A small centre dot leaves the ball itself visible in the magnified view.
  if (canvas === elements.overview) {
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw() {
  drawPending = false;
  if (!image || !frameReady) return;
  const box = previewBox || draft.bbox;
  paintCanvas(elements.overview, image, overviewView, box);
  if (!focusCenter || $("focus-panel").hidden) return;
  paintCanvas(elements.focus, image, focusView(), box);
}

function focusView() {
  const rect = elements.focus.getBoundingClientRect();
  const f = frame();
  const width = Math.min(f.width, focusWidth);
  const height = Math.min(
    f.height,
    (width * rect.height) / Math.max(1, rect.width),
  );
  return [
    Math.max(0, Math.min(f.width - width, focusCenter[0] - width / 2)),
    Math.max(0, Math.min(f.height - height, focusCenter[1] - height / 2)),
    width,
    height,
  ];
}

function scheduleDraw() {
  if (!drawPending) {
    drawPending = true;
    requestAnimationFrame(draw);
  }
}

async function showContext(which) {
  cancelGestures.forEach((cancel) => cancel());
  context = which;
  const token = ++loadingToken;
  frameReady = false;
  $("image-feedback").hidden = false;
  $("image-feedback").textContent = "Loading frame…";
  syncButtons();
  $("focus-panel").hidden =
    which !== "image" || !focusCenter || !needsBox(draft.status);
  for (const [id, value] of [
    ["before-button", "before"],
    ["current-button", "image"],
    ["after-button", "after"],
  ]) {
    $(id).classList.toggle("active", value === which);
    $(id).setAttribute("aria-pressed", String(value === which));
  }
  $("overview-hint").textContent =
    which === "image"
      ? "Pinch to zoom and move with two fingers. Drag a box around the ball with one finger."
      : "Context only. Return to This frame to place your label.";
  try {
    const img = await imageAt(frame()[which]);
    if (token !== loadingToken) return;
    image = img;
    frameReady = true;
    $("image-feedback").hidden = which === "image";
    $("image-feedback").textContent =
      which === "before" ? "Before · context only" : "After · context only";
    syncButtons();
    if (which !== "image") $("focus-panel").hidden = true;
    scheduleDraw();
  } catch (err) {
    if (token !== loadingToken) return;
    $("image-feedback").textContent = err.message;
  }
}

function go(index) {
  cancelGestures.forEach((cancel) => cancel());
  if (index < 0 || index >= batch.frames.length) return;
  currentIndex = index;
  const f = frame();
  overviewView = [0, 0, f.width, f.height];
  draft = structuredClone(
    state.drafts[f.id] || state.answers[f.id] || initialDraft(),
  );
  focusCenter = draft.bbox ? centerOf(draft.bbox) : null;
  focusWidth = Math.min(120, f.width);
  $("frame-label").textContent = f.source;
  $("time-label").textContent = f.timestampSec.toFixed(2) + " s";
  elements.overview.style.aspectRatio = f.width + " / " + f.height;
  $("workspace").hidden = false;
  $("results-view").hidden = true;
  error();
  updateProgress();
  persist();
  showContext("image");
  for (const nearby of [f.before, f.after, batch.frames[index + 1]?.image]) {
    if (nearby) imageAt(nearby).catch(() => {});
  }
}

function changed() {
  delete state.answers[frame().id];
  updateProgress();
  error();
  syncButtons();
  persist();
  scheduleDraw();
}

function place(x, y, precise) {
  if (!frameReady || context !== "image") return;
  if (!needsBox(draft.status)) draft.status = "visible";
  const box = draft.bbox;
  draft.bbox = fitBox([x, y], box?.[2] || 8, box?.[3] || 8, frame());
  if (!precise) focusCenter = [x, y];
  changed();
}

function saveNext() {
  if (!frameReady || context !== "image") return;
  try {
    state.answers[frame().id] = validateAnswer(draft, frame());
    persist();
    if (currentIndex < batch.frames.length - 1) {
      go(currentIndex + 1);
      // Keep mobile users near the frame after working in the magnified view.
      if (matchMedia("(max-width:700px)").matches)
        $("workspace").scrollIntoView({ block: "start", behavior: "instant" });
    } else showResults();
  } catch (err) {
    error(err.message);
  }
}

function makeSubmission() {
  return {
    schema: SCHEMA,
    batchId: batch.id,
    reviewerId: state.reviewerId,
    annotator: state.annotator || "Unnamed reviewer",
    exportedAt: new Date().toISOString(),
    answers: state.answers,
  };
}

function download(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function shareResults() {
  const submission = makeSubmission();
  const file = new File(
    [JSON.stringify(submission, null, 2)],
    resultsFilename(),
    { type: "application/json" },
  );
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "PitchCam ball labels" });
      $("export-message").textContent =
        "Shared. Your copy is still saved in this browser.";
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  download(submission, resultsFilename());
  $("export-message").textContent =
    "Results downloaded. Send the JSON file back to the organiser.";
}

function resultsFilename() {
  const name = (state.annotator || "reviewer")
    .replace(/[^a-z0-9-]/gi, "-")
    .slice(0, 40);
  return "pitchcam-" + name + "-" + state.reviewerId.slice(0, 8) + ".json";
}

function submissions() {
  return [
    ...state.imports.filter((s) => s.reviewerId !== state.reviewerId),
    makeSubmission(),
  ];
}

function showResults() {
  persist();
  $("workspace").hidden = true;
  $("results-view").hidden = false;
  $("total-badge").textContent = Object.keys(state.answers).length;
  const reviewed = Object.keys(state.answers).length;
  $("results-summary").textContent =
    reviewed +
    " of " +
    batch.frames.length +
    " reviewed · " +
    (batch.frames.length - reviewed) +
    " remaining";
  const list = $("frame-list");
  list.replaceChildren();
  batch.frames.forEach((f, index) => {
    const button = document.createElement("button");
    button.className = "frame-item";
    const thumbnail = document.createElement("img");
    thumbnail.src = f.image;
    thumbnail.loading = "lazy";
    thumbnail.alt = "";
    const text = document.createElement("span");
    text.textContent =
      index +
      1 +
      " · " +
      f.source.replace(".mp4", "") +
      " " +
      f.timestampSec.toFixed(2) +
      "s";
    const small = document.createElement("small");
    small.textContent = names[state.answers[f.id]?.status] || "To do";
    text.append(small);
    button.append(thumbnail, text);
    button.onclick = () => {
      go(index);
      window.scrollTo(0, 0);
    };
    list.append(button);
  });
  renderCollection();
  window.scrollTo(0, 0);
}

function renderCollection() {
  const all = submissions();
  const coco = toCoco(batch, all, state.choices);
  const imported = state.imports.length;
  $("collected-summary").textContent =
    imported +
    " imported review" +
    (imported === 1 ? "" : "s") +
    " · " +
    coco.images.length +
    " training images · " +
    coco.info.unresolved_frames +
    " conflicts to resolve";
  const container = $("conflicts");
  container.replaceChildren();
  batch.frames.forEach((f) => {
    const options = collectOptions(f, all);
    if (options.length < 2) return;
    const card = document.createElement("div");
    card.className = "conflict";
    const title = document.createElement("p");
    title.textContent = f.source + " · " + f.timestampSec.toFixed(2) + " s";
    const preview = document.createElement("canvas");
    preview.width = f.width;
    preview.height = f.height;
    preview.setAttribute("aria-label", "Preview of the selected label");
    const choices = document.createElement("div");
    choices.className = "choices";
    const paint = async () => {
      try {
        const img = await imageAt(f.image);
        const ctx = preview.getContext("2d");
        ctx.drawImage(img, 0, 0, f.width, f.height);
        const selected = options.find((o) => o.key === state.choices[f.id]);
        if (selected?.answer.bbox) {
          ctx.lineWidth = Math.max(2, f.width / 450);
          ctx.strokeStyle = "#cfff75";
          ctx.strokeRect(...selected.answer.bbox);
        }
      } catch {}
    };
    options.forEach((option) => {
      const button = document.createElement("button");
      button.textContent =
        option.reviewers.join(", ") +
        " · " +
        names[option.answer.status] +
        (option.answer.bbox
          ? " · box " + option.answer.bbox.join(", ")
          : " · " + (option.answer.reason || ""));
      button.setAttribute(
        "aria-pressed",
        String(state.choices[f.id] === option.key),
      );
      button.onclick = () => {
        state.choices[f.id] = option.key;
        persist();
        renderCollection();
      };
      choices.append(button);
    });
    card.append(title, preview, choices);
    container.append(card);
    paint();
  });
}

async function importResults(files) {
  $("import-feedback").textContent = "Reading results…";
  try {
    const imports = [...state.imports];
    for (const file of files) {
      if (file.size > 5_000_000)
        throw new Error("Results files must be under 5 MB.");
      const result = validateSubmission(JSON.parse(await file.text()), batch);
      if (result.reviewerId === state.reviewerId) {
        throw new Error(
          "These are your own results. Use a friend's file here. Your current work is already included.",
        );
      }
      const index = imports.findIndex(
        (s) => s.reviewerId === result.reviewerId,
      );
      if (index < 0) imports.push(result);
      else if (
        Date.parse(result.exportedAt) > Date.parse(imports[index].exportedAt)
      )
        imports[index] = result;
    }
    state.imports = imports;
    persist();
    renderCollection();
    $("import-feedback").textContent =
      "Reviews imported and saved on this device.";
  } catch (err) {
    $("import-feedback").textContent = "Import failed. " + err.message;
  }
  $("import-files").value = "";
}

function draggedBox(a, b) {
  const f = frame();
  const clamp = (point) => [
    Math.max(0, Math.min(f.width, point[0])),
    Math.max(0, Math.min(f.height, point[1])),
  ];
  const start = clamp(a),
    end = clamp(b);
  return fitBox(
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    Math.abs(end[0] - start[0]),
    Math.abs(end[1] - start[1]),
    f,
  );
}

function bindEvents() {
  for (const canvas of [elements.overview, elements.focus]) {
    const overview = canvas === elements.overview;
    cancelGestures.push(
      bindImageGestures(canvas, {
        enabled: () =>
          frameReady && context === "image" && !$("workspace").hidden,
        image: frame,
        getView: () => (overview ? overviewView : focusView()),
        setView: (view) => {
          if (overview) {
            overviewView = view;
            $("zoom-level").textContent =
              (frame().width / view[2]).toFixed(1) + "×";
          } else {
            focusCenter = centerOf(view);
            focusWidth = view[2];
          }
          scheduleDraw();
        },
        active: (active) => {
          gesturing = active;
          syncButtons();
        },
        preview: (points) => {
          previewBox = points ? draggedBox(...points) : null;
          scheduleDraw();
        },
        commit: (a, b) => {
          if (!needsBox(draft.status)) draft.status = "visible";
          draft.bbox = draggedBox(a, b);
          if (overview) focusCenter = null;
          changed();
        },
        tap: (x, y) => place(x, y, !overview),
      }),
    );
  }
  document.querySelectorAll("[data-status]").forEach(
    (button) =>
      (button.onclick = () => {
        draft.status = button.dataset.status;
        draft.reason = null;
        // A hidden or uncertain ball carries no location into an export.
        if (!needsBox(draft.status)) {
          draft.bbox = null;
          draft.edgeClipped = false;
        }
        changed();
      }),
  );
  document.querySelectorAll("[data-reason]").forEach(
    (button) =>
      (button.onclick = () => {
        draft.reason = button.dataset.reason;
        changed();
      }),
  );
  $("edge-clipped").onchange = (event) => {
    draft.edgeClipped = event.target.checked;
    changed();
  };
  for (const dimension of ["width", "height"]) {
    for (const [suffix, delta] of [
      ["minus", -1],
      ["plus", 1],
    ]) {
      $(dimension + "-" + suffix).onclick = () => {
        if (!draft.bbox) return;
        const [, , w, h] = draft.bbox;
        draft.bbox = fitBox(
          centerOf(draft.bbox),
          dimension === "width" ? w + delta : w,
          dimension === "height" ? h + delta : h,
          frame(),
        );
        changed();
      };
    }
  }
  $("reset-view").onclick = () => {
    overviewView = [0, 0, frame().width, frame().height];
    syncButtons();
    scheduleDraw();
  };
  $("refine-box").onclick = () => {
    focusCenter = centerOf(draft.bbox);
    focusWidth = Math.min(120, frame().width);
    syncButtons();
    scheduleDraw();
  };
  $("choose-area").onclick = () => {
    focusCenter = null;
    syncButtons();
    scheduleDraw();
  };
  $("zoom-in").onclick = () => {
    focusWidth = Math.max(24, focusWidth / 1.5);
    syncButtons();
    scheduleDraw();
  };
  $("zoom-out").onclick = () => {
    focusWidth = Math.min(frame().width, focusWidth * 1.5);
    syncButtons();
    scheduleDraw();
  };
  for (const [id, which] of [
    ["before-button", "before"],
    ["current-button", "image"],
    ["after-button", "after"],
  ]) {
    $(id).onclick = () => showContext(which);
  }
  $("save-next-button").onclick = saveNext;
  $("previous-button").onclick = () => go(currentIndex - 1);
  $("skip-button").onclick = () => {
    if (currentIndex === batch.frames.length - 1) showResults();
    else go(currentIndex + 1);
  };
  $("reviewer-name").oninput = (event) => {
    state.annotator = event.target.value.trim().slice(0, 50);
    persist();
  };
  $("results-button").onclick = showResults;
  $("back-to-work").onclick = () => go(currentIndex);
  $("download-results").onclick = () => {
    download(makeSubmission(), resultsFilename());
    $("export-message").textContent =
      "Results downloaded. Send the JSON file back to the organiser.";
  };
  $("share-results").onclick = shareResults;
  $("import-files").onchange = (event) => importResults(event.target.files);
  $("export-coco").onclick = () => {
    const coco = toCoco(batch, submissions(), state.choices);
    if (!coco.images.length) {
      $("import-feedback").textContent =
        "Mark at least one visible ball or confirmed outside-frame example first.";
      return;
    }
    if (coco.info.unresolved_frames) {
      $("import-feedback").textContent =
        "Choose an answer for each conflict before exporting.";
      return;
    }
    download(coco, "pitchcam-" + batch.id + "-coco.json");
    $("import-feedback").textContent =
      "COCO labels downloaded. Image paths refer to this batch's media folder in the repository.";
  };
  const dialog = $("help-dialog");
  $("help-button").onclick = () => dialog.showModal();
  const close = () => {
    dialog.close();
    state.helpSeen = true;
    persist();
  };
  $("close-help").onclick = $("start-review").onclick = close;
  dialog.addEventListener("cancel", () => {
    state.helpSeen = true;
    persist();
  });
  window.addEventListener("resize", () => {
    cancelGestures.forEach((cancel) => cancel());
    scheduleDraw();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.target.matches("input,textarea,select") ||
      dialog.open ||
      $("workspace").hidden
    )
      return;
    const statuses = ["visible", "partial", "not_visible", "unsure"];
    if (["1", "2", "3", "4"].includes(event.key)) {
      document
        .querySelector(
          '[data-status="' + statuses[Number(event.key) - 1] + '"]',
        )
        .click();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!$("save-next-button").disabled) saveNext();
    } else if (
      event.key.startsWith("Arrow") &&
      draft.bbox &&
      context === "image"
    ) {
      event.preventDefault();
      const point = centerOf(draft.bbox);
      const delta = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft") point[0] -= delta;
      if (event.key === "ArrowRight") point[0] += delta;
      if (event.key === "ArrowUp") point[1] -= delta;
      if (event.key === "ArrowDown") point[1] += delta;
      draft.bbox = fitBox(point, draft.bbox[2], draft.bbox[3], frame());
      changed();
    }
  });
}

async function start() {
  try {
    const response = await fetch("batch.json");
    if (!response.ok) throw new Error("Couldn't load the batch.");
    batch = await response.json();
    if (!batch.frames?.length) throw new Error("This batch has no frames.");
    storageKey = "pitchcam-labels:" + batch.id;
    state = {
      reviewerId: uuid(),
      answers: {},
      drafts: {},
      imports: [],
      choices: {},
      annotator: "",
      helpSeen: false,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.reviewerId) {
        const clean = validateSubmission(
          {
            ...saved,
            schema: SCHEMA,
            batchId: batch.id,
            exportedAt: new Date().toISOString(),
          },
          batch,
        );
        state = { ...state, ...saved, answers: clean.answers };
        state.drafts = saved.drafts || {};
        state.imports = (saved.imports || []).map((s) =>
          validateSubmission(s, batch),
        );
      }
    } catch (err) {
      $("save-state").textContent = "Couldn't restore progress";
    }
    const position = batch.frames.findIndex((f) => f.id === state.currentId);
    $("reviewer-name").value = state.annotator;
    $("loading").hidden = true;
    bindEvents();
    go(Math.max(0, position));
    if (!state.helpSeen) $("help-dialog").showModal();
  } catch (err) {
    $("loading").textContent = err.message + " Refresh this page to retry.";
  }
}
start();
