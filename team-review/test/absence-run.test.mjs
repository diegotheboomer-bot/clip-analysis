import { test } from "node:test";
import assert from "node:assert/strict";
import { runCandidates, rangeSelection } from "../public/absence-run.mjs";

test("a run stops at a clip boundary, even when clips share a filename", () => {
  const frames = [0, 1, 2, 3].map((id) => ({
    id: String(id),
    source: "match.mp4",
    clipId: id < 2 ? "clip-a" : "clip-b",
  }));
  assert.deepEqual(
    runCandidates(frames, 0).map((f) => f.frame.id),
    ["0", "1"],
  );
  assert.deepEqual(
    runCandidates(frames, 2).map((f) => f.frame.id),
    ["2", "3"],
  );
});

test("range marking keeps previously reviewed boxes and respects the tapped last frame", () => {
  const frames = [0, 1, 2, 3].map((id) => ({
    id: String(id),
    source: "match.mp4",
    reviewed: id === 1,
  }));
  const candidates = runCandidates(frames, 0);
  assert.deepEqual(
    rangeSelection(candidates, 2, {
      2: { status: "visible", bbox: [1, 1, 2, 2] },
    }).map((f) => f.frame.id),
    ["0"],
  );
  assert.deepEqual(
    rangeSelection(candidates, 3, {}).map((f) => f.frame.id),
    ["0", "2", "3"],
  );
});

test("legacy source-based ranges stay bounded to 20 frames", () => {
  const frames = Array.from({ length: 50 }, (_, id) => ({
    id,
    source: "goal.mp4",
  }));
  assert.equal(runCandidates(frames, 0).length, 20);
  assert.equal(runCandidates(frames, 49).length, 1);
  assert.equal(runCandidates(frames, 50).length, 0);
});
