import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import worker from "../worker/index.mjs";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of fs
    .readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(fs.readFileSync("drizzle/" + file, "utf8"));
  const objects = new Map();
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) };
        },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements) {
      if (DB.beforeBatch) {
        const hook = DB.beforeBatch;
        DB.beforeBatch = null;
        hook();
      }
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const BUCKET = {
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes: bytes.slice(), ...options });
    },
    async head(key) {
      const item = objects.get(key);
      return item
        ? { size: item.bytes.length, customMetadata: item.customMetadata }
        : null;
    },
    async get(key) {
      const item = objects.get(key);
      return item ? { body: new Blob([item.bytes]).stream(), ...item } : null;
    },
  };
  const env = { DB, BUCKET, APP_SECRET: "a-private-test-secret" };
  const background = [];
  async function call(path, { cookie, body, method = "GET", bytes } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let payload;
    if (bytes) {
      payload = bytes;
      headers["content-type"] = "image/jpeg";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    const response = await worker.fetch(
      new Request("https://test.local" + path, {
        method,
        headers,
        body: payload,
      }),
      env,
      { waitUntil: (promise) => background.push(promise) },
    );
    const data = () => response.json();
    return {
      response,
      data,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  return { call, sqlite, objects, background, DB };
}
async function owner(f) {
  const r = await f.call("/api/owner/session", {
    method: "POST",
    body: { key: "a-private-test-secret" },
  });
  assert.equal(r.response.status, 200);
  return r.cookie;
}
async function reviewer(f, admin, name) {
  const created = await f.call("/api/admin/members", {
    method: "POST",
    cookie: admin,
    body: { name },
  });
  const member = await created.data();
  const signed = await f.call("/api/login", {
    method: "POST",
    body: { code: member.code },
  });
  assert.equal(signed.response.status, 200);
  return { ...member, cookie: signed.cookie };
}
async function clip(f, admin, count = 42) {
  const result = await f.call("/api/admin/clips", {
    method: "POST",
    cookie: admin,
    body: {
      title: "match.mp4",
      project: "Pilot",
      matchGroup: "match-1",
      fingerprint: "fingerprint-" + count,
      duration: 100,
      interval: 2,
      expectedFrames: count,
    },
  });
  const { clip } = await result.data();
  for (let seq = 0; seq < count; seq++) {
    for (const kind of ["image", "before", "after"])
      await f.call("/api/admin/assets/" + clip.id + "/" + seq + "/" + kind, {
        method: "PUT",
        cookie: admin,
        bytes: new Uint8Array([255, 216, 0, 255, 217]),
      });
    const registered = await f.call("/api/admin/clips/" + clip.id + "/frames", {
      method: "POST",
      cookie: admin,
      body: {
        seq,
        time: seq * 2,
        width: 1280,
        height: 720,
        proposal: { bbox: [20, 20, 6, 6], confidence: 0.8 },
        modelName: "YOLOX-S pretrained",
        modelHash: "a".repeat(64),
      },
    });
    assert.equal(registered.response.status, 201);
  }
  const published = await f.call("/api/admin/clips/" + clip.id + "/publish", {
    method: "POST",
    cookie: admin,
  });
  assert.equal(published.response.status, 200);
  return clip;
}

test("anonymous visitors cannot read clips, model, media, reviews, export or work", async () => {
  const f = fixture(),
    admin = await owner(f),
    source = await clip(f, admin, 1);
  for (const path of [
    "/api/admin/dashboard",
    "/api/admin/reviews",
    "/api/admin/model",
    "/api/admin/export",
    "/media/" + source.id + "-0/image",
    "/media/" + source.id + "-0/thumb",
  ]) {
    assert.equal((await f.call(path)).response.status, 401, path);
  }
  assert.equal(
    (await f.call("/api/work", { method: "POST" })).response.status,
    401,
  );
  assert.equal((await f.call("/")).response.status, 200);
  assert.equal(
    (await f.call("/api/admin/dashboard", { cookie: "pc_session=fake" }))
      .response.status,
    401,
  );
});

test("different codes claim distinct work, and repeat claims keep the same batch", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin);
  const a = await reviewer(f, admin, "Alex"),
    b = await reviewer(f, admin, "Bea");
  const [ra, rb] = await Promise.all([
    f.call("/api/work", { method: "POST", cookie: a.cookie }),
    f.call("/api/work", { method: "POST", cookie: b.cookie }),
  ]);
  const aa = (await ra.data()).batch.frames,
    bb = (await rb.data()).batch.frames;
  assert.equal(aa.length, 20);
  assert.equal(bb.length, 20);
  assert.equal(new Set([...aa, ...bb].map((row) => row.id)).size, 40);
  const again = (
    await (
      await f.call("/api/work", { method: "POST", cookie: a.cookie })
    ).data()
  ).batch.frames;
  assert.deepEqual(
    again.map((r) => r.id),
    aa.map((r) => r.id),
  );
  assert.equal(
    (await f.call(bb[0].image, { cookie: a.cookie })).response.status,
    403,
  );
  assert.equal(
    (await f.call("/api/admin/dashboard", { cookie: a.cookie })).response
      .status,
    403,
  );
});

