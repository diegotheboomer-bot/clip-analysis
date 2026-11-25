# PitchCam ball labelling

A static browser app for reviewing the active match ball in prepared video frames.
The included batch has 72 frames from Assist.mp4, Attempt.mp4 and GOAL.mp4, each
with a neighbouring frame before and after. The original video dimensions are
preserved, including the 640 × 360 GOAL.mp4 export.

## Send to friends

Share the GitHub Pages address. Each person can optionally enter their name under
Results. They pinch with two fingers to zoom, move both fingers to pan, then drag one
finger from one corner of the ball to the opposite corner to draw its box.
Dragging again replaces the box. They choose visibility and save. A tap opens
the magnified view, which also supports pinch zoom and box drawing.

Before and After display context only. All coordinates belong to This frame.
A partial ball's box encloses the visible pixels, including blur. Hidden balls
have no estimated location. The labeller follows the active match ball.

Progress and drafts are stored in localStorage in the current browser. Opening
the same link in another browser starts a separate review. Clearing site data
removes local work. Results → Share results uses the phone's share sheet when
file sharing is supported. Download results is available in every browser.
Reviewers send that JSON file back to the organiser.

The app has no shared database or automatic collection. Names and results stay
on the reviewer's device until they share the file. The included frame images
are public when hosted on the public repository and GitHub Pages.

## Collect labels

Open Results → Collect reviews & export training labels. Import the files sent
by reviewers. Importing the same file twice is safe. A newer export from the
same reviewer replaces their older submission. Conflicting answers require a
choice with a frame preview. Reviewers' answers are preserved in local storage.

Download COCO labels after resolving conflicts. The file uses native image
pixels and COCO boxes in [x, y, width, height] order. File names refer to the
media directory in this repository.

- Visible and partially covered balls export boxes with occlusion and edge
  clipping attributes. Boxes cover the visible extent.
- Confirmed outside-frame answers export negative images with no ball box.
- Hidden, uncertain, skipped and unresolved frames are excluded from training.
  The export retains resolved review decisions for later inspection.
- All current clips share match-unconfirmed-01 as their match group because
  their match identities have not been established. Keep the whole group in one
  split. Establish match identities before using future clips for evaluation.

Annotations are human reviews, including unchecked reviews. Before training,
the organiser should inspect samples and all disputed frames. Keep whole
matches apart when splitting training and evaluation.

## Run locally

From the repository root, start a static server.

```sh
python -m http.server 3000 --directory label
```

Open http://localhost:3000. The annotation tool does not call Gemini or require
the Next.js app, Supabase or API credentials.

## Prepare another batch

The batch builder needs Python and OpenCV. Install opencv-python-headless in a
virtual environment and supply an output directory that does not already exist.
Each source takes a label, video path and a start time in seconds. By default it
samples 24 frames at 4 Hz per source, with context four video frames either side.

```sh
python label/prepare_batch.py /tmp/new-batch \
  --source match-a clip-a.mp4 10 \
  --source match-b clip-b.mp4 20 \
  --group new-match
```

Inspect the generated images, then replace label/batch.json and label/media/
with the generated batch. A batch ID includes image hashes so replacement frames
start a separate local review. The --group value must identify a match or an
unverified group that will stay together in training/evaluation splits. Build
separate batches for separate known matches.

## Publish updates

GitHub Pages serves the gh-pages branch. From a checkout containing reviewed
changes, publish the label directory.

```sh
python label/publish.py
```

For a first deployment, choose gh-pages and / (root) under repository Settings →
Pages → Deploy from a branch. Enabling Pages requires repository settings access.

## Verify changes

```sh
node --test label/core.test.mjs label/gestures.test.mjs
```

The browser workflow was also checked with Chromium at desktop and mobile
viewports, covering taps, pinch zoom, two-finger pan, drag boxes, gesture
cancellation, one-pixel box changes, context frame protection,
draft restoration, JSON downloads, reviewer conflicts and COCO coordinates.
