"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { captureFrames, type Frame } from "@/lib/frames";
import { buildMoments, drawOrder, formatTime } from "@/lib/moments";
import type { Annotation, ClipAnalysis, Moment } from "@/lib/types";
import { TONE, Telestration } from "./Telestration";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 120;
const FORMATS = ["11v11", "9v9", "7v7", "5v5"];
const KITS: Array<[string, string]> = [
  ["Red", "#e11d48"],
  ["Blue", "#2563eb"],
  ["Sky blue", "#38bdf8"],
  ["Navy", "#1e3a8a"],
  ["White", "#f8fafc"],
  ["Black", "#111827"],
  ["Yellow", "#facc15"],
  ["Orange", "#f97316"],
  ["Green", "#16a34a"],
  ["Claret", "#7f1d3a"],
];

type Stage = "idle" | "uploading" | "watching" | "drawing" | "done";
type Drawing = Annotation | "loading" | "error";

const KIND = {
  key: { label: "Key moment", color: TONE.info },
  error: { label: "Mistake", color: TONE.error },
  good: { label: "Done well", color: TONE.good },
} as const;

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur";

export function ClipAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const runId = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [myColour, setMyColour] = useState("");
  const [oppColour, setOppColour] = useState("");
  const [format, setFormat] = useState("11v11");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<ClipAnalysis | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [drawings, setDrawings] = useState<Record<string, Drawing>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [now, setNow] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const reset = () => {
    runId.current++;
    setResult(null);
    setMoments([]);
    setFrames({});
    setDrawings({});
    setActiveId(null);
    setOverlay(false);
    setStage("idle");
  };

  const pick = (f: File | null) => {
    setError(null);
    reset();
    setDuration(null);
    if (url) URL.revokeObjectURL(url);
    if (!f) return (setFile(null), setUrl(null));
    if (!/^video\/(mp4|quicktime|webm)$/.test(f.type)) return setError("Use an MP4, MOV or WebM video.");
    if (f.size > MAX_BYTES) return setError("Clip must be under 50 MB — trim it in Veo first.");
    setFile(f);
    setUrl(URL.createObjectURL(f));
  };

  // ── Run: upload → analyse → capture frames → draw on each ──────────────
  const run = async () => {
    if (!file || !url || !supabase) return;
    if (duration && duration > MAX_SECONDS) return setError(`Clip must be ${MAX_SECONDS} seconds or less.`);
    if (!myColour.trim()) return setError("Pick your team's kit colour.");
    setError(null);
    reset();
    const id = ++runId.current;
    const headers = { "Content-Type": "application/json" };
    let analysed = false;

    try {
      setStage("uploading");
      const r1 = await fetch("/api/upload-url", { method: "POST", headers, body: JSON.stringify({ type: file.type, size: file.size }) });
      const j1 = (await r1.json()) as { path?: string; token?: string; error?: string };
      if (!r1.ok || !j1.path || !j1.token) throw new Error(j1.error ?? "Could not start upload");
      const up = await supabase.storage.from("clips").uploadToSignedUrl(j1.path, j1.token, file, { contentType: file.type });
      if (up.error) throw new Error("Upload failed — check your connection and try again");

      setStage("watching");
      const ctx = { myTeamColour: myColour, opponentColour: oppColour };
      const r2 = await fetch("/api/analyse", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: j1.path, ...ctx, format, notes, durationSec: duration ?? undefined }),
      });
      const j2 = (await r2.json()) as { analysis?: ClipAnalysis; error?: string };
      if (!r2.ok || !j2.analysis) throw new Error(j2.error ?? "Analysis failed");
      if (id !== runId.current) return;

      const ms = buildMoments(j2.analysis, duration);
      analysed = true;
      setResult(j2.analysis);
      setMoments(ms);
      setStage("drawing");

      const toDraw = drawOrder(ms);
      setDrawings(Object.fromEntries(toDraw.map((m) => [m.id, "loading" as const])));
      const shots = await captureFrames(url, toDraw.map((m) => m.seconds));
      if (id !== runId.current) return;
      setFrames(Object.fromEntries(toDraw.map((m, i) => [m.id, shots[i]])));
      const first = toDraw[0];
      if (first) select(first, false);

      // Draw on frames, 3 at a time.
      let next = 0;
      const worker = async () => {
        while (next < toDraw.length) {
          const i = next++;
          const m = toDraw[i];
          let d: Drawing = "error";
          try {
            const r = await fetch("/api/annotate", {
              method: "POST",
              headers,
              body: JSON.stringify({ image: shots[i].src, moment: m, ...ctx }),
            });
            const j = (await r.json()) as { annotation?: Annotation };
            if (r.ok && j.annotation) d = j.annotation;
          } catch {
            /* marked as error below */
          }
          if (id !== runId.current) return;
          setDrawings((prev) => ({ ...prev, [m.id]: d }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (id === runId.current) setStage("done");
    } catch (e) {
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStage(analysed ? "done" : "idle");
    }
  };

  // ── Player control ─────────────────────────────────────────────────────
  const select = useCallback((m: Moment, scroll = true) => {
    const v = videoRef.current;
    setActiveId(m.id);
    setOverlay(true);
    if (v) {
      v.pause();
      v.currentTime = m.seconds;
      if (scroll && window.innerWidth < 1024) v.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const active = moments.find((m) => m.id === activeId) ?? null;
  const activeDrawing = active ? drawings[active.id] : undefined;
  const idx = active ? moments.indexOf(active) : -1;
  const step = useCallback(
    (d: 1 | -1) => {
      if (moments.length === 0) return;
      const i = idx < 0 ? 0 : (idx + d + moments.length) % moments.length;
      select(moments[i]);
    },
    [idx, moments, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!result || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, step]);

  const busy = stage === "uploading" || stage === "watching";
  const counts = useMemo(
    () => ({
      error: moments.filter((m) => m.kind === "error").length,
      good: moments.filter((m) => m.kind === "good").length,
    }),
    [moments],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-16">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-[0_0_24px_rgba(16,185,129,0.45)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-black" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M12 5v14M3 9.5h3v5H3M21 9.5h-3v5h3" />
              <circle cx="12" cy="12" r="2.2" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Clip Analysis</h1>
            <p className="text-[12px] text-ink-400">AI telestration for your match footage</p>
          </div>
        </div>
        {result && (
          <button type="button" onClick={() => pick(null)} className="rounded-xl border border-white/10 px-3 py-2 text-[13px] font-bold text-ink-200 hover:bg-white/5">
            New clip
          </button>
        )}
      </header>

      {!result && (
        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* Upload / preview */}
          <div className={`${card} overflow-hidden`}>
            {url ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  src={url}
                  controls
                  playsInline
                  className="block w-full bg-black"
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration);
                    setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || 16 / 9);
                  }}
                />
                {busy && <Working stage={stage} />}
              </div>
            ) : (
              <label
                onDragOver={(e) => (e.preventDefault(), setDragging(true))}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex aspect-video cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center transition ${
                  dragging ? "border-brand bg-brand/10" : "border-white/10 hover:border-brand/60"
                }`}
              >
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                  </svg>
                </span>
                <span className="text-[15px] font-bold">Drop a clip or click to choose</span>
                <span className="text-[12px] text-ink-400">MP4 · MOV · WebM — up to 50 MB and 2 minutes</span>
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
              </label>
            )}
            {file && (
              <div className="flex items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5 text-[12px] text-ink-400">
                <span className="truncate">{file.name}</span>
                <span className="shrink-0">
                  {duration ? `${duration.toFixed(1)}s · ` : ""}
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                  {!busy && (
                    <button type="button" onClick={() => pick(null)} className="ml-3 font-bold text-ink-200 hover:text-white">
                      Change
                    </button>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Setup */}
          <div className={`${card} space-y-5 p-5`}>
            <KitPicker label="Your team" value={myColour} onChange={setMyColour} required />
            <KitPicker label="Opponent" value={oppColour} onChange={setOppColour} />
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-400">Format</p>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={`rounded-lg py-2 text-[13px] font-bold transition ${format === f ? "bg-white text-black" : "text-ink-300 hover:text-white"}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-400">Context (optional)</p>
              <textarea
                className="min-h-[76px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[15px] outline-none placeholder:text-ink-500 focus:border-brand"
                placeholder="e.g. We play a high line in a 4-3-3, I'm the left CB"
                maxLength={500}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</p>}
            <button
              type="button"
              onClick={run}
              disabled={!file || busy}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-4 py-3.5 text-[15px] font-extrabold text-black shadow-[0_8px_30px_rgba(16,185,129,0.35)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? "Analysing…" : "Analyse clip"}
            </button>
            <Steps stage={stage} />
          </div>
        </div>
      )}

      {result && url && (
        <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
          {/* Player + timeline */}
          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <div className={`${card} overflow-hidden`}>
              <div className="relative">
                <video
                  ref={videoRef}
                  src={url}
                  controls
                  playsInline
                  className="block w-full bg-black"
                  onPlay={() => setOverlay(false)}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setNow(t);
                    if (overlay && active && Math.abs(t - active.seconds) > 0.35) setOverlay(false);
                  }}
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration);
                    setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || 16 / 9);
                  }}
                />
                {overlay && activeDrawing && typeof activeDrawing === "object" && (
                  <Telestration key={active?.id} shapes={activeDrawing.shapes} aspect={aspect} />
                )}
                {active && overlay && (
                  <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-2.5 py-1 text-[12px] font-bold backdrop-blur">
                    <span className="h-2 w-2 rounded-full" style={{ background: KIND[active.kind].color }} />
                    {active.headline}
                    {activeDrawing === "loading" && <span className="text-ink-400">· drawing…</span>}
                  </div>
                )}
              </div>
              <Timeline moments={moments} duration={duration ?? 0} now={now} activeId={activeId} onSelect={select} />
              <div className="flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2.5">
                <div className="flex gap-1.5">
                  <IconBtn onClick={() => step(-1)} label="Previous moment">‹</IconBtn>
                  <IconBtn onClick={() => step(1)} label="Next moment">›</IconBtn>
                </div>
                <p className="hidden text-[11px] text-ink-500 sm:block">← → to jump between moments</p>
                <button
                  type="button"
                  onClick={() => setOverlay((o) => !o)}
                  disabled={!active}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${overlay ? "bg-white text-black" : "bg-white/5 text-ink-300"}`}
                >
                  Drawings {overlay ? "on" : "off"}
                </button>
              </div>
            </div>

            {active && activeDrawing && typeof activeDrawing === "object" && activeDrawing.caption && (
              <p className="px-1 text-[13px] italic text-ink-300">{activeDrawing.caption}</p>
            )}

            <div className={`${card} space-y-3 p-5`}>
              <div className="flex flex-wrap items-center gap-2">
                <Pill color={TONE.error}>{counts.error} {counts.error === 1 ? "mistake" : "mistakes"}</Pill>
                <Pill color={TONE.good}>{counts.good} done well</Pill>
                {stage === "drawing" && <span className="text-[12px] text-ink-400">Drawing on frames…</span>}
              </div>
              <h2 className="text-xl font-extrabold leading-snug tracking-tight">{result.outcome}</h2>
              <p className="text-[14px] leading-relaxed text-ink-300">{result.summary}</p>
            </div>
          </div>

          {/* Moments */}
          <div className="space-y-3">
            {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</p>}
            {moments.map((m) => (
              <MomentCard
                key={m.id}
                m={m}
                frame={frames[m.id]}
                drawing={drawings[m.id]}
                aspect={aspect}
                active={m.id === activeId}
                onClick={() => select(m)}
              />
            ))}

            {result.coaching_points.length > 0 && (
              <section className={`${card} p-5`}>
                <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-ink-400">Coaching points</h3>
                <ol className="space-y-2.5">
                  {result.coaching_points.map((p, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-ink-200">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[12px] font-extrabold text-brand">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {result.unclear.length > 0 && (
              <section className={`${card} p-5`}>
                <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-ink-400">Couldn&apos;t judge from the footage</h3>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-400">
                  {result.unclear.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="pt-1 text-center text-[11px] text-ink-500">AI analysis — check each point against the video.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function KitPicker({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-bold uppercase tracking-wider text-ink-400">
        {label} kit {required && <span className="text-brand">*</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {KITS.map(([name, hex]) => {
          const on = value.toLowerCase() === name.toLowerCase();
          return (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => onChange(on ? "" : name)}
              className={`h-8 w-8 rounded-full border-2 transition ${on ? "scale-110 border-white ring-2 ring-brand ring-offset-2 ring-offset-ink-950" : "border-white/20 hover:scale-105"}`}
              style={{ background: hex }}
            />
          );
        })}
      </div>
      <input
        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[15px] outline-none placeholder:text-ink-500 focus:border-brand"
        placeholder="or describe it, e.g. red & white stripes"
        value={value}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const STEPS: Array<[Stage, string]> = [
  ["uploading", "Upload"],
  ["watching", "Watch clip"],
  ["drawing", "Draw frames"],
];

function Steps({ stage }: { stage: Stage }) {
  if (stage === "idle") return null;
  const at = STEPS.findIndex(([s]) => s === stage);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map(([s, label], i) => (
        <div key={s} className="flex flex-1 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
              i < at ? "bg-brand text-black" : i === at ? "animate-pulse bg-white text-black" : "bg-white/10 text-ink-400"
            }`}
          >
            {i < at ? "✓" : i + 1}
          </span>
          <span className={`text-[12px] font-bold ${i <= at ? "text-white" : "text-ink-500"}`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function Working({ stage }: { stage: Stage }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 backdrop-blur-sm">
      <div className="relative h-14 w-14">
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/30" />
        <span className="absolute inset-2 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
      <p className="text-[14px] font-bold">{stage === "uploading" ? "Uploading clip…" : "Watching the clip like a coach…"}</p>
      {stage === "watching" && <p className="text-[12px] text-ink-400">Usually under a minute</p>}
    </div>
  );
}

