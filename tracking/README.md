# Track a short fixed-camera clip

Use one uninterrupted, lens-corrected, fixed view of a sequence in open play.
For the Pi rig, start with one rectified camera. Each camera needs its own
calibration. A cylindrical stitched panorama, a cut, or an auto-follow crop can
invalidate a single homography. Use actual pitch and goal dimensions for the
age group. Coordinates use metres from one pitch corner and x along its length.

From the repo root, with Python 3.10+:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r tracking/requirements.txt
python tracking/track.py calibrate clip.mp4 calibration.html
```

1. Open `calibration.html` locally. Toggle the line overlay to inspect candidate
   painted segments. White kits, other sports' markings and fences can also
   appear. Click at least four widely separated known intersections and enter
   their measured coordinates. Add at least one separate check, ideally at the
   far side or near the goal being analysed. Enter dimensions and attacking
   direction and save `pitch.json` alongside the clip.
2. Start the existing app with `npm run dev` on port 3000 and its configured
   Gemini key. The sampler calls the existing local detector once per sampled
   image. The default six seconds at 4 Hz makes up to 24 requests. Those calls
   are billable at the detector's rate. Detections are cached on disk and can
   be corrected and replayed offline. A failed request stops sampling and
   preserves completed rows.
3. Run the pilot and open `review.html`. Select the same source video. Scrub
   the samples or jump to either end of a proposed event.

```sh
python tracking/track.py sample clip.mp4 frames.jsonl --us red --them blue
python tracking/track.py report frames.jsonl pitch.json report.json --review review.html
```

### Reading a result

- Each sample includes player boxes, kit labels, local track IDs and foot
  positions. The tracker uses gated one-to-one distance matching. Close
  crossings can split a track. A track ID only identifies a short sequence.
- The ball has a projected point and a track ID. A missing ball, long gap or
  implausible jump starts a new track. The ground projection of a ball in the
  air can be several metres from its true horizontal position.
- The calibration must fit both the anchors and the held-out checks within
  1.5 m. Positions and control use only the area enclosed by the anchors.
  The reported maximum landmark error describes the landmarks tested.
- Control time is the interval between adjacent samples with the same
  unambiguously nearby, kit-labelled player. Loose, contested and unseen
  intervals go to **unknown**. The three durations sum to last sample time
  minus first sample time. Dead-ball time needs manual exclusion. A goalkeeper
  with only the generic keeper label cannot earn team possession.
- A pass candidate needs established control, a visible loose ball and
  subsequent control by a different teammate. A shot candidate needs a fast
  release toward the configured goal mouth observed near the goal. Crosses can
  trigger it, and blocked or wide shots can be missed. These rules are initial
  heuristics. The event timestamps and control estimates depend on sample rate.

### First club trial

Use several 6–10 second clips from different matches covering a clean pass, a
turnover, a cross, a shot and a sequence where the far-side ball disappears.
Hand-label ball visibility, player/team IDs, control intervals and event times
before checking the report. Score ball recall on visible samples, ID switches,
team mistakes, known-control coverage and pass/shot precision and recall.
Review false shots on crosses and unknown time alongside the headline numbers.
Reserve whole matches for evaluation when training the local detector.

The first JSONL line contains version 1, the image size and kits. Each following
line has `time` in seconds and the existing `/api/detect` response's `detection`
object. A future local model can supply that same file. Boxes are
`[top, left, bottom, right]` on the app's 0–1000 scale. Use JSON null for an
unseen ball. Local generated files contain match footage or observations.

```sh
python -m unittest discover -s tracking -v
```
