const readinessEvents = [
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "seeked",
  "timeupdate",
  "progress",
  "durationchange",
];

export class VideoReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "VideoReadError";
    this.retryable = true;
  }
}

export class ImportPaused extends Error {
  constructor() {
    super("Import paused.");
    this.name = "ImportPaused";
  }
}

// Event-only waits can time out even though a paused video has decoded the
// requested frame. Readiness is authoritative; events and polling both wake it.
export class VideoReader {
  constructor({
    video,
    page = globalThis.document,
    paused = () => false,
    timeoutMs = 45000,
    pollMs = 100,
    now = () => Date.now(),
    createURL = (file) => URL.createObjectURL(file),
    revokeURL = (url) => URL.revokeObjectURL(url),
  } = {}) {
    this.page = page;
    this.video = video || page.createElement("video");
    this.paused = paused;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.now = now;
    this.createURL = createURL;
    this.revokeURL = revokeURL;
    this.url = null;
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.tabIndex = -1;
    v.setAttribute("aria-hidden", "true");
    // Keep the decoder attached and renderable, without adding controls to the UI.
    Object.assign(v.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      left: "0",
      bottom: "0",
      opacity: "0.01",
      pointerEvents: "none",
    });
    if (!v.isConnected) page.body.append(v);
  }

  wait(ready, action, timeoutMessage) {
    return new Promise((resolve, reject) => {
      const video = this.video,
        page = this.page;
      let timer,
        settled = false,
        elapsed = 0,
        previous = this.now(),
        wasHidden = Boolean(page.hidden);
      const cleanup = () => {
        clearTimeout(timer);
        for (const event of readinessEvents)
          video.removeEventListener(event, check);
        video.removeEventListener("error", check);
        page.removeEventListener("visibilitychange", visibility);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        if (settled) return;
        if (this.paused()) return finish(new ImportPaused());
        if (video.error)
          return finish(
            new VideoReadError(
              "The browser could not decode this file. Try an MP4 export using H.264 video.",
            ),
          );
        if (ready()) return finish();
        const current = this.now(),
          hidden = Boolean(page.hidden);
        if (!hidden && !wasHidden) elapsed += Math.max(0, current - previous);
        previous = current;
        wasHidden = hidden;
        if (elapsed >= this.timeoutMs)
          return finish(new VideoReadError(timeoutMessage));
        clearTimeout(timer);
        timer = setTimeout(check, this.pollMs);
      };
      const visibility = () => {
        previous = this.now();
        wasHidden = Boolean(page.hidden);
        check();
      };
      for (const event of readinessEvents) video.addEventListener(event, check);
      video.addEventListener("error", check);
      page.addEventListener("visibilitychange", visibility);
      try {
        action?.();
        check();
      } catch (error) {
        finish(
          new VideoReadError(error.message || "Could not read this video."),
        );
      }
    });
  }

  async open(file) {
    this.releaseSource();
    const video = this.video;
    this.url = this.createURL(file);
    await this.wait(
      () =>
        video.readyState >= 1 &&
        Number.isFinite(video.duration) &&
        video.duration > 0 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0,
      () => {
        video.src = this.url;
        video.load();
      },
      "Timed out opening this video. Try an MP4 export using H.264 video.",
    );
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  }

  async seek(time) {
    const video = this.video;
    const endPadding = Math.min(0.12, video.duration / 2);
    const target = Math.max(0, Math.min(video.duration - endPadding, time));
    await this.wait(
      () =>
        !video.seeking &&
        video.readyState >= 2 &&
        Math.abs(video.currentTime - target) < 0.08,
      () => {
        if (Math.abs(video.currentTime - target) > 0.001)
          video.currentTime = target;
      },
      `Timed out decoding the frame at ${target.toFixed(2)} s.`,
    );
    return video.currentTime;
  }

  releaseSource() {
    const video = this.video;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (this.url) this.revokeURL(this.url);
    this.url = null;
  }

  close() {
    this.releaseSource();
    this.video.remove();
  }
}
