import { test } from "node:test";
import assert from "node:assert/strict";
import { clampView, pointInView, zoomView } from "./gestures.mjs";

const image = { width: 1280, height: 720 };
const view = [0, 0, 1280, 720];

test("pinch zoom preserves the source point under the fingers", () => {
  const anchor = pointInView([0.4, 0.6], view);
  const zoomed = zoomView(view, anchor, [0.4, 0.6], 2, image);
  assert.deepEqual(pointInView([0.4, 0.6], zoomed), anchor);
  assert.deepEqual(zoomed.slice(2), [640, 360]);
});

test("two-finger panning moves the viewport without changing its size", () => {
  const initial = [320, 180, 640, 360];
  const anchor = pointInView([0.5, 0.5], initial);
  const moved = zoomView(initial, anchor, [0.6, 0.6], 1, image);
  assert.deepEqual(moved, [256, 144, 640, 360]);
});

test("zoom and pan are bounded by image edges", () => {
  assert.deepEqual(
    clampView([-100, 1000, 640, 360], image),
    [0, 360, 640, 360],
  );
  assert.deepEqual(zoomView(view, [640, 360], [0.5, 0.5], 0.01, image), view);
  assert.equal(zoomView(view, [640, 360], [0.5, 0.5], 1000, image)[2], 24);
});
