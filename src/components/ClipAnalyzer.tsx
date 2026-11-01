"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { ClipAnalysis } from "@/lib/gemini";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 120;
const FORMATS = ["11v11", "9v9", "7v7", "5v5"];

type Stage = "idle" | "uploading" | "analysing" | "done";

// "01:23" → 83 (also tolerates "1:23" and "0:01:23").
function toSeconds(t: string): number | null {
  const parts = t.trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const field =
  "w-full rounded-xl border border-ink-700 bg-ink-900 px-3 py-2.5 text-[16px] text-white outline-none placeholder:text-ink-500 focus:border-brand";

export function ClipAnalyzer() {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [myColour, setMyColour] = useState("");
  const [oppColour, setOppColour] = useState("");
  const [format, setFormat] = useState("11v11");
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClipAnalysis | null>(null);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const pick = (f: File | null) => {
    setError(null);
    setResult(null);
    setDuration(null);
    if (url) URL.revokeObjectURL(url);
    if (!f) return (setFile(null), setUrl(null));
    if (f.size > MAX_BYTES) return setError("Clip must be under 50 MB — trim it in Veo first.");
    setFile(f);
    setUrl(URL.createObjectURL(f));
  };

  const seek = (t: string) => {
    const s = toSeconds(t);
    const v = videoRef.current;
    if (s == null || !v) return;
    v.currentTime = s;
    v.play().catch(() => undefined);
    v.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const run = async () => {
    if (!file || !supabase) return;
    if (duration && duration > MAX_SECONDS) return setError(`Clip must be ${MAX_SECONDS} seconds or less.`);
    if (!myColour.trim()) return setError("Enter your team's kit colour.");
    setError(null);
    setResult(null);

    const headers = { "Content-Type": "application/json" };

    try {
      setStage("uploading");
      const r1 = await fetch("/api/upload-url", {
        method: "POST",
        headers,
        body: JSON.stringify({ type: file.type, size: file.size }),
      });
      const j1 = (await r1.json()) as { path?: string; token?: string; error?: string };
      if (!r1.ok || !j1.path || !j1.token) throw new Error(j1.error ?? "Could not start upload");

      const up = await supabase.storage
        .from("clips")
        .uploadToSignedUrl(j1.path, j1.token, file, { contentType: file.type });
      if (up.error) throw new Error("Upload failed — check your connection and try again");

      setStage("analysing");
      const r2 = await fetch("/api/analyse", {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: j1.path,
          myTeamColour: myColour,
          opponentColour: oppColour,
          format,
          notes,
          durationSec: duration ?? undefined,
        }),
      });
      const j2 = (await r2.json()) as { analysis?: ClipAnalysis; error?: string };
      if (!r2.ok || !j2.analysis) throw new Error(j2.error ?? "Analysis failed");
      setResult(j2.analysis);
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStage("idle");
    }
  };

  const busy = stage === "uploading" || stage === "analysing";

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600/90 to-teal-700/90 px-4 py-3.5">
        <h1 className="font-display text-lg font-extrabold tracking-tight text-white">Clip Analysis</h1>
        <p className="text-[12px] text-white/80">
          Upload a short clip (e.g. a goal conceded from Veo) for an AI coaching breakdown.
        </p>
      </div>


      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-ink-700 bg-ink-900 px-4 py-6 text-center text-[13.5px] text-ink-300 hover:border-brand">
        {file ? file.name : "Choose a clip (MP4 / MOV / WebM, max 50 MB, up to 2 min)"}
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="hidden"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </label>

      {url && (
        <video
          ref={videoRef}
          src={url}
          controls
          playsInline
          className="w-full rounded-2xl bg-black"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <input className={field} placeholder="Your kit colour *" value={myColour} onChange={(e) => setMyColour(e.target.value)} />
        <input className={field} placeholder="Opponent kit colour" value={oppColour} onChange={(e) => setOppColour(e.target.value)} />
      </div>
      <select className={field} value={format} onChange={(e) => setFormat(e.target.value)}>
        {FORMATS.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <textarea
        className={`${field} min-h-[72px]`}
        placeholder="Optional context, e.g. 'We play a high line in a 4-3-3, I'm the left CB'"
        maxLength={500}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-red-300">{error}</p>}

      <button
        type="button"
        onClick={run}
        disabled={!file || busy}
        className="w-full rounded-xl bg-brand px-4 py-3 text-[14px] font-bold text-white disabled:opacity-50"
      >
        {stage === "uploading" ? "Uploading…" : stage === "analysing" ? "Analysing (can take a minute)…" : "Analyse clip"}
      </button>

      {result && <Results a={result} onSeek={seek} />}
    </div>
  );
}

function Time({ t, onSeek }: { t: string; onSeek: (t: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSeek(t)}
      className="shrink-0 rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[12px] font-bold text-brand hover:bg-ink-700"
    >
      {t}
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 rounded-2xl border border-ink-700 bg-ink-900 p-4">
      <h2 className="text-[15px] font-bold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Results({ a, onSeek }: { a: ClipAnalysis; onSeek: (t: string) => void }) {
  return (
    <div className="space-y-3">
      <Card title={a.outcome}>
        <p className="text-[13.5px] leading-relaxed text-ink-200">{a.summary}</p>
        <div className="flex items-start gap-2 rounded-xl bg-ink-800/60 p-2.5 text-[13px] text-ink-100">
          <Time t={a.key_moment.time} onSeek={onSeek} />
          <span>
            <b>Key moment:</b> {a.key_moment.description}
          </span>
        </div>
      </Card>

      {a.goal_causes.length > 0 && (
        <Card title="Why it went wrong">
          {a.goal_causes.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-200">
              <Time t={c.time} onSeek={onSeek} />
              <div>
                <p>
                  <span className={c.severity === "major" ? "font-bold text-red-300" : "font-bold text-amber-300"}>
                    {c.who}
                  </span>{" "}
                  — {c.what_went_wrong}
                </p>
                <p className="text-ink-400">Should have: {c.what_should_have_happened}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      {a.done_well.length > 0 && (
        <Card title="Done well">
          {a.done_well.map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-200">
              <Time t={d.time} onSeek={onSeek} />
              <div>
                <p>
                  <span className="font-bold text-emerald-300">{d.who}</span> — {d.what}
                </p>
                <p className="text-ink-400">{d.why}</p>
              </div>
            </div>
          ))}
        </Card>
      )}

      {a.coaching_points.length > 0 && (
        <Card title="Coaching points">
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-200">
            {a.coaching_points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      {a.unclear.length > 0 && (
        <Card title="Couldn't judge from the footage">
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-400">
            {a.unclear.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-[11px] text-ink-500">AI analysis — check each point against the video.</p>
    </div>
  );
}
