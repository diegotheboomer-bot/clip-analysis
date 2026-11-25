import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA,
  fitBox,
  validateAnswer,
  validateSubmission,
  collectOptions,
  toCoco,
} from "./core.mjs";

const frame = {
  id: "f1",
  image: "media/f1.jpg",
  width: 1280,
  height: 720,
  source: "match.mp4",
  frameIndex: 100,
  timestampSec: 4,
  matchGroup: "match-01",
};
const batch = { id: "b1", frames: [frame] };
const visible = {
  status: "partial",
  bbox: [120, 90, 8, 6],
  edgeClipped: false,
  reason: null,
};
const result = (answer) => ({
  schema: SCHEMA,
  batchId: "b1",
  reviewerId: "a1",
  annotator: "Alex",
  exportedAt: "2026-11-25T09:00:00Z",
  answers: { f1: answer },
});

test("source boxes stay inside image boundaries", () => {
  assert.deepEqual(fitBox([1280, 720], 8, 6, frame), [1272, 714, 8, 6]);
  assert.throws(() =>
    validateAnswer({ ...visible, bbox: [1279, 720, 8, 6] }, frame),
  );
  assert.throws(() =>
    validateAnswer({ ...visible, bbox: [1, 2, NaN, 4] }, frame),
  );
});

test("unseen and unsure labels cannot export an old box", () => {
  assert.equal(
    validateAnswer({ ...visible, status: "unsure" }, frame).bbox,
    null,
  );
  assert.throws(() => validateAnswer({ status: "not_visible" }, frame));
  for (const reason of ["hidden", "unknown"]) {
    const coco = toCoco(batch, [result({ status: "not_visible", reason })]);
    assert.equal(coco.images.length, 0);
  }
});

test("an actual outside-frame label exports a negative image", () => {
  const coco = toCoco(batch, [
    result({ status: "not_visible", reason: "outside_frame" }),
  ]);
  assert.equal(coco.images.length, 1);
  assert.equal(coco.annotations.length, 0);
});

test("partial ball export preserves source pixels and uncertainty attributes", () => {
  const coco = toCoco(batch, [result(visible)]);
  assert.deepEqual(coco.annotations[0].bbox, [120, 90, 8, 6]);
  assert.equal(coco.annotations[0].attributes.occluded, true);
  assert.equal(coco.images[0].match_group, "match-01");
});

test("wrong batches and unknown frames fail before import", () => {
  assert.throws(() =>
    validateSubmission({ ...result(visible), batchId: "other" }, batch),
  );
  assert.throws(() =>
    validateSubmission(
      { ...result(visible), answers: { missing: visible } },
      batch,
    ),
  );
  assert.equal(
    validateSubmission(result(visible), batch).answers.f1.status,
    "partial",
  );
});

test("conflicting reviewers require an explicit choice", () => {
  const reviews = [
    result(visible),
    { ...result({ status: "unsure" }), reviewerId: "b2" },
  ];
  assert.equal(toCoco(batch, reviews).info.unresolved_frames, 1);
  const key = collectOptions(frame, reviews)[0].key;
  const coco = toCoco(batch, reviews, { f1: key });
  assert.equal(coco.info.unresolved_frames, 0);
  assert.equal(coco.annotations.length, 1);
});
