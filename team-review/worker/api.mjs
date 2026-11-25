import { Zip, ZipPassThrough } from "fflate";
import { validateAnswer, needsBox, REASONS } from "./labels.mjs";
import assets from "../generated/assets.mjs";
import { reviewJobsRoute, reviewMediaAllowed, ensureReviewSchema } from './review-jobs.mjs';

const now = () => Math.floor(Date.now() / 1000);
const id = () => crypto.randomUUID();
const encoder = new TextEncoder();
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const text = (value, limit = 120) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const digest = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
async function codeHash(code, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(code)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function body(request) {
  if (Number(request.headers.get("content-length")) > 100_000)
    fail(413, "Request is too large.");
  const raw = await request.text();
  if (raw.length > 100_000) fail(413, "Request is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    fail(400, "Invalid JSON.");
  }
}
const stmt = (env, sql, ...values) => env.DB.prepare(sql).bind(...values);
const first = (env, sql, ...v) => stmt(env, sql, ...v).first();
const rows = async (env, sql, ...v) =>
  (await stmt(env, sql, ...v).all()).results;
async function session(request, env, owner = false) {
  const token = /(?:^|;\s*)pc_session=([a-zA-Z0-9-]+)/.exec(
    request.headers.get("cookie") || "",
  )?.[1];
  if (!token) fail(401, "Enter your code to continue.");
  const user = await first(
    env,
    `SELECT s.*,m.name,m.active FROM sessions s LEFT JOIN members m ON m.id=s.member_id WHERE token_hash=? AND expires_at>?`,
    await digest(token),
    now(),
  );
  if (!user || (user.role !== "owner" && !user.active))
    fail(401, "Your access has expired. Enter your code again.");
  if (owner && user.role !== "owner")
    fail(403, "Organiser access is required.");
  return user;
}
async function issueSession(env, role, memberId = null) {
  const token = id() + id();
  await stmt(
    env,
    "INSERT INTO sessions(token_hash,member_id,role,expires_at) VALUES(?,?,?,?)",
    await digest(token),
    memberId,
    role,
    now() + 7 * 86400,
  ).run();
  return {
    "Set-Cookie": `pc_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
  };
}
async function loginLimit(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const key = await digest(ip);
  const bucket = await stmt(
    env,
    `INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END,expires_at=CASE WHEN expires_at<? THEN ? ELSE expires_at END RETURNING attempts`,
    key,
    now() + 900,
    now(),
    now(),
    now() + 900,
  ).first();
  if (bucket.attempts > 15)
    fail(429, "Too many attempts. Please wait 15 minutes.");
}
async function newCode(env, memberId, name) {
  const resetting = Boolean(memberId);
  for (let tries = 0; tries < 12; tries++) {
    const code = String(
      crypto.getRandomValues(new Uint32Array(1))[0] % 10000,
    ).padStart(4, "0");
    const hash = await codeHash(code, env.APP_SECRET);
    if (await first(env, "SELECT id FROM members WHERE code_hash=?", hash))
      continue;
    try {
      if (resetting) {
        await env.DB.batch([
          stmt(
            env,
            "UPDATE members SET code_hash=? WHERE id=?",
            hash,
            memberId,
          ),
          stmt(env, "DELETE FROM sessions WHERE member_id=?", memberId),
        ]);
      } else {
        memberId = id();
        await stmt(
          env,
          "INSERT INTO members(id,name,code_hash,created_at) VALUES(?,?,?,?)",
          memberId,
          name,
          hash,
          now(),
        ).run();
      }
      return { id: memberId, code };
    } catch (e) {
      if (tries === 11) throw e;
    }
  }
  fail(409, "Could not allocate a code. Try again.");
}
const assetKey = (clip, seq, kind) => `clips/${clip}/${seq}/${kind}.jpg`;
function frameView(f) {
  return {
    id: f.id,
    clipId: f.clip_id,
    source: f.title,
    matchGroup: f.match_group,
    frameIndex: null,
    timestampSec: f.timestamp_sec,
    width: f.width,
    height: f.height,
    version: f.version,
    image: `/media/${f.id}/image`,
    thumbnail: `/media/${f.id}/thumb`,
    before: `/media/${f.id}/before`,
    after: `/media/${f.id}/after`,
    proposal: JSON.parse(f.proposal),
    modelName: f.model_name,
    modelHash: f.model_hash,
  };
}
async function claim(env, user) {
  await stmt(
    env,
    `UPDATE frames SET assignee=?,state='assigned',assigned_at=? WHERE id IN (
    SELECT f.id FROM frames f JOIN clips c ON c.id=f.clip_id WHERE f.state='pending'
    AND f.assignee IS NULL AND c.status='ready' AND NOT EXISTS(SELECT 1 FROM review_items ri WHERE ri.frame_id=f.id AND ri.kind='ball') ORDER BY c.created_at,f.seq LIMIT 20
  ) AND NOT EXISTS(SELECT 1 FROM frames WHERE assignee=? AND state='assigned')`,
    user.member_id,
    now(),
    user.member_id,
  ).run();
  const assigned = await rows(
    env,
    `SELECT f.*,c.title,c.match_group FROM frames f JOIN clips c ON c.id=f.clip_id WHERE assignee=? AND state='assigned' ORDER BY assigned_at,c.created_at,f.seq`,
    user.member_id,
  );
  const progress = await first(
    env,
    "SELECT COUNT(*) AS total,SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS done FROM frames WHERE assignee=?",
    user.member_id,
  );
  return {
    batch: {
      id: "team-" + user.member_id + "-" + (assigned[0]?.id || "empty"),
      version: 1,
      title: "Your assigned frames",
      frames: assigned.map(frameView),
    },
    progress,
  };
}
async function saveLabel(env, frameId, user, data) {
  const f = await first(env, "SELECT * FROM frames WHERE id=?", frameId);
  if (!f) fail(404, "Frame not found.");
  const owner = user.role === "owner";
  if (!owner && f.assignee !== user.member_id)
    fail(409, "This frame has been reassigned. Load your next batch.");
  let answer;
  try {
    answer = validateAnswer(data.answer, f);
  } catch (e) {
    fail(400, e.message);
  }
  const answerJson = JSON.stringify(answer);
  const operation = text(data.operationId, 80);
  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(operation) ||
    !Number.isInteger(data.version)
  )
    fail(400, "Invalid save operation.");
  if (f.last_operation === operation) {
    const prior = await first(
      env,
      "SELECT answer FROM labels WHERE frame_id=?",
      frameId,
    );
    if (prior?.answer !== answerJson)
      fail(409, "This save identifier has already been used.");
    return { version: f.version, saved: true };
  }
  const reviewer = owner ? null : user.member_id;
  const result = await env.DB.batch([
    stmt(
      env,
      "UPDATE frames SET state='done',version=version+1,last_operation=? WHERE id=? AND version=? AND (assignee=? OR ?=1)",
      operation,
      frameId,
      data.version,
      user.member_id,
      owner ? 1 : 0,
    ),
    stmt(
      env,
      `INSERT INTO labels(frame_id,reviewer_id,answer,updated_at) SELECT id,?,?,? FROM frames WHERE id=? AND last_operation=?
      ON CONFLICT(frame_id) DO UPDATE SET answer=excluded.answer,reviewer_id=excluded.reviewer_id,updated_at=excluded.updated_at`,
      reviewer,
      answerJson,
      now(),
      frameId,
      operation,
    ),
    stmt(
      env,
      "INSERT INTO revisions(operation_id,frame_id,reviewer_id,answer,created_at) SELECT ?,id,?,?,? FROM frames WHERE id=? AND last_operation=?",
      operation,
      reviewer,
      answerJson,
      now(),
      frameId,
      operation,
    ),
  ]);
  if (!result[0].meta.changes)
    fail(409, "A newer label is saved for this frame. Reload before editing.");
  return { saved: true, version: data.version + 1 };
}
async function saveAbsenceRun(env, user, data) {
  if (user.role !== "reviewer")
    fail(403, "Use a reviewer's code to mark a run.");
  if (
    !REASONS.includes(data.reason) ||
    !Array.isArray(data.frames) ||
    data.frames.length < 1 ||
    data.frames.length > 20
  )
    fail(400, "Choose a reason and between 1 and 20 assigned frames.");
  const targets = data.frames.map((f) => ({
    id: f.id,
    version: f.version,
    operationId: f.operationId,
  }));
  if (
    targets.some(
      (f) =>
        !/^[a-zA-Z0-9-]{1,90}$/.test(f.id || "") ||
        !Number.isInteger(f.version) ||
        f.version < 0 ||
        !/^[a-zA-Z0-9-]{16,80}$/.test(f.operationId || ""),
    ) ||
    new Set(targets.map((f) => f.id)).size !== targets.length ||
    new Set(targets.map((f) => f.operationId)).size !== targets.length
  )
    fail(400, "Invalid frame selection.");
  const answer = validateAnswer(
    { status: "not_visible", reason: data.reason },
    {},
  );
  const answerJson = JSON.stringify(answer),
    payload = JSON.stringify(targets),
    count = targets.length;
  const snapshot = () =>
    rows(
      env,
      `SELECT f.*,l.answer AS saved_answer FROM frames f LEFT JOIN labels l ON l.frame_id=f.id
    WHERE f.id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,
      payload,
    );
  let frames = await snapshot();
  const allowed =
    frames.length === count &&
    frames.every((f) => f.assignee === user.member_id);
  if (!allowed)
    fail(409, "These frames are no longer assigned to you. Reload your work.");
  const byId = new Map(frames.map((f) => [f.id, f]));
  const complete = () =>
    targets.every((t) => {
      const f = byId.get(t.id);
      return (
        f?.last_operation === t.operationId &&
        f.state === "done" &&
        f.saved_answer === answerJson
      );
    });
  const result = () => ({
    saved: true,
    frames: targets.map((t) => ({ id: t.id, version: byId.get(t.id).version })),
  });
  if (complete()) return result();
  const clip = frames[0].clip_id;
  if (frames.some((f) => f.clip_id !== clip))
    fail(400, "Choose frames from one clip at a time.");
  if (
    targets.some(
      (t) =>
        byId.get(t.id).state !== "assigned" ||
        byId.get(t.id).version !== t.version,
    )
  )
    fail(
      409,
      "A frame was already reviewed or changed. Reload the selection; nothing was marked.",
    );
  // All selected versions must still match at write time. D1 executes this
  // batch in one transaction. changes() gates the dependent label/history
  // writes, so a failed group guard cannot produce a partial run.
  const written = await env.DB.batch([
    stmt(
      env,
      `WITH targets AS MATERIALIZED (
        SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.version') AS version,json_extract(value,'$.operationId') AS operation
        FROM json_each(?)
      ), eligible AS MATERIALIZED (
        SELECT f.id FROM frames f JOIN targets t ON t.id=f.id
        WHERE f.assignee=? AND f.clip_id=? AND f.state='assigned' AND f.version=t.version
      ), gate AS MATERIALIZED (SELECT COUNT(*) AS n FROM eligible)
      UPDATE frames SET state='done',version=version+1,last_operation=(SELECT t.operation FROM targets t WHERE t.id=frames.id)
      WHERE id IN (SELECT id FROM eligible) AND (SELECT n FROM gate)=?`,
      payload,
      user.member_id,
      clip,
      count,
    ),
    stmt(
      env,
      `INSERT INTO labels(frame_id,reviewer_id,answer,updated_at)
      SELECT f.id,?,?,? FROM frames f JOIN json_each(?) t ON f.id=json_extract(t.value,'$.id')
      WHERE changes()=? AND f.last_operation=json_extract(t.value,'$.operationId')
      ON CONFLICT(frame_id) DO UPDATE SET answer=excluded.answer,reviewer_id=excluded.reviewer_id,updated_at=excluded.updated_at`,
      user.member_id,
      answerJson,
      now(),
      payload,
      count,
    ),
    stmt(
      env,
      `INSERT INTO revisions(operation_id,frame_id,reviewer_id,answer,created_at)
      SELECT json_extract(t.value,'$.operationId'),f.id,?,?,? FROM frames f JOIN json_each(?) t ON f.id=json_extract(t.value,'$.id')
      WHERE changes()=? AND f.last_operation=json_extract(t.value,'$.operationId')`,
      user.member_id,
      answerJson,
      now(),
      payload,
      count,
    ),
  ]);
  frames = await snapshot();
  byId.clear();
  for (const f of frames) byId.set(f.id, f);
  if (!written[0].meta.changes && !complete())
    fail(
      409,
      "Your selection changed before saving. Nothing was marked. Reload your work.",
    );
  return result();
}

function validProposal(value, f) {
  if (value === null || value === undefined) return null;
  let clean;
  try {
    clean = validateAnswer({ status: "visible", bbox: value.bbox }, f);
  } catch (error) {
    fail(400, error.message);
  }
  if (
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  )
    fail(400, "Invalid AI confidence.");
  return { bbox: clean.bbox, confidence: value.confidence };
}
async function downloadDataset(env, ctx) {
  const all = await rows(
    env,
    `SELECT f.*,c.title,c.match_group,l.answer,l.reviewer_id,m.name AS reviewer_name
    FROM frames f JOIN clips c ON c.id=f.clip_id JOIN labels l ON l.frame_id=f.id
    LEFT JOIN members m ON m.id=l.reviewer_id WHERE f.state='done' ORDER BY c.created_at,f.seq`,
  );
  const images = [],
    annotations = [],
    reviews = [];
  for (const f of all) {
    const answer = JSON.parse(f.answer);
    reviews.push({
      frameId: f.id,
      clip: f.title,
      time: f.timestamp_sec,
      matchGroup: f.match_group,
      ai: JSON.parse(f.proposal),
      model: f.model_name,
      modelHash: f.model_hash,
      human: answer,
      reviewer: f.reviewer_name || "Organiser",
    });
    const negative =
      answer.status === "not_visible" && answer.reason === "outside_frame";
    if (!needsBox(answer.status) && !negative) continue;
    images.push({
      id: images.length + 1,
      file_name: "images/" + f.id + ".jpg",
      width: f.width,
      height: f.height,
      source_clip: f.title,
      timestamp_sec: f.timestamp_sec,
      match_group: f.match_group,
      storageKey: assetKey(f.clip_id, f.seq, "image"),
    });
    if (!negative)
      annotations.push({
        id: annotations.length + 1,
        image_id: images.length,
        category_id: 1,
        bbox: answer.bbox,
        area: answer.bbox[2] * answer.bbox[3],
        iscrowd: 0,
        attributes: {
          occluded: answer.status === "partial",
          truncated: answer.edgeClipped,
          bbox_extent: "visible",
          model: f.model_name,
          modelHash: f.model_hash,
        },
      });
  }
  const coco = {
    categories: [{ id: 1, name: "ball" }],
    images: images.map(({ storageKey, ...rest }) => rest),
    annotations,
  };
  const history = await rows(
    env,
    "SELECT operation_id,frame_id,reviewer_id,answer,created_at FROM revisions ORDER BY created_at",
  );
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const task = (async () => {
    let pending = Promise.resolve();
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        pending = pending.then(() => writer.abort(err));
        return;
      }
      pending = pending.then(() => writer.write(chunk));
      if (final) pending = pending.then(() => writer.close());
    });
    async function entry(name, bytes) {
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
      await pending;
    }
    await entry("annotations.json", encoder.encode(JSON.stringify(coco)));
    await entry("reviews.json", encoder.encode(JSON.stringify(reviews)));
    await entry(
      "label-history.json",
      encoder.encode(
        JSON.stringify(
          history.map((r) => ({ ...r, answer: JSON.parse(r.answer) })),
        ),
      ),
    );
    for (const name of ["prepare_dataset.py", "README.md"])
      await entry(
        "training/" + name,
        encoder.encode(assets["/training/" + name]),
      );
    await entry(
      "README.txt",
      encoder.encode(
        "PitchCam human-reviewed labels. COCO boxes use original pixels and visible extents. Unknown/hidden frames are excluded from training. Keep whole match groups together in training/evaluation splits. reviews.json retains AI proposals and human answers. label-history.json retains saved revisions. See training/README.md and training/prepare_dataset.py for Windows/Linux dataset preparation.",
      ),
    );
    for (const image of images) {
      const object = await env.BUCKET.get(image.storageKey);
      if (!object) throw new Error("An exported image is missing.");
      const file = new ZipPassThrough(image.file_name);
      zip.add(file);
      const reader = object.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        file.push(value);
        await pending;
      }
      file.push(new Uint8Array(), true);
      await pending;
    }
    zip.end();
    await pending;
  })().catch((e) => writer.abort(e));
  ctx.waitUntil(task);
  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="pitchcam-training.zip"',
      "Cache-Control": "no-store",
    },
  });
}