function Timeline({
  moments,
  duration,
  now,
  activeId,
  onSelect,
}: {
  moments: Moment[];
  duration: number;
  now: number;
  activeId: string | null;
  onSelect: (m: Moment) => void;
}) {
  if (!duration) return null;
  return (
    <div className="relative mx-4 my-4 h-6">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
      <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/30" style={{ width: `${(now / duration) * 100}%` }} />
      {moments.map((m) => (
        <button
          key={m.id}
          type="button"
          title={`${formatTime(m.seconds)} · ${m.headline}`}
          onClick={() => onSelect(m)}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-950 transition hover:scale-125 ${
            m.id === activeId ? "h-5 w-5 ring-2 ring-white" : "h-3.5 w-3.5"
          }`}
          style={{ left: `${(m.seconds / duration) * 100}%`, background: KIND[m.kind].color }}
        />
      ))}
    </div>
  );
}

function MomentCard({
  m,
  frame,
  drawing,
  aspect,
  active,
  onClick,
}: {
  m: Moment;
  frame?: Frame;
  drawing?: Drawing;
  aspect: number;
  active: boolean;
  onClick: () => void;
}) {
  const k = KIND[m.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${card} group flex w-full gap-4 p-3 text-left transition hover:bg-white/[0.06] ${active ? "border-white/30 bg-white/[0.07]" : ""}`}
      style={active ? { boxShadow: `inset 3px 0 0 ${k.color}` } : undefined}
    >
      {drawing && (
        <div className="relative w-36 shrink-0 overflow-hidden rounded-xl bg-black sm:w-44" style={{ aspectRatio: String(frame ? frame.w / frame.h : aspect) }}>
          {frame && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {frame && typeof drawing === "object" && <Telestration shapes={drawing.shapes} aspect={frame.w / frame.h} compact />}
          {drawing === "loading" && <div className="shimmer absolute inset-0 bg-white/[0.03]" />}
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-bold">{formatTime(m.seconds)}</span>
        </div>
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: k.color }}>
            {k.label}
            {m.severity === "major" ? " · major" : ""}
          </span>
          {!drawing && <span className="font-mono text-[11px] text-ink-500">{formatTime(m.seconds)}</span>}
        </div>
        <p className="text-[15px] font-extrabold leading-snug">{m.headline}</p>
        {m.who && <p className="mt-0.5 text-[12px] font-semibold text-ink-400">{m.who}</p>}
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-200">{m.detail}</p>
        {m.fix && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-400">
            <span className="font-bold" style={{ color: TONE.good }}>
              {m.kind === "good" ? "Why it matters: " : "Should have: "}
            </span>
            {m.fix}
          </p>
        )}
      </div>
    </button>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[12px] font-bold">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function IconBtn({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-lg font-bold text-ink-200 hover:bg-white/10">
      {children}
    </button>
  );
}
