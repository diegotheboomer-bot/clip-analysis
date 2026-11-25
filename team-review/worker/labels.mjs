export const SCHEMA = "pitchcam.ball-review.v1";
export const STATUSES = ["visible", "partial", "not_visible", "unsure"];
export const REASONS = ["outside_frame", "hidden", "unknown"];
export const names = {
  visible: "Visible",
  partial: "Partly covered",
  not_visible: "Not visible",
  unsure: "Unsure",
};

export function needsBox(status) {
  return status === "visible" || status === "partial";
}

export function fitBox(center, width, height, frame) {
  const w = Math.min(frame.width, Math.max(1, width));
  const h = Math.min(frame.height, Math.max(1, height));
  return [
    Math.max(0, Math.min(frame.width - w, center[0] - w / 2)),
    Math.max(0, Math.min(frame.height - h, center[1] - h / 2)),
    w,
    h,
  ].map((value) => Math.round(value * 10) / 10);
}

export function validateAnswer(answer, frame) {
  if (!answer || !STATUSES.includes(answer.status))
    throw new Error("Choose a visibility option.");
  const result = {
    status: answer.status,
    bbox: null,
    edgeClipped: false,
    reason: null,
  };
  if (needsBox(answer.status)) {
    const b = answer.bbox;
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every(Number.isFinite) ||
      b[0] < 0 ||
      b[1] < 0 ||
      b[2] < 1 ||
      b[3] < 1 ||
      b[0] + b[2] > frame.width + 0.11 ||
      b[1] + b[3] > frame.height + 0.11
    ) {
      throw new Error("Draw a box around the visible ball before saving.");
    }
    result.bbox = b.map((v) => Math.round(v * 10) / 10);
    result.edgeClipped = answer.edgeClipped === true;
  }
  if (answer.status === "not_visible") {
    if (!REASONS.includes(answer.reason))
      throw new Error("Choose why the ball isn't visible.");
    result.reason = answer.reason;
  }
  return result;
}

export function signature(answer) {
  return JSON.stringify([
    answer.status,
    answer.bbox,
    answer.edgeClipped,
    answer.reason,
  ]);
}

export function validateSubmission(raw, batch) {
  if (
    !raw ||
    raw.schema !== SCHEMA ||
    raw.batchId !== batch.id ||
    typeof raw.reviewerId !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(raw.reviewerId) ||
    typeof raw.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.exportedAt)) ||
    !raw.answers ||
    typeof raw.answers !== "object" ||
    Array.isArray(raw.answers)
  ) {
    throw new Error("This file is not a results file for this batch.");
  }
  const frames = new Map(batch.frames.map((f) => [f.id, f]));
  const answers = {};
  for (const [id, answer] of Object.entries(raw.answers)) {
    if (!frames.has(id))
      throw new Error("The results contain an unknown frame.");
    answers[id] = validateAnswer(answer, frames.get(id));
  }
  return {
    schema: SCHEMA,
    batchId: batch.id,
    reviewerId: raw.reviewerId,
    annotator: String(raw.annotator || "Unnamed reviewer").slice(0, 50),
    exportedAt: raw.exportedAt,
    answers,
  };
}

export function collectOptions(frame, submissions) {
  const unique = new Map();
  for (const submission of submissions) {
    const answer = submission.answers[frame.id];
    if (!answer) continue;
    const key = signature(answer);
    if (!unique.has(key)) unique.set(key, { key, answer, reviewers: [] });
    unique.get(key).reviewers.push(submission.annotator);
  }
  return [...unique.values()];
}

export function toCoco(batch, submissions, choices = {}) {
  const images = [],
    annotations = [],
    decisions = [];
  let unresolved = 0,
    excluded = 0;
  for (const frame of batch.frames) {
    const options = collectOptions(frame, submissions);
    if (!options.length) continue;
    let option = options[0];
    if (options.length > 1) {
      option = options.find((o) => o.key === choices[frame.id]);
      if (!option) {
        unresolved++;
        continue;
      }
    }
    const answer = option.answer;
    decisions.push({
      frameId: frame.id,
      ...answer,
      reviewers: option.reviewers,
    });
    const background =
      answer.status === "not_visible" && answer.reason === "outside_frame";
    if (!needsBox(answer.status) && !background) {
      excluded++;
      continue;
    }
    const imageId = images.length + 1;
    images.push({
      id: imageId,
      file_name: frame.image,
      width: frame.width,
      height: frame.height,
      source_clip: frame.source,
      source_frame: frame.frameIndex,
      timestamp_sec: frame.timestampSec,
      match_group: frame.matchGroup,
    });
    if (!background) {
      const bbox = answer.bbox;
      annotations.push({
        id: annotations.length + 1,
        image_id: imageId,
        category_id: 1,
        bbox,
        area: Math.round(bbox[2] * bbox[3] * 100) / 100,
        iscrowd: 0,
        attributes: {
          occluded: answer.status === "partial",
          truncated: answer.edgeClipped,
          bbox_extent: "visible",
        },
      });
    }
  }
  return {
    info: {
      description: "PitchCam reviewed match ball labels",
      batch_id: batch.id,
      coordinate_convention: "source image pixels, [x, y, width, height]",
      unresolved_frames: unresolved,
      excluded_frames: excluded,
    },
    categories: [{ id: 1, name: "ball" }],
    images,
    annotations,
    review_decisions: decisions,
  };
}