export async function api(request, env, ctx) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (
    method !== "GET" &&
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    fail(403, "Open this tool directly to make changes.");
  if (path === "/api/health") return json({ ok: true, version: "team-1" });
  if (path === "/api/login" && method === "POST") {
    await loginLimit(request, env);
    const data = await body(request);
    if (!/^\d{4}$/.test(data.code)) fail(401, "Enter your four-digit code.");
    const member = await first(
      env,
      "SELECT * FROM members WHERE code_hash=? AND active=1",
      await codeHash(data.code, env.APP_SECRET),
    );
    if (!member) fail(401, "That code isn't active. Check with the organiser.");
    await stmt(
      env,
      "DELETE FROM login_attempts WHERE key=?",
      await digest(request.headers.get("cf-connecting-ip") || "unknown"),
    ).run();
    return json(
      { name: member.name, role: "reviewer" },
      200,
      await issueSession(env, "reviewer", member.id),
    );
  }
  if (path === "/api/owner/session" && method === "POST") {
    await loginLimit(request, env);
    const data = await body(request);
    if (!equal(data.key, env.APP_SECRET)) fail(401, "Invalid organiser key.");
    return json({ role: "owner" }, 200, await issueSession(env, "owner"));
  }
  if (path === "/api/logout" && method === "POST") {
    const token = /(?:^|;\s*)pc_session=([a-zA-Z0-9-]+)/.exec(
      request.headers.get("cookie") || "",
    )?.[1];
    if (token)
      await stmt(
        env,
        "DELETE FROM sessions WHERE token_hash=?",
        await digest(token),
      ).run();
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "pc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    });
  }
  const user = await session(request, env, path.startsWith("/api/admin/"));
  await ensureReviewSchema(env);
  const jobResponse=await reviewJobsRoute(request,env,ctx,user,{first,rows,stmt,now,id,fail,body,json,newCode,frameView});
  if(jobResponse)return jobResponse;
  if (path === "/api/me")
    return json({ role: user.role, name: user.name || "Organiser" });
  if (path === "/api/work" && method === "POST") {
    if (user.role !== "reviewer")
      fail(403, "Use a reviewer's code to claim work.");
    if(await first(env,'SELECT id FROM review_jobs WHERE member_id=? LIMIT 1',user.member_id))fail(403,'Open your assigned review batches.');
    return json(await claim(env, user));
  }
  if (path === "/api/labels/bulk" && method === "PUT")
    return json(await saveAbsenceRun(env, user, await body(request)));
  const labelMatch = /^\/api\/labels\/([a-zA-Z0-9-]+)$/.exec(path);
  if (labelMatch && method === "PUT")
    return json(await saveLabel(env, labelMatch[1], user, await body(request)));
  const mediaMatch =
    /^\/media\/([a-zA-Z0-9-]+)\/(image|before|after|thumb)$/.exec(path);
  if (mediaMatch && method === "GET") {
    const f = await first(
      env,
      "SELECT * FROM frames WHERE id=?",
      mediaMatch[1],
    );
    if (!f) fail(404, "Frame not found.");
    if (user.role !== "owner" && f.assignee !== user.member_id && !await reviewMediaAllowed(env,user,f.id,first))
      fail(403, "This frame belongs to another reviewer.");
    let object = await env.BUCKET.get(
      assetKey(f.clip_id, f.seq, mediaMatch[2]),
    );
    if (!object && mediaMatch[2] === "thumb")
      object = await env.BUCKET.get(assetKey(f.clip_id, f.seq, "image"));
    if (!object) fail(404, "Image not found.");
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private,max-age=3600",
        Vary: "Cookie",
      },
    });
  }
  if (path === "/api/admin/dashboard") {
    const clips = await rows(
      env,
      `SELECT c.*,(SELECT COUNT(*) FROM frames f WHERE f.clip_id=c.id) AS imported,
      ((SELECT COUNT(*) FROM frames f WHERE f.clip_id=c.id AND f.state='done')+(SELECT COUNT(*) FROM review_items ri JOIN frames rf ON rf.id=ri.frame_id WHERE rf.clip_id=c.id AND ri.kind='ball' AND ri.status='done')) AS done,
      (SELECT COUNT(*) FROM frames f WHERE f.clip_id=c.id AND f.state='assigned') AS assigned FROM clips c ORDER BY created_at DESC`,
    );
    const members = await rows(
      env,
      `SELECT m.id,m.name,m.active,(SELECT COUNT(*) FROM frames f WHERE assignee=m.id AND state='done') AS done,
      (SELECT COUNT(*) FROM frames f WHERE assignee=m.id AND state='assigned') AS assigned FROM members m ORDER BY created_at`,
    );
    return json({ clips, members });
  }
  if (path === "/api/admin/members" && method === "POST") {
    const data = await body(request),
      name = text(data.name, 60);
    if (!name) fail(400, "Enter a name.");
    return json(await newCode(env, null, name), 201);
  }
  const memberMatch =
    /^\/api\/admin\/members\/([a-zA-Z0-9-]+)\/(reset|release|active)$/.exec(
      path,
    );
  if (memberMatch && method === "POST") {
    const member = await first(
      env,
      "SELECT * FROM members WHERE id=?",
      memberMatch[1],
    );
    if (!member) fail(404, "Reviewer not found.");
    if (memberMatch[2] === "reset")
      return json(await newCode(env, member.id, member.name));
    if (memberMatch[2] === "release") {
      await stmt(
        env,
        "UPDATE frames SET assignee=NULL,state='pending',assigned_at=NULL,version=version+1 WHERE assignee=? AND state='assigned'",
        member.id,
      ).run();
    } else {
      const data = await body(request);
      await env.DB.batch([
        stmt(
          env,
          "UPDATE members SET active=? WHERE id=?",
          data.active ? 1 : 0,
          member.id,
        ),
        stmt(env, "DELETE FROM sessions WHERE member_id=?", member.id),
      ]);
    }
    return json({ ok: true });
  }
  if (path === "/api/admin/clips" && method === "POST") {
    const d = await body(request);
    if (
      !text(d.title) ||
      !text(d.matchGroup) ||
      !text(d.project) ||
      !Number.isFinite(d.duration) ||
      d.duration <= 0 ||
      !Number.isInteger(d.expectedFrames) ||
      d.expectedFrames < 1 ||
      d.expectedFrames > 20000 ||
      !Number.isFinite(d.interval) ||
      d.interval <= 0 ||
      !text(d.fingerprint, 180)
    )
      fail(400, "Check the clip details.");
    const existing = await first(
      env,
      "SELECT * FROM clips WHERE fingerprint=?",
      text(d.fingerprint, 180),
    );
    if (existing) return json({ clip: existing, existing: true });
    const clip = {
      id: id(),
      title: text(d.title),
      project: text(d.project),
      match_group: text(d.matchGroup),
      fingerprint: text(d.fingerprint, 180),
      duration: d.duration,
      interval_sec: d.interval,
      expected_frames: d.expectedFrames,
    };
    await stmt(
      env,
      "INSERT INTO clips(id,title,project,match_group,fingerprint,duration,interval_sec,expected_frames,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      clip.id,
      clip.title,
      clip.project,
      clip.match_group,
      clip.fingerprint,
      clip.duration,
      clip.interval_sec,
      clip.expected_frames,
      now(),
    ).run();
    return json(
      { clip: { ...clip, status: "importing" }, existing: false },
      201,
    );
  }
  const assetMatch =
    /^\/api\/admin\/assets\/([a-zA-Z0-9-]+)\/(\d+)\/(image|before|after|thumb)$/.exec(
      path,
    );
  if (assetMatch && method === "PUT") {
    const clip = await first(
      env,
      "SELECT * FROM clips WHERE id=?",
      assetMatch[1],
    );
    if (
      !clip ||
      clip.status !== "importing" ||
      Number(assetMatch[2]) >= clip.expected_frames
    )
      fail(409, "This clip is not accepting frames.");
    if (Number(request.headers.get("content-length")) > 8_000_000)
      fail(413, "Frame exceeds 8 MB.");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > 8_000_000 || bytes[0] !== 255 || bytes[1] !== 216)
      fail(400, "Use a JPEG frame under 8 MB.");
    await env.BUCKET.put(
      assetKey(clip.id, Number(assetMatch[2]), assetMatch[3]),
      bytes,
      { httpMetadata: { contentType: "image/jpeg" } },
    );
    return json({ ok: true });
  }
  const clipMatch =
    /^\/api\/admin\/clips\/([a-zA-Z0-9-]+)(?:\/(frames|publish))?$/.exec(path);
  if (clipMatch) {
    const clip = await first(
      env,
      "SELECT * FROM clips WHERE id=?",
      clipMatch[1],
    );
    if (!clip) fail(404, "Clip not found.");
    if (method === "GET")
      return json({
        clip,
        frames: await rows(
          env,
          "SELECT seq FROM frames WHERE clip_id=?",
          clip.id,
        ),
      });
    if (clipMatch[2] === "publish" && method === "POST") {
      const count = await first(
        env,
        "SELECT COUNT(*) AS n FROM frames WHERE clip_id=?",
        clip.id,
      );
      if (count.n !== clip.expected_frames)
        fail(409, "Import every planned frame before publishing.");
      await stmt(
        env,
        "UPDATE clips SET status='ready' WHERE id=?",
        clip.id,
      ).run();
      return json({ ok: true });
    }
    if (clipMatch[2] === "frames" && method === "POST") {
      if (clip.status !== "importing") fail(409, "Clip is already published.");
      const d = await body(request);
      if (
        !Number.isInteger(d.seq) ||
        d.seq < 0 ||
        d.seq >= clip.expected_frames ||
        !Number.isFinite(d.time) ||
        d.time < 0 ||
        d.time > clip.duration ||
        !Number.isInteger(d.width) ||
        !Number.isInteger(d.height) ||
        d.width < 1 ||
        d.width > 16384 ||
        d.height < 1 ||
        d.height > 16384
      )
        fail(400, "Invalid frame metadata.");
      const proposal = validProposal(d.proposal, {
        width: d.width,
        height: d.height,
      });
      const objects = await Promise.all(
        ["image", "before", "after"].map((kind) =>
          env.BUCKET.head(assetKey(clip.id, d.seq, kind)),
        ),
      );
      if (objects.some((o) => !o))
        fail(409, "Upload all context images first.");
      const frameId = clip.id + "-" + d.seq;
      await stmt(
        env,
        `INSERT INTO frames(id,clip_id,seq,timestamp_sec,width,height,proposal,model_name,model_hash)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(clip_id,seq) DO NOTHING`,
        frameId,
        clip.id,
        d.seq,
        d.time,
        d.width,
        d.height,
        JSON.stringify(proposal),
        text(d.modelName) || "YOLOX-S pretrained",
        /^[a-f0-9]{64}$/.test(d.modelHash || "") ? d.modelHash : null,
      ).run();
      return json({ id: frameId }, 201);
    }
  }
  if (path === "/api/admin/model-info") {
    const object = await env.BUCKET.head("models/current.onnx");
    return json({
      ready: Boolean(object),
      name: object?.customMetadata?.name || "YOLOX-S pretrained",
    });
  }
  if (path === "/api/admin/model" && method === "PUT") {
    if (Number(request.headers.get("content-length")) > 90_000_000)
      fail(413, "Model exceeds 90 MB.");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 90_000_000) fail(413, "Model exceeds 90 MB.");
    await env.BUCKET.put("models/current.onnx", bytes, {
      customMetadata: {
        name: text(request.headers.get("x-model-name")) || "YOLOX-S pretrained",
      },
    });
    return json({ ok: true });
  }
  if (path === "/api/admin/model" && method === "GET") {
    const object = await env.BUCKET.get("models/current.onnx");
    if (!object) fail(404, "The AI model is not uploaded yet.");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Model-Name": encodeURIComponent(
          object.customMetadata?.name || "YOLOX-S pretrained",
        ),
        "Cache-Control": "private,max-age=3600",
      },
    });
  }
  if (path === "/api/admin/reviews") {
    const completed = await rows(
      env,
      `SELECT f.id,c.title,f.timestamp_sec,f.proposal,f.model_name,l.answer,m.name AS reviewer
      FROM frames f JOIN clips c ON c.id=f.clip_id JOIN labels l ON l.frame_id=f.id LEFT JOIN members m ON m.id=l.reviewer_id ORDER BY l.updated_at DESC LIMIT 200`,
    );
    return json({
      reviews: completed.map((r) => ({
        ...r,
        proposal: JSON.parse(r.proposal),
        answer: JSON.parse(r.answer),
      })),
    });
  }
  const reviewMatch = /^\/api\/admin\/review\/([a-zA-Z0-9-]+)$/.exec(path);
  if (reviewMatch && method === "GET") {
    const frame = await first(
      env,
      `SELECT f.*,c.title,c.match_group,l.answer
      FROM frames f JOIN clips c ON c.id=f.clip_id LEFT JOIN labels l ON l.frame_id=f.id WHERE f.id=?`,
      reviewMatch[1],
    );
    if (!frame) fail(404, "Frame not found.");
    return json({
      batch: {
        id: "organiser-" + frame.id + "-" + frame.version,
        frames: [
          {
            ...frameView(frame),
            answer: frame.answer ? JSON.parse(frame.answer) : null,
          },
        ],
      },
    });
  }
  if (path === "/api/admin/export") return downloadDataset(env, ctx);
  fail(404, "Not found.");
}
