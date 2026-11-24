"""PitchCam fixed-camera tracking pilot. Run with --help for the three steps."""
import argparse
import base64
import json
import math
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import cv2

from events import Events, Tracks
from pitch import Pitch, line_segments


def jpeg(frame):
    ok, data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        raise ValueError("Could not encode the frame")
    return "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")


def open_video(path):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError(f"Could not open {path}")
    return cap


def calibration_page(args):
    cap = open_video(args.video)
    try:
        ok, image = cap.read()
        if not ok:
            raise ValueError("Could not read the first frame")
    finally:
        cap.release()
    overlay = image.copy()
    for x, y, u, v in line_segments(image):
        cv2.line(overlay, (x, y), (u, v), (0, 170, 255), 2, cv2.LINE_AA)
    template = Path(__file__).with_name("calibrate.html").read_text()
    args.output.write_text(template.replace("FRAME_DATA", jpeg(image)).replace("LINES_DATA", jpeg(overlay)))


def sample(args):
    cap = open_video(args.video)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not (math.isfinite(fps) and 0 < args.hz <= fps and 0 < args.seconds < math.inf):
            raise ValueError("Check sample rate, video frame rate, and duration")
        step = 1 / args.hz
        print(f"Up to {math.ceil(args.seconds * args.hz)} detector requests.", file=sys.stderr)
        with args.output.open("x") as out:
            due, first_ms, last_t = 0.0, None, -1.0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                stamp = cap.get(cv2.CAP_PROP_POS_MSEC)
                if first_ms is None:
                    first_ms = stamp
                    out.write(json.dumps(dict(version=1, image_size=[frame.shape[1], frame.shape[0]],
                                              kits=[args.us, args.them])) + "\n")
                t = (stamp - first_ms) / 1000
                if not math.isfinite(t) or t <= last_t:
                    raise ValueError("Cannot read increasing video timestamps. Re-encode the segment as a constant-frame-rate clip.")
                last_t = t
                if t >= args.seconds:
                    break
                if t + 1e-6 < due:
                    continue
                due = (math.floor((t + 1e-6) / step) + 1) * step
                body = dict(image=jpeg(frame), myTeamColour=args.us, opponentColour=args.them)
                request = Request("http://localhost:3000/api/detect", data=json.dumps(body).encode(),
                                  headers={"Content-Type": "application/json"})
                with urlopen(request, timeout=120) as response:
                    detection = json.load(response)["detection"]
                out.write(json.dumps(dict(time=t, detection=detection)) + "\n")
                out.flush()
            if first_ms is None:
                raise ValueError("No readable frames")
    finally:
        cap.release()


def report(args):
    with args.samples.open() as stream:
        meta = json.loads(next(stream, "{}"))
        if meta.get("version") != 1:
            raise ValueError("Missing observation header")
        size = meta["image_size"]
        pitch = Pitch(json.loads(args.pitch.read_text()), size)
        tracks, events = Tracks(), Events(pitch)
        frames = []
        for line in stream:
            row = json.loads(line)
            t, detection = float(row["time"]), row["detection"]
            if not math.isfinite(t) or t < 0:
                raise ValueError("Invalid frame time")
            players = []
            for person in detection["people"]:
                xy = pitch.locate(person["box"], size)
                if xy is not None:
                    players.append(dict(xy=xy, box=person["box"], team=person["team"]))
            tracks.update(players, t)
            ball_box = detection["ball"]
            ball = pitch.locate(ball_box, size, ball=True) if ball_box else None
            owner = events.observe(t, ball, players)
            frames.append(dict(time=t, players=players, ball_ground_projection=ball,
                               ball_box=ball_box, ball_track_id=events.ball_track if ball is not None else None,
                               control_candidate=owner))
        if len(frames) < 2:
            raise ValueError("Need at least two observations to measure elapsed time")
    result = dict(image_size=size, kits=meta.get("kits"), max_landmark_error_m=pitch.error,
                  observed_control_seconds=events.seconds, events=events.events, frames=frames)
    encoded = json.dumps(result, allow_nan=False)
    args.output.write_text(encoded + "\n")
    if args.review:
        template = Path(__file__).with_name("review.html").read_text()
        args.review.write_text(template.replace("REPORT_DATA", encoded.replace("<", r"\u003c")))
    print(f"{len(frames)} samples, {len(events.events)} events to review.")
    for team, seconds in events.seconds.items():
        print(f"{team}: {seconds:.2f} s")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    cal = commands.add_parser("calibrate", help="make a clickable calibration page from the first frame")
    cal.add_argument("video", type=Path)
    cal.add_argument("output", type=Path, help="local HTML file")
    cal.set_defaults(run=calibration_page)
    capture = commands.add_parser("sample", help="collect and cache timestamped /api/detect responses")
    capture.add_argument("video", type=Path)
    capture.add_argument("output", type=Path, help="new JSONL file")
    capture.add_argument("--us", required=True)
    capture.add_argument("--them", required=True)
    capture.add_argument("--seconds", type=float, default=6)
    capture.add_argument("--hz", type=float, default=4)
    capture.set_defaults(run=sample)
    analysis = commands.add_parser("report", help="track players and infer event candidates offline")
    analysis.add_argument("samples", type=Path)
    analysis.add_argument("pitch", type=Path)
    analysis.add_argument("output", type=Path)
    analysis.add_argument("--review", type=Path, help="also write a local frame-by-frame HTML viewer")
    analysis.set_defaults(run=report)
    args = parser.parse_args()
    try:
        args.run(args)
    except (OSError, ValueError, KeyError, URLError, cv2.error) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