test("saves are idempotent, and concurrent stale edits cannot overwrite a label", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin, 1);
  const a = await reviewer(f, admin, "Alex");
  const frame = (
    await (
      await f.call("/api/work", { method: "POST", cookie: a.cookie })
    ).data()
  ).batch.frames[0];
  const data = {
    version: 0,
    operationId: crypto.randomUUID(),
    answer: { status: "visible", bbox: [30, 30, 7, 7] },
  };
  const save = () =>
    f.call("/api/labels/" + frame.id, {
      method: "PUT",
      cookie: a.cookie,
      body: data,
    });
  assert.equal((await save()).response.status, 200);
  assert.equal((await save()).response.status, 200);
  const stale = {
    ...data,
    operationId: crypto.randomUUID(),
    answer: { status: "visible", bbox: [100, 100, 6, 6] },
  };
  assert.equal(
    (
      await f.call("/api/labels/" + frame.id, {
        method: "PUT",
        cookie: a.cookie,
        body: stale,
      })
    ).response.status,
    409,
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM revisions").get().n,
    1,
  );
  assert.equal(
    JSON.parse(f.sqlite.prepare("SELECT answer FROM labels").get().answer)
      .bbox[0],
    30,
  );
});

test("released work rejects an old reviewer's save and can be assigned to another", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin, 1);
  const a = await reviewer(f, admin, "Alex"),
    b = await reviewer(f, admin, "Bea");
  const frame = (
    await (
      await f.call("/api/work", { method: "POST", cookie: a.cookie })
    ).data()
  ).batch.frames[0];
  await f.call("/api/admin/members/" + a.id + "/release", {
    method: "POST",
    cookie: admin,
  });
  const next = (
    await (
      await f.call("/api/work", { method: "POST", cookie: b.cookie })
    ).data()
  ).batch.frames[0];
  assert.equal(next.id, frame.id);
  assert.equal(next.version, 1);
  assert.equal(
    (
      await f.call("/api/labels/" + frame.id, {
        method: "PUT",
        cookie: a.cookie,
        body: {
          version: 0,
          operationId: crypto.randomUUID(),
          answer: { status: "unsure" },
        },
      })
    ).response.status,
    409,
  );
});

test("training ZIP retains proposals, model hashes and revisions while excluding hidden balls", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin, 3);
  const a = await reviewer(f, admin, "Alex");
  const frames = (
    await (
      await f.call("/api/work", { method: "POST", cookie: a.cookie })
    ).data()
  ).batch.frames;
  const frame = frames[0];
  await f.call("/api/labels/" + frame.id, {
    method: "PUT",
    cookie: a.cookie,
    body: {
      version: 0,
      operationId: crypto.randomUUID(),
      answer: { status: "partial", bbox: [25, 25, 5, 4] },
    },
  });
  const organiserReview = await f.call("/api/admin/review/" + frame.id, {
    cookie: admin,
  });
  assert.deepEqual(
    (await organiserReview.data()).batch.frames[0].answer.bbox,
    [25, 25, 5, 4],
  );
  assert.equal(
    (await f.call("/api/admin/review/" + frame.id, { cookie: a.cookie }))
      .response.status,
    403,
  );
  await f.call("/api/labels/" + frame.id, {
    method: "PUT",
    cookie: admin,
    body: {
      version: 1,
      operationId: crypto.randomUUID(),
      answer: { status: "partial", bbox: [26, 25, 5, 4] },
    },
  });
  for (let i = 1; i <= 2; i++) {
    await f.call("/api/labels/" + frames[i].id, {
      method: "PUT",
      cookie: a.cookie,
      body: {
        version: 0,
        operationId: crypto.randomUUID(),
        answer: {
          status: "not_visible",
          reason: i === 1 ? "outside_frame" : "hidden",
        },
      },
    });
  }
  const result = await f.call("/api/admin/export", { cookie: admin });
  assert.equal(result.response.status, 200);
  const archive = unzipSync(
    new Uint8Array(await result.response.arrayBuffer()),
  );
  const coco = JSON.parse(strFromU8(archive["annotations.json"]));
  const reviews = JSON.parse(strFromU8(archive["reviews.json"]));
  const history = JSON.parse(strFromU8(archive["label-history.json"]));
  assert.equal(coco.images.length, 2);
  assert.equal(coco.annotations.length, 1);
  assert.equal(reviews.length, 3);
  assert.equal(history.length, 4);
  assert.equal(history[0].frame_id, frame.id);
  assert.deepEqual(history[0].answer.bbox, [25, 25, 5, 4]);
  assert.deepEqual(coco.annotations[0].bbox, [26, 25, 5, 4]);
  assert.equal(coco.images[0].match_group, "match-1");
  assert.deepEqual(reviews[0].ai.bbox, [20, 20, 6, 6]);
  assert.deepEqual(reviews[0].human.bbox, [26, 25, 5, 4]);
  assert.equal(reviews[0].reviewer, "Organiser");
  assert.equal(reviews[0].modelHash, "a".repeat(64));
  assert.ok(archive[coco.images[0].file_name]);
  await Promise.all(f.background);
});

