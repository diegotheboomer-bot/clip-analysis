"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { captureFrames, type Frame } from "@/lib/frames";
import { buildMoments, drawOrder, formatTime, toSeconds } from "@/lib/moments";
import type { Annotation, Board, ClipAnalysis, Moment } from "@/lib/types";
import { BOARD_ASPECT, PitchBoard } from "./PitchBoard";
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
const kitHex = (name: string, fallback: string) =>
  KITS.find(([n]) => n.toLowerCase() === name.trim().toLowerCase())?.[1] ?? fallback;

type Stage = "idle" | "uploading" | "watching" | "drawing" | "done";
type Async<T> = T | "loading" | "error";

const KIND = {
  key: { label: "Key moment", color: TONE.info },
  error: { label: "Mistake", color: TONE.error },
  good: { label: "Done well", color: TONE.good },
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
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
  const [dragging, setDragging] = useState(false);

  const [result, setResult] = useState<ClipAnalysis | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [drawings, setDrawings] = useState<Record<string, Async<Annotation>>>({});
  const [boards, setBoards] = useState<Record<string, Async<Board>>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [drawMode, setDrawMode] = useState<"labels" | "lines">("labels");
  const [zoom, setZoom] = useState(true);
  const [view, setView] = useState<"video" | "board">("video");
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(0);

  // The context used for this run (so later 2D requests match the analysis).
  const ctxRef = useRef({ myTeamColour: "", opponentColour: "" });

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const reset = () => {
    runId.current++;
    setResult(null);
    setMoments([]);
    setFrames({});
    setDrawings({});
    setBoards({});
    setActiveId(null);
    setOverlay(false);
    setView("video");
    setFull(false);
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

  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
    return j;
  };

  // ── 2D board for one moment (key moment automatically, others on demand) ──
  const requestBoard = useCallback(
    async (m: Moment, frame?: Frame) => {
      if (!url) return;
      const id = runId.current;
      setBoards((b) => ({ ...b, [m.id]: "loading" }));
      try {
        let f = frame;
        if (!f) {
          [f] = await captureFrames(url, [m.seconds]);
          setFrames((fr) => ({ ...fr, [m.id]: f as Frame }));
        }
        const { board } = await post<{ board: Board }>("/api/annotate", { mode: "board", image: f.src, moment: m, ...ctxRef.current });
        if (id === runId.current) setBoards((b) => ({ ...b, [m.id]: board }));
      } catch {
        if (id === runId.current) setBoards((b) => ({ ...b, [m.id]: "error" }));
      }
    },
    [url],
  );

  // ── Run: upload → analyse → capture frames → draw on each ──────────────
  const run = async () => {
    if (!file || !url || !supabase) return;
    if (duration && duration > MAX_SECONDS) return setError(`Clip must be ${MAX_SECONDS} seconds or less.`);
    if (!myColour.trim()) return setError("Pick your team's kit colour.");
    setError(null);
    reset();
    const id = ++runId.current;
    const ctx = { myTeamColour: myColour, opponentColour: oppColour };
    ctxRef.current = ctx;
    let analysed = false;

    try {
      setStage("uploading");
      const j1 = await post<{ path: string; token: string }>("/api/upload-url", { type: file.type, size: file.size });
      const up = await supabase.storage.from("clips").uploadToSignedUrl(j1.path, j1.token, file, { contentType: file.type });
      if (up.error) throw new Error("Upload failed — check your connection and try again");

      setStage("watching");
      const { analysis } = await post<{ analysis: ClipAnalysis }>("/api/analyse", {
        path: j1.path,
        ...ctx,
        format,
        notes,
        durationSec: duration ?? undefined,
      });
      if (id !== runId.current) return;

      const ms = buildMoments(analysis, duration);
      analysed = true;
      setResult(analysis);
      setMoments(ms);
      setStage("drawing");

      const toDraw = drawOrder(ms);
      setDrawings(Object.fromEntries(toDraw.map((m) => [m.id, "loading" as const])));
      const shots = await captureFrames(url, toDraw.map((m) => m.seconds));
      if (id !== runId.current) return;
      setFrames(Object.fromEntries(toDraw.map((m, i) => [m.id, shots[i]])));
      if (toDraw[0]) {
        select(toDraw[0], false);
        void requestBoard(toDraw[0], shots[0]);
      }

      // Draw on frames, 3 at a time.
      let next = 0;
      const worker = async () => {
        while (next < toDraw.length) {
          const i = next++;
          const m = toDraw[i];
          let d: Async<Annotation> = "error";
          try {
            d = (await post<{ annotation: Annotation }>("/api/annotate", { image: shots[i].src, moment: m, ...ctx })).annotation;
          } catch {
            /* stays "error" */
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
      if (scroll && window.innerWidth < 1024) v.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const seekTo = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    setView("video");
    v.pause();
    v.currentTime = s;
    if (window.innerWidth < 1024) v.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const active = moments.find((m) => m.id === activeId) ?? null;
  const activeDrawing = active ? drawings[active.id] : undefined;
  const activeBoard = active ? boards[active.id] : undefined;
  const idx = active ? moments.indexOf(active) : -1;
  const step = useCallback(
    (d: 1 | -1) => {
      if (moments.length === 0) return;
      const i = idx < 0 ? 0 : (idx + d + moments.length) % moments.length;
      select(moments[i], false);
    },
    [idx, moments, select],
  );

  // Full screen: real fullscreen where supported, CSS takeover everywhere.
  const enterFull = () => {
    setFull(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onChange = () => {
      const el = document.fullscreenElement;
      if (!el) return setFull(false);
      if (el.tagName === "VIDEO") {
        // The player's own full screen hides the drawing layer — switch to ours.
        document.exitFullscreen().then(() => {
          setFull(true);
          document.documentElement.requestFullscreen?.().catch(() => undefined);
        }, () => undefined);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    document.body.style.overflow = full ? "hidden" : "";
  }, [full]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!result || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "Escape" && full) exitFull();
      if (e.key.toLowerCase() === "f") (full ? exitFull() : enterFull());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, step, full, exitFull]);

  const busy = stage === "uploading" || stage === "watching";
  const groups = useMemo(
    () => ({
      wrong: moments.filter((m) => m.kind !== "good").sort((a, b) => (a.kind === "key" ? -1 : b.kind === "key" ? 1 : a.seconds - b.seconds)),
      good: moments.filter((m) => m.kind === "good"),
    }),
    [moments],
  );
  const usColor = kitHex(myColour, "#ef4444");
  const themColor = kitHex(oppColour, usColor === "#2563eb" ? "#ef4444" : "#2563eb");

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
            <p className="text-[12px] text-ink-400">AI match review · telestration · 2D tactics</p>
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
          {/* ── Viewer ── */}
          <div className={full ? "relative z-50" : "space-y-3 lg:sticky lg:top-4 lg:self-start"}>
            <div className={full ? "fixed inset-0 z-50 flex flex-col bg-[#05070b]" : `${card} overflow-hidden`}>
              {/* Top bar */}
              <div className={`flex items-center justify-between gap-3 px-3 ${full ? "h-14 border-b border-white/10" : "py-2.5"}`}>
                <div className="flex min-w-0 items-center gap-2">
                  {active ? (
                    <>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND[active.kind].color }} />
                      <span className="truncate text-[13px] font-extrabold">{active.headline}</span>
                      <span className="shrink-0 font-mono text-[12px] text-ink-400">{formatTime(active.seconds)}</span>
                    </>
                  ) : (
                    <span className="text-[13px] font-bold text-ink-400">Pick a moment</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Segmented
                    value={view}
                    onChange={(v) => {
                      setView(v);
                      if (v === "board" && active && !activeBoard) void requestBoard(active, frames[active.id]);
                    }}
                    options={[
                      ["video", "Video"],
                      ["board", "2D"],
                    ]}
                  />
                  <IconBtn onClick={full ? exitFull : enterFull} label={full ? "Exit full screen" : "Full screen"}>
                    {full ? <CollapseIcon /> : <ExpandIcon />}
                  </IconBtn>
                </div>
              </div>

              {/* Stage */}
              <div className={full ? "flex min-h-0 flex-1 items-center justify-center p-3" : ""}>
                <div
                  className={`relative ${view === "video" ? "" : "hidden"}`}
                  style={full ? { width: `min(100%, calc((100vh - 190px) * ${aspect}))` } : undefined}
                >
                  <video
                    ref={videoRef}
                    src={url}
                    controls
                    controlsList="nofullscreen nodownload"
                    disablePictureInPicture
                    playsInline
                    className="block w-full bg-black"
                    onDoubleClick={() => (full ? exitFull() : enterFull())}
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
                    <Telestration key={active?.id} shapes={activeDrawing.shapes} avoid={activeDrawing.avoid} labels={drawMode === "labels"} />
                  )}
                  {overlay && activeDrawing === "loading" && (
                    <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[11px] font-bold text-ink-300">Drawing…</span>
                  )}
                </div>

                {view === "board" && (
                  <BoardView
                    state={activeBoard}
                    full={full}
                    usColor={usColor}
                    themColor={themColor}
                    showDistances={format === "11v11"}
                    zoom={zoom}
                    onZoom={() => setZoom((z) => !z)}
                    myLabel={myColour}
                    oppLabel={oppColour || "Opponent"}
                    onRetry={() => active && void requestBoard(active, frames[active.id])}
                  />
                )}
              </div>

              {/* Timeline + controls */}
              <Timeline moments={moments} duration={duration ?? 0} now={now} activeId={activeId} onSelect={(m) => select(m, false)} />
              <div className={`flex items-center justify-between gap-2 border-t border-white/5 px-3 py-2.5 ${full ? "pb-4" : ""}`}>
                <div className="flex gap-1.5">
                  <IconBtn onClick={() => step(-1)} label="Previous moment">‹</IconBtn>
                  <IconBtn onClick={() => step(1)} label="Next moment">›</IconBtn>
                </div>
                <p className="hidden min-w-0 flex-1 truncate px-2 text-center text-[12px] italic text-ink-400 sm:block">
                  {view === "video" && activeDrawing && typeof activeDrawing === "object" ? activeDrawing.caption : "← → moments · F full screen"}
                </p>
                <Segmented
                  value={!overlay ? "off" : drawMode}
                  onChange={(v) => {
                    if (v === "off") return setOverlay(false);
                    setDrawMode(v);
                    if (active) select(active, false);
                  }}
                  options={[
                    ["labels", "Labels"],
                    ["lines", "Lines"],
                    ["off", "Off"],
                  ]}
                />
              </div>
            </div>
            {!full && view === "video" && activeDrawing && typeof activeDrawing === "object" && activeDrawing.caption && (
              <p className="px-1 text-[13px] italic text-ink-400 sm:hidden">{activeDrawing.caption}</p>
            )}
          </div>

          {/* ── Review ── */}
          <div className="space-y-5">
            {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">{error}</p>}

            <section className={`${card} overflow-hidden`}>
              <div className="h-1 bg-gradient-to-r from-[#ff4d5e] via-[#ffd23f] to-[#22e39a]" />
              <div className="space-y-3 p-5">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#ff8a95]">Verdict</p>
                <h2 className="text-[19px] font-extrabold leading-snug tracking-tight">{result.verdict || result.outcome}</h2>
                <p className="text-[13px] font-semibold text-ink-300">{result.outcome}</p>
                <p className="text-[14px] leading-relaxed text-ink-300">{result.summary}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Pill color={TONE.error}>{plural(groups.wrong.filter((m) => m.kind === "error").length, "mistake")}</Pill>
                  <Pill color={TONE.good}>{groups.good.length} done well</Pill>
                  <Pill color="#38bdf8">{plural(result.prevention?.length ?? 0, "way", "ways")} to prevent</Pill>
                  {stage === "drawing" && <span className="self-center text-[12px] text-ink-400">Drawing on frames…</span>}
                </div>
              </div>
            </section>

            <Section title="What went wrong" color={TONE.error}>
              {groups.wrong.map((m) => (
                <MomentCard key={m.id} m={m} frame={frames[m.id]} drawing={drawings[m.id]} active={m.id === activeId} onClick={() => (setView("video"), select(m))} onExpand={() => (setView("video"), select(m, false), enterFull())} />
              ))}
            </Section>

            {groups.good.length > 0 && (
              <Section title="What went well" color={TONE.good}>
                {groups.good.map((m) => (
                  <MomentCard key={m.id} m={m} frame={frames[m.id]} drawing={drawings[m.id]} active={m.id === activeId} onClick={() => (setView("video"), select(m))} onExpand={() => (setView("video"), select(m, false), enterFull())} />
                ))}
              </Section>
            )}

            {(result.prevention?.length ?? 0) > 0 && (
              <Section title="How it could have been prevented" color="#38bdf8">
                <ol className={`${card} divide-y divide-white/5`}>
                  {result.prevention.map((p, i) => {
                    const s = toSeconds(p.time);
                    return (
                      <li key={i} className="flex gap-3 p-4">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-400/15 text-[12px] font-extrabold text-sky-300">{i + 1}</span>
                        <div className="min-w-0">
                          <div className="mb-0.5 flex flex-wrap items-center gap-2">
                            {s != null && (
                              <button type="button" onClick={() => seekTo(s)} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-bold text-sky-300 hover:bg-white/10">
                                {formatTime(s)}
                              </button>
                            )}
                            <span className="text-[12px] font-bold text-ink-300">{p.who}</span>
                          </div>
                          <p className="text-[14px] font-semibold leading-snug">{p.action}</p>
                          <p className="mt-1 text-[13px] leading-relaxed text-ink-400">{p.impact}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Section>
            )}

            {result.coaching_points.length > 0 && (
              <Section title="Coaching points" color="#a78bfa">
                <ol className={`${card} space-y-2.5 p-4`}>
                  {result.coaching_points.map((p, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-ink-200">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-400/15 text-[12px] font-extrabold text-violet-300">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            {result.unclear.length > 0 && (
              <Section title="Couldn't judge from the footage" color="#5a6172">
                <ul className={`${card} list-disc space-y-1 p-4 pl-8 text-[13px] text-ink-400`}>
                  {result.unclear.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Section>
            )}
            <p className="text-center text-[11px] text-ink-500">AI analysis — check each point against the video. 2D boards are approximate.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function BoardView({
  state,
  full,
  usColor,
  themColor,
  showDistances,
  zoom,
  onZoom,
  myLabel,
  oppLabel,
  onRetry,
}: {
  state?: Async<Board>;
  full: boolean;
  usColor: string;
  themColor: string;
  showDistances: boolean;
  zoom: boolean;
  onZoom: () => void;
  myLabel: string;
  oppLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 ${full ? "h-full w-full justify-center" : "bg-black/30 px-3 py-4"}`}>
      <div
        className="relative"
        style={full ? { height: "calc(100vh - 220px)", aspectRatio: String(BOARD_ASPECT) } : { width: `min(100%, calc(62vh * ${BOARD_ASPECT}))`, aspectRatio: String(BOARD_ASPECT) }}
      >
        {state && typeof state === "object" ? (
          <PitchBoard board={state} usColor={usColor} themColor={themColor} showDistances={showDistances} zoom={zoom} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg bg-[#266a29]/40 text-center">
            {state === "error" ? (
              <>
                <p className="text-[13px] text-ink-300">Couldn&apos;t build the 2D view.</p>
                <button type="button" onClick={onRetry} className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-bold text-black">
                  Try again
                </button>
              </>
            ) : (
              <>
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                <p className="text-[13px] text-ink-300">Building 2D view…</p>
              </>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ background: usColor }} /> {myLabel || "Us"}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-white" style={{ background: themColor }} /> {oppLabel}
        </span>
        <span>Our goal at the bottom · approximate, from one camera frame{showDistances ? " · distances assume 105×68m" : ""}</span>
        {state && typeof state === "object" && (
          <button type="button" onClick={onZoom} className="rounded-md bg-white/10 px-2 py-1 font-bold text-white hover:bg-white/20">
            {zoom ? "Full pitch" : "Zoom to action"}
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 px-1 text-[12px] font-extrabold uppercase tracking-[0.14em] text-ink-300">
        <span className="h-3 w-1 rounded-full" style={{ background: color }} />
        {title}
      </h3>
      {children}
    </section>
  );
}

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
    <div className="relative mx-4 my-3 h-6">
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
      <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/30" style={{ width: `${(now / duration) * 100}%` }} />
      {moments.map((m) => (
        <button
          key={m.id}
          type="button"
          title={`${formatTime(m.seconds)} · ${m.headline}`}
          onClick={() => onSelect(m)}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#05070b] transition hover:scale-125 ${
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
  active,
  onClick,
  onExpand,
}: {
  m: Moment;
  frame?: Frame;
  drawing?: Async<Annotation>;
  active: boolean;
  onClick: () => void;
  onExpand: () => void;
}) {
  const k = KIND[m.kind];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={`${card} group flex w-full cursor-pointer flex-col gap-3 p-3 text-left transition hover:bg-white/[0.06] ${active ? "border-white/25 bg-white/[0.07]" : ""}`}
      style={active ? { boxShadow: `inset 3px 0 0 ${k.color}` } : undefined}
    >
      {drawing && (
        <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: String(frame ? frame.w / frame.h : 16 / 9) }}>
          {frame && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame.src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {frame && typeof drawing === "object" && <Telestration shapes={drawing.shapes} compact />}
          {drawing === "loading" && <div className="shimmer absolute inset-0 bg-white/[0.03]" />}
          <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] font-bold">{formatTime(m.seconds)}</span>
          {typeof drawing === "object" && (
            <button
              type="button"
              aria-label="Open full screen"
              onClick={(e) => (e.stopPropagation(), onExpand())}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-black/70 text-white opacity-90 transition hover:bg-black group-hover:opacity-100"
            >
              <ExpandIcon />
            </button>
          )}
        </div>
      )}
      <div className="min-w-0 px-1 pb-1">
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
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<[T, string]> }) {
  return (
    <div className="flex rounded-lg bg-white/5 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-[12px] font-bold transition ${value === v ? "bg-white text-black" : "text-ink-300 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
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
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-lg font-bold text-ink-200 hover:bg-white/10">
      {children}
    </button>
  );
}

const ExpandIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);
const CollapseIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
);
