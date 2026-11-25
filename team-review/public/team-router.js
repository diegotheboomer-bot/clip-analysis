import { initOwner } from "./owner.js";

export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed. Please retry.");
    error.status = response.status;
    throw error;
  }
  return data;
}
const $ = (id) => document.getElementById(id);
async function enter() {
  let user;
  try {
    user = await api("/api/me");
  } catch (error) {
    if (error.status !== 401) throw error;
  }
  $("loading").hidden = true;
  $("team-login").hidden = Boolean(user);
  $("help-button").hidden = !user || user.role === "owner";
  $("results-button").hidden = !user || user.role === "owner";
  $("sign-out").hidden = !user;
  if (!user) return;
  if (user.role === "owner") {
    const frameId = new URL(location.href).searchParams.get("review");
    if (frameId) {
      const work = await api(
        "/api/admin/review/" + encodeURIComponent(frameId),
      );
      window.PITCHCAM_TEAM = { ...work, user, api };
      $("help-button").hidden = false;
      $("results-button").hidden = false;
      const back = document.createElement("a");
      back.href = "/";
      back.textContent = "Dashboard";
      back.className = "quiet";
      document.querySelector(".header-actions").prepend(back);
      await import("./app.js?team=1");
      return;
    }
    $("owner-dashboard").hidden = false;
    await initOwner();
  } else {
    const work = await api("/api/work", { method: "POST" });
    window.PITCHCAM_TEAM = { ...work, user, api };
    if (!work.batch.frames.length) {
      $("help-button").hidden = true;
      $("results-button").hidden = true;
      $("loading").hidden = false;
      $("loading").textContent =
        "You're all caught up. Your labels are saved. Ask the organiser for more frames, then refresh.";
    } else await import("./app.js?team=1");
  }
}
$("code-form").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ code: $("access-code").value }),
    });
    await enter();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("owner-entry").onclick = () => {
  $("owner-form").hidden = false;
  $("owner-key").focus();
};
$("owner-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api("/api/owner/session", {
      method: "POST",
      body: JSON.stringify({ key: $("owner-key").value }),
    });
    $("owner-key").value = "";
    await enter();
  } catch (error) {
    $("login-error").textContent = error.message;
  }
};
$("sign-out").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.href = "/";
};
async function boot() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("owner")) {
    const key = params.get("owner");
    history.replaceState(null, "", location.pathname);
    await api("/api/owner/session", {
      method: "POST",
      body: JSON.stringify({ key }),
    });
  }
  await enter();
}
boot().catch((error) => {
  $("loading").textContent = error.message;
});
