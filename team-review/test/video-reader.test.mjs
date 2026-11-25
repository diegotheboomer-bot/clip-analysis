import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VideoReader,
  VideoReadError,
  ImportPaused,
} from "../public/video-reader.mjs";
import { runImportQueue } from "../public/import-queue.mjs";
class Video extends EventTarget {
  constructor() {
    super();
    this.style = {};
    this.readyState = 0;
    this.currentTime = 0;
    this.duration = 5;
    this.videoWidth = 1280;
    this.videoHeight = 720;
    this.seeking = false;
    this.error = null;
  }
  setAttribute() {}
  pause() {}
  remove() {}
  removeAttribute() {
    this.src = "";
  }
  load() {
    this.readyState = this.src ? 1 : 0;
    this.currentTime = 0;
  }
}
function setup(t, paused = () => false) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const video = new Video(),
    page = new EventTarget();
  page.hidden = false;
  page.body = { append() {} };
  const revoked = [];
  const reader = new VideoReader({
    video,
    page,
    paused,
    timeoutMs: 1000,
    pollMs: 100,
    createURL: () => "blob:test",
    revokeURL: (u) => revoked.push(u),
  });
  return { video, page, reader, revoked };
}
test("metadata opens without loadeddata, then polling waits for a real frame", async (t) => {
  const { reader, video } = setup(t);
  await reader.open({});
  let done = false;
  const pending = reader.seek(0).then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  video.readyState = 2;
  t.mock.timers.tick(100);
  await pending;
  assert.equal(done, true);
  reader.close();
});
test("a missing seeked event does not time out a decoded frame, and tail seeks are padded", async (t) => {
  const { reader, video } = setup(t);
  await reader.open({});
  video.readyState = 2;
  assert.equal(await reader.seek(5), 4.88);
  reader.close();
});
test("decode timeout rejects rather than returning a stale frame", async (t) => {
  const { reader } = setup(t);
  await reader.open({});
  const p = reader.seek(1);
  const rejected = assert.rejects(p, VideoReadError);
  t.mock.timers.tick(1100);
  await rejected;
  reader.close();
});
test("hidden-tab time is excluded and a paused import releases the wait", async (t) => {
  let paused = false;
  const { reader, page } = setup(t, () => paused);
  await reader.open({});
  page.hidden = true;
  const p = reader.seek(1);
  const rejected = assert.rejects(p, ImportPaused);
  t.mock.timers.tick(10000);
  paused = true;
  t.mock.timers.tick(100);
  await rejected;
  reader.close();
});
test("a media failure retries once and later files still finish", async () => {
  const calls = [],
    files = [{ name: "a" }, { name: "bad" }, { name: "c" }];
  const result = await runImportQueue(files, {
    paused: () => false,
    onStatus() {},
    onProgress() {},
    processFile: async (file, index, attempt) => {
      calls.push([file.name, attempt]);
      if (file.name === "bad") throw new VideoReadError("cannot decode");
    },
  });
  assert.equal(result.completed, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].file.name, "bad");
  assert.deepEqual(calls, [
    ["a", 0],
    ["bad", 0],
    ["bad", 1],
    ["c", 0],
  ]);
});
test("retry resumes saved frame records without losing earlier clips", async () => {
  const saved = new Set(),
    files = [{ name: "first" }, { name: "second" }];
  let calls = 0;
  const r = await runImportQueue(files, {
    paused: () => false,
    onStatus() {},
    onProgress() {},
    processFile: async (file, i, attempt) => {
      if (i === 0) return;
      for (let seq = 0; seq < 3; seq++) {
        if (saved.has(seq)) continue;
        if (seq === 1 && attempt === 0) throw new VideoReadError("stall");
        saved.add(seq);
        calls++;
      }
    },
  });
  assert.equal(r.completed, 2);
  assert.equal(calls, 3);
  assert.equal(saved.size, 3);
  assert.equal(r.failed.length, 0);
});
test("expired organiser access stops the batch instead of misreporting media errors", async () => {
  await assert.rejects(
    runImportQueue([{ name: "a" }, { name: "b" }], {
      paused: () => false,
      onStatus() {},
      onProgress() {},
      processFile: async () => {
        throw Object.assign(new Error("sign in"), { status: 401 });
      },
    }),
    /sign in/,
  );
});