test("signing out revokes the old session on the server", async () => {
  const f = fixture(),
    admin = await owner(f);
  assert.equal(
    (await f.call("/api/logout", { method: "POST", cookie: admin })).response
      .status,
    200,
  );
  assert.equal(
    (await f.call("/api/admin/dashboard", { cookie: admin })).response.status,
    401,
  );
});

test("wrong PIN attempts are throttled and revoked access loses its session", async () => {
  const f = fixture(),
    admin = await owner(f),
    a = await reviewer(f, admin, "Alex");
  await f.call("/api/admin/members/" + a.id + "/active", {
    method: "POST",
    cookie: admin,
    body: { active: false },
  });
  assert.equal(
    (await f.call("/api/me", { cookie: a.cookie })).response.status,
    401,
  );
  let response;
  for (let i = 0; i < 16; i++)
    response = await f.call("/api/login", {
      method: "POST",
      body: { code: "not-a-code" },
    });
  assert.equal(response.response.status, 429);
});

async function assigned(f, member) {
  return (
    await (
      await f.call("/api/work", { method: "POST", cookie: member.cookie })
    ).data()
  ).batch.frames;
}
function runRequest(frames, reason = "outside_frame") {
  return {
    reason,
    frames: frames.map((frame) => ({
      id: frame.id,
      version: frame.version,
      operationId: crypto.randomUUID(),
    })),
  };
}
const putRun = (f, member, data) =>
  f.call("/api/labels/bulk", {
    method: "PUT",
    cookie: member.cookie,
    body: data,
  });

test("a 20-frame absence run saves once, retains AI proposals, and releases the next batch", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin);
  const member = await reviewer(f, admin, "Alex");
  const frames = await assigned(f, member);
  const request = runRequest(frames);
  const result = await putRun(f, member, request);
  assert.equal(
    result.response.status,
    200,
    JSON.stringify(await result.data()),
  );
  assert.equal(
    f.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM frames WHERE state='done' AND version=1",
      )
      .get().n,
    20,
  );
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM revisions").get().n,
    20,
  );
  const labels = f.sqlite
    .prepare("SELECT answer FROM labels")
    .all()
    .map((r) => JSON.parse(r.answer));
  assert.ok(
    labels.every(
      (a) =>
        a.status === "not_visible" &&
        a.reason === "outside_frame" &&
        a.bbox === null,
    ),
  );
  assert.equal(
    f.sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM frames WHERE state='done' AND proposal!='null'",
      )
      .get().n,
    20,
  );
  assert.equal((await putRun(f, member, request)).response.status, 200);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM revisions").get().n,
    20,
  );
  assert.equal(
    (await putRun(f, member, { ...request, reason: "unknown" })).response
      .status,
    409,
  );
  const next = await assigned(f, member);
  assert.equal(next.length, 20);
  assert.ok(next.every((n) => frames.every((old) => old.id !== n.id)));
});

test("bulk marking preserves reviewed balls and refuses stale versions or another reviewer’s frames", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin);
  const a = await reviewer(f, admin, "Alex"),
    b = await reviewer(f, admin, "Bea");
  const aa = await assigned(f, a),
    bb = await assigned(f, b);
  assert.equal(
    (await putRun(f, a, runRequest([aa[0], bb[0]]))).response.status,
    409,
  );
  assert.equal(
    (await putRun(f, a, runRequest([{ ...aa[0], version: 99 }, aa[1]])))
      .response.status,
    409,
  );
  await f.call("/api/labels/" + aa[0].id, {
    method: "PUT",
    cookie: a.cookie,
    body: {
      version: 0,
      operationId: crypto.randomUUID(),
      answer: { status: "visible", bbox: [100, 100, 8, 8] },
    },
  });
  assert.equal(
    (await putRun(f, a, runRequest(aa.slice(0, 2)))).response.status,
    409,
  );
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM labels").get().n, 1);
  assert.deepEqual(
    JSON.parse(f.sqlite.prepare("SELECT answer FROM labels").get().answer).bbox,
    [100, 100, 8, 8],
  );
});

