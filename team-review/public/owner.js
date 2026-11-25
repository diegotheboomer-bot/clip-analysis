import { api } from "./team-router.js";
import { importClips, resetModel } from "./importer.js";
const $ = (id) => document.getElementById(id);
let busy = false,
  pause = false,
  invitation = "";
function message(text) {
  $("owner-feedback").textContent = text;
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function action(text, fn) {
  const button = el("button", text, "secondary");
  button.onclick = async () => {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      message(e.message);
    } finally {
      button.disabled = false;
    }
  };
  return button;
}
async function refresh() {
  const data = await api("/api/admin/dashboard");
  $("clip-list").replaceChildren(
    ...data.clips.map((clip) => {
      const card = el("div", undefined, "clip-card"),
        info = el("div");
      info.append(
        el("strong", clip.title),
        el("p", clip.project + " · " + clip.match_group),
        el(
          "p",
          clip.done +
            " reviewed · " +
            clip.assigned +
            " assigned · " +
            clip.imported +
            " / " +
            clip.expected_frames +
            " imported",
        ),
      );
      card.append(
        info,
        el("span", clip.status === "ready" ? "Ready" : "Import paused"),
      );
      return card;
    }),
  );
  if (!data.clips.length)
    $("clip-list").textContent = "Import your first clips above.";
  $("member-list").replaceChildren(
    ...data.members.map((member) => {
      const card = el("div", undefined, "member-card"),
        info = el("div"),
        buttons = el("div", undefined, "member-actions");
      info.append(
        el("strong", member.name),
        el(
          "p",
          member.done +
            " reviewed · " +
            member.assigned +
            " unfinished · " +
            (member.active ? "Active" : "Paused"),
        ),
      );
      buttons.append(
        action("Reset code", async () => {
          showCode(
            member.name,
            await api("/api/admin/members/" + member.id + "/reset", {
              method: "POST",
            }),
          );
        }),
        action("Release unfinished", async () => {
          await api("/api/admin/members/" + member.id + "/release", {
            method: "POST",
          });
          await refresh();
          message(
            "Unfinished frames returned to the queue. Saved labels were kept.",
          );
        }),
        action(member.active ? "Pause access" : "Resume access", async () => {
          await api("/api/admin/members/" + member.id + "/active", {
            method: "POST",
            body: JSON.stringify({ active: !member.active }),
          });
          await refresh();
        }),
      );
      card.append(info, buttons);
      return card;
    }),
  );
}
function showCode(name, result) {
  $("new-code").hidden = false;
  $("code-recipient").textContent = name + "'s personal code";
  $("generated-code").textContent = result.code;
  invitation =
    "Help label the match ball for PitchCam: " +
    location.origin +
    "/\nYour personal code is " +
    result.code +
    ". Correct the AI box or mark the ball as unseen. Your labels save automatically.";
}
async function reviews() {
  const data = await api("/api/admin/reviews");
  $("review-list").replaceChildren(
    ...data.reviews.map((review) => {
      const tile = el("div", undefined, "review-tile"),
        canvas = document.createElement("canvas"),
        img = new Image();
      canvas.width = 640;
      canvas.height = 360;
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 640, 360);
        for (const [box, color] of [
          [review.proposal?.bbox, "#ffad52"],
          [review.answer.bbox, "#cfff75"],
        ]) {
          if (!box) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(
            (box[0] / img.naturalWidth) * 640,
            (box[1] / img.naturalHeight) * 360,
            (box[2] / img.naturalWidth) * 640,
            (box[3] / img.naturalHeight) * 360,
          );
        }
      };
      img.src = "/media/" + review.id + "/image";
      tile.append(
        canvas,
        el(
          "p",
          review.title +
            " · " +
            review.timestamp_sec.toFixed(2) +
            " s · " +
            (review.reviewer || "Organiser"),
        ),
        el(
          "p",
          review.answer.status.replaceAll("_", " ") +
            " · green human / orange AI",
        ),
      );
      const edit = el("a", "Review label", "secondary button-link");
      edit.href = "/?review=" + encodeURIComponent(review.id);
      tile.append(edit);
      return tile;
    }),
  );
}
export async function initOwner() {
  await refresh();
  const model = await api("/api/admin/model-info");
  $("model-status").textContent = model.ready
    ? model.name + " ready"
    : "Upload a YOLOX ONNX model to start.";
  $("video-files").onchange = () =>
    ($("selected-files").textContent =
      $("video-files").files.length + " clip(s) selected");
  $("member-form").onsubmit = async (event) => {
    event.preventDefault();
    event.submitter.disabled = true;
    try {
      const name = $("member-name").value.trim();
      showCode(
        name,
        await api("/api/admin/members", {
          method: "POST",
          body: JSON.stringify({ name }),
        }),
      );
      $("member-name").value = "";
      await refresh();
    } catch (e) {
      message(e.message);
    } finally {
      event.submitter.disabled = false;
    }
  };
  $("copy-invite").onclick = async () => {
    try {
      await navigator.clipboard.writeText(invitation);
      message("Invitation copied. Send it to this reviewer.");
    } catch {
      message(invitation);
    }
  };
  $("refresh-dashboard").onclick = () =>
    refresh().catch((e) => message(e.message));
  document.querySelectorAll("[data-tab]").forEach(
    (button) =>
      (button.onclick = async () => {
        document
          .querySelectorAll("[data-tab]")
          .forEach((b) => b.classList.toggle("active", b === button));
        for (const tab of ["imports", "people", "reviews"])
          $("owner-" + tab).hidden = tab !== button.dataset.tab;
        try {
          if (button.dataset.tab === "reviews") await reviews();
          else await refresh();
        } catch (error) {
          message(error.message);
        }
      }),
  );
  $("upload-model").onclick = async () => {
    const file = $("model-file").files[0];
    if (!file) return message("Choose an ONNX model first.");
    if (busy) return message("Pause the clip import before changing models.");
    $("upload-model").disabled = true;
    try {
      await api("/api/admin/model", {
        method: "PUT",
        body: file,
        headers: { "x-model-name": $("model-name").value },
      });
      resetModel();
      $("model-status").textContent = "Model uploaded.";
    } catch (e) {
      message(e.message);
    } finally {
      $("upload-model").disabled = false;
    }
  };
  $("pause-import").onclick = () => {
    pause = true;
    $("pause-import").disabled = true;
  };
  $("import-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const files = [...$("video-files").files];
    if (!files.length) return;
    busy = true;
    pause = false;
    $("start-import").disabled = true;
    $("pause-import").hidden = false;
    $("pause-import").disabled = false;
    $("import-progress").hidden = false;
    const settings = {
      files,
      project: $("project-name").value.trim(),
      group: $("match-name").value.trim(),
      interval: Number($("sample-interval").value),
      modelName: $("model-name").value.trim(),
    };
    for (const id of [
      "video-files",
      "project-name",
      "match-name",
      "sample-interval",
      "model-name",
    ])
      $(id).disabled = true;
    try {
      await importClips({
        ...settings,
        onStatus: (text) => ($("import-status").textContent = text),
        onProgress: (value) => ($("import-progress").value = value),
        paused: () => pause,
      });
    } catch (e) {
      $("import-status").textContent =
        e.message +
        " Completed frames are saved. Choose the same clips to resume.";
    } finally {
      busy = false;
      $("start-import").disabled = false;
      $("pause-import").hidden = true;
      for (const id of [
        "video-files",
        "project-name",
        "match-name",
        "sample-interval",
        "model-name",
      ])
        $(id).disabled = false;
      await refresh();
    }
  };
}
