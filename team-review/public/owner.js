import { api } from "./team-router.js";
import { importClips, resetModel } from "./importer.js";
const $ = (id) => document.getElementById(id);
let busy = false,
  pause = false,
  invitation = "",
  retrySettings = null;
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
  const chosenMember=$('batch-member').value,chosenMatch=$('batch-match').value;
  const memberOptions=[['','New reviewer'],...data.members.filter(m=>m.active).map(m=>[m.id,m.name])];
  for(const [id,choices,chosen] of [['batch-member',memberOptions,chosenMember],['batch-match',[...new Set(data.clips.filter(c=>c.status==='ready').map(c=>c.match_group))].map(m=>[m,m]),chosenMatch]]){
    $(id).replaceChildren(...choices.map(([value,name])=>{const o=el('option',name);o.value=value;return o;}));if(choices.some(([v])=>v===chosen))$(id).value=chosen;
  }
  const work=await api('/api/admin/review-jobs');
  $('batch-list').replaceChildren(...work.jobs.map(j=>{const card=el('article',undefined,'job-card');card.append(el('strong',j.title),el('p',j.reviewer_name),el('p',`${j.done||0} / ${j.total} completed · ${j.locked?'Locked until ball is done':Number(j.done)===Number(j.total)?'Completed':'Ready'}`));return card;}));
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
  let batchRequest=null;
  $('batch-form').onsubmit=async event=>{
    event.preventDefault();event.submitter.disabled=true;
    try{
      batchRequest ||= crypto.randomUUID();
      const result=await api('/api/admin/review-bundles',{method:'POST',body:JSON.stringify({requestId:batchRequest,memberId:$('batch-member').value||undefined,name:$('batch-name').value||'Friend reviewer',matchGroup:$('batch-match').value,count:Number($('batch-count').value)})});
      $('batch-invite').hidden=false;$('batch-invite').replaceChildren(el('strong',result.code?'Code: '+result.code:'Use this reviewer’s existing code'),el('p',location.origin+'/?batches=1'),el('p','First: ball frames. Then: pitch lines. Everything saves to the site; no files to send back.'));
      $('batch-feedback').textContent='Batches created. Share the link and code privately.';batchRequest=null;await refresh();
    }catch(e){$('batch-feedback').textContent=e.message;}finally{event.submitter.disabled=false;}
  };
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
  async function run(settings) {
    if (busy) return;
    busy = true;
    pause = false;
    retrySettings = null;
    $("retry-import").hidden = true;
    $("import-failures").replaceChildren();
    $("start-import").disabled = true;
    $("pause-import").hidden = false;
    $("pause-import").disabled = false;
    $("import-progress").hidden = false;
    for (const id of [
      "video-files",
      "project-name",
      "match-name",
      "sample-interval",
      "model-name",
    ])
      $(id).disabled = true;
    let lock;
    try {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {}
      const result = await importClips({
        ...settings,
        onStatus: (text) => ($("import-status").textContent = text),
        onProgress: (value) => ($("import-progress").value = value),
        paused: () => pause,
      });
      for (const failure of result.failed)
        $("import-failures").append(
          el("li", failure.file.name + " — " + failure.message),
        );
      const remaining = [
        ...new Set([...result.failed.map((f) => f.file), ...result.remaining]),
      ];
      if (remaining.length) {
        retrySettings = { ...settings, files: remaining };
        $("retry-import").hidden = false;
        $("retry-import").textContent = result.paused
          ? "Resume remaining clips"
          : "Retry failed clips";
      }
    } catch (error) {
      $("import-status").textContent =
        error.message +
        " Completed frames are saved. Choose the same clips and settings to resume.";
    } finally {
      try {
        await lock?.release();
      } catch {}
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
      await refresh().catch((error) => message(error.message));
    }
  }
  $("retry-import").onclick = () => {
    if (!retrySettings) return;
    $("project-name").value = retrySettings.project;
    $("match-name").value = retrySettings.group;
    $("sample-interval").value = String(retrySettings.interval);
    $("model-name").value = retrySettings.modelName;
    run(retrySettings);
  };
  $("import-form").onsubmit = (event) => {
    event.preventDefault();
    const files = [...$("video-files").files];
    if (!files.length || busy) return;
    run({
      files,
      project: $("project-name").value.trim(),
      group: $("match-name").value.trim(),
      interval: Number($("sample-interval").value),
      modelName: $("model-name").value.trim(),
    });
  };
}