test("a reassignment between preview and commit cancels the entire absence run", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin, 3);
  const a = await reviewer(f, admin, "Alex");
  const frames = await assigned(f, a);
  f.DB.beforeBatch = () =>
    f.sqlite
      .prepare(
        "UPDATE frames SET assignee=NULL,state='pending',version=version+1 WHERE id=?",
      )
      .run(frames[1].id);
  assert.equal((await putRun(f, a, runRequest(frames))).response.status, 409);
  assert.equal(
    f.sqlite
      .prepare("SELECT COUNT(*) AS n FROM frames WHERE state='done'")
      .get().n,
    0,
  );
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM labels").get().n, 0);
  assert.equal(
    f.sqlite.prepare("SELECT COUNT(*) AS n FROM revisions").get().n,
    0,
  );
});

test("bulk unknown and hidden answers stay out of training negatives", async () => {
  const f = fixture(),
    admin = await owner(f);
  await clip(f, admin, 6);
  const a = await reviewer(f, admin, "Alex"),
    frames = await assigned(f, a);
  for (const [start, reason] of [
    [0, "unknown"],
    [2, "hidden"],
    [4, "outside_frame"],
  ])
    assert.equal(
      (await putRun(f, a, runRequest(frames.slice(start, start + 2), reason)))
        .response.status,
      200,
    );
  const result = await f.call("/api/admin/export", { cookie: admin });
  const zip = unzipSync(new Uint8Array(await result.response.arrayBuffer()));
  const coco = JSON.parse(strFromU8(zip["annotations.json"]));
  const reviews = JSON.parse(strFromU8(zip["reviews.json"]));
  assert.equal(coco.images.length, 2);
  assert.equal(coco.annotations.length, 0);
  assert.equal(reviews.length, 6);
  await Promise.all(f.background);
});

test("bulk requests enforce sign-in, size, clip boundaries and valid reasons", async () => {
  const f = fixture(),
    admin = await owner(f);
  assert.equal(
    (
      await f.call("/api/labels/bulk", {
        method: "PUT",
        body: { reason: "unknown", frames: [] },
      })
    ).response.status,
    401,
  );
  await clip(f, admin, 1);
  await clip(f, admin, 2);
  const a = await reviewer(f, admin, "Alex"),
    frames = await assigned(f, a);
  assert.equal(frames.length, 3);
  assert.equal((await putRun(f, a, runRequest(frames))).response.status, 400);
  assert.equal(
    (await putRun(f, a, runRequest([frames[0], frames[0]]))).response.status,
    400,
  );
  assert.equal(
    (
      await putRun(f, a, {
        reason: "not sure",
        frames: runRequest([frames[0]]).frames,
      })
    ).response.status,
    400,
  );
  assert.equal(
    (await putRun(f, a, runRequest(new Array(21).fill(frames[0])))).response
      .status,
    400,
  );
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM labels").get().n, 0);
});

test("thumbnails retain assignment protection and older clips fall back to their original image", async () => {
  const f = fixture(),
    admin = await owner(f);
  const source = await clip(f, admin, 1);
  const a = await reviewer(f, admin, "Alex"),
    b = await reviewer(f, admin, "Bea");
  const frame = (await assigned(f, a))[0];
  assert.ok(frame.thumbnail.endsWith("/thumb"));
  const fallback = await f.call(frame.thumbnail, { cookie: a.cookie });
  assert.equal(fallback.response.status, 200);
  assert.deepEqual(
    new Uint8Array(await fallback.response.arrayBuffer()),
    new Uint8Array([255, 216, 0, 255, 217]),
  );
  const small = new Uint8Array([255, 216, 1, 255, 217]);
  f.objects.set("clips/" + source.id + "/0/thumb.jpg", { bytes: small });
  const thumb = await f.call(frame.thumbnail, { cookie: a.cookie });
  assert.deepEqual(new Uint8Array(await thumb.response.arrayBuffer()), small);
  assert.equal(
    (await f.call(frame.thumbnail, { cookie: b.cookie })).response.status,
    403,
  );
  assert.equal((await f.call(frame.thumbnail)).response.status, 401);
});
