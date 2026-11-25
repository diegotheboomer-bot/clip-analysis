# PitchCam Team Review

Import several match videos, generate ball proposals on the organiser's computer, and give each friend a personal four-digit code. The server assigns disjoint batches of 20 frames. Reviewers correct the box, mark visibility, and save directly to the shared database.

Live app: https://pitchcam-team-review.skillfulkumquat.chatgpt.site/

The organiser key is supplied privately. Open **Organiser access** and enter it, or open the private organiser link once. Keep that key out of GitHub and invitations.

## Workflow

1. In **Clips & imports**, enter a project and match identity. All clips from the same physical match must use the same identity, including cropped or re-encoded excerpts.
2. Choose several local videos and a sampling interval. Start **Pre-label & import** in desktop Chrome or Edge. Leave the tab and computer awake. The browser reads and seeks local video files without uploading entire videos. It uploads sampled original-resolution JPEGs and two nearby context frames.
3. AI runs in a background worker using WebGPU where available and WebAssembly otherwise. Large files are processed one frame at a time. Pause after the current frame, then select the same files and settings to resume. A clip becomes available to reviewers only when every sampled frame is imported.
4. Create one personal code per person under **Reviewers & codes**. Copy their invitation and send it privately. Each code keeps its unfinished work until the organiser releases it. Pausing access or resetting a code revokes existing sessions.
5. Reviewers check the AI box, pinch with two fingers to zoom and pan, drag one finger corner to corner to replace it, or remove it. They choose Visible, Partly covered, Not visible, or Unsure. Before/After images provide movement context. **Save & next** waits for the shared save; a failed save retains the local draft.
6. **Labels & training** shows human/AI comparisons. Use **Review label** to correct a reviewed frame as the organiser. The training ZIP includes the final labels and previous saved revisions. No GPU rental is needed for annotation. Training later uses the same dataset on the RTX 5060 or a rented NVIDIA GPU.

## Model and label provenance

The initial proposal model is pretrained **YOLOX-S**, under Apache 2.0. It has **not** been trained on the user's PitchCam labels. It can confuse white boots with balls and miss distant balls. A proposal is never accepted for training until a human saves the answer. No proposal does not automatically mean no ball.

Inference uses BGR 0–255 input, 640 × 640 top-left letterboxing, COCO sports-ball class 32, and the raw YOLOX stride decoder. It evaluates the full frame and eight overlapping crops. Custom ONNX models must use the same preprocessing, 640 × 640 input, and raw `[1,8400,85]` COCO or `[1,8400,6]` one-class output, without decoding/NMS embedded. RF-DETR and Ultralytics exports need their own inference adapters before replacing this model.

The exact ONNX SHA-256, model name, proposal confidence, original pixel box, human answer, reviewer, source clip, timestamp, and match group are retained. The model is stored privately in R2 and loaded only by an organiser. Browser inference loads the pinned ONNX Runtime Web 1.23.2 library from jsDelivr; footage and tensors remain in the browser during inference. Images are uploaded to the app's own storage for review.

Training ZIP contents

- `annotations.json` and `images/` contain human-reviewed COCO data at source resolution.
- `reviews.json` retains AI proposals and all final human answers, including uncertainty.
- `label-history.json` retains every saved revision, its operation ID and timestamp.
- Visible and partially visible balls use boxes around the visible extent. Confirmed outside-frame examples are negatives. Hidden/unknown/unsure frames remain in history and are excluded from the training image set.

Use `training/prepare_dataset.py` to prepare snapshots with separate matches for training, validation and testing. Never randomly split neighbouring frames from the same match. The 55 imported starter images belong to one unconfirmed match group, so they do not provide an independent test set.

## Access and storage

Cloudflare D1 stores assignments, labels and history; R2 stores frames, context and the model. Nothing depends on one reviewer's browser storage. A local draft is only a recovery aid. The public shell contains no footage. Server checks protect every image and API call. A reviewer can read only their assigned frames; organiser routes require an organiser session. Codes are HMAC-hashed, sessions use HttpOnly/Secure/SameSite cookies, and login attempts are rate-limited per IP. Four-digit codes are intended for a small invited pilot team; share them privately.

Optimistic versions reject stale edits after reassignment. Operation IDs make save retries idempotent. Completed frames are excluded from new assignments. The organiser can release unfinished work without discarding saved labels.

## Development

Requires Node.js 24 and npm. From this directory

```sh
npm ci
npm test
```

For local development, create ignored `.dev.vars` containing a strong `APP_SECRET`, then run `npm run dev`. Wrangler uses local D1/R2 emulation. Local development uses port 4173. The checked-in database identifier is an emulator placeholder; production bindings are provisioned by Sites using `.openai/hosting.json`.

`npm run db:generate` generates Drizzle migrations after schema changes. `npm run build` bundles the Worker and browser assets into `dist/server/index.js`. Hosted deployments must include the manifest, Worker and `drizzle/` migrations. Preserve the existing Sites project ID when updating this site.

Never commit `.dev.vars`, model binaries, session cookies, reviewer codes, organiser links or uploaded footage. A separately configured Cloudflare deployment can use its own D1 and R2 identifiers in `wrangler.jsonc`.

## Current limits

This phase annotates the match ball. It does not yet train a model, infer reliable passes/possession, track identities, or label pitch lines and teams. Browser imports require a desktop browser and an open tab; mobile is optimised for human review. Sampling reduces annotation volume and is not continuous tracking ground truth. For a tracking model, also collect dense sequences with occlusions and reappearances. The organiser comparison view shows the latest 200 labels; the export includes the entire saved dataset.

## Fast absence labels

**Outside & next** saves a confirmed outside-frame example and advances with one tap. **Can't tell & next** saves uncertainty and advances. Choose the latter when you lost the ball but cannot tell where it went.

For longer gaps, use **Mark several frames**, tap the last thumbnail to include (or **Select all shown**), choose Outside frame, Hidden or Can't tell, then **Mark N frames**. The range is limited to this clip and up to 20 assigned frames. Saved reviews are kept. The group is saved atomically, so a stale or reassigned frame prevents the entire group from being changed. Retry requests reuse operation IDs. Only confirmed outside-frame answers become training negatives.

New imports include private 320-pixel thumbnails for the range grid. Original images remain at source resolution for drawing and training. Older clips fall back to their existing original image.

## Import recovery

The reader waits for metadata and decoded-frame readiness with event and polling checks. A media failure reopens the clip once and resumes its saved frame records. Failed clips are listed by filename while the queue continues. Retry failed clips reuses the selected files and original settings. Completed clips are skipped before decoding or AI loading. Wait time in hidden tabs is excluded from the media timeout; keep the computer awake during imports. The browser requests a screen wake lock when supported.
