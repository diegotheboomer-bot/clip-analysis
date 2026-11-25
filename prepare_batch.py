"""Extract a review batch with neighbouring frames, preserving native pixels."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import cv2


def prepare(args):
    if args.count < 1 or not 0 < args.hz <= 60:
        raise ValueError("Choose a positive count and a sample rate up to 60 Hz.")
    if len({source[0] for source in args.source}) != len(args.source):
        raise ValueError("Each source needs a unique label.")
    for name, video, start in args.source:
        if not re.fullmatch(r"[a-z0-9-]+", name):
            raise ValueError("Source labels use lowercase letters, numbers and hyphens.")
        if not Path(video).is_file() or not math.isfinite(float(start)) or float(start) < 0:
            raise ValueError("Check the video path and nonnegative start time.")
    args.output.mkdir(parents=True, exist_ok=False)
    media = args.output / "media"
    media.mkdir()
    frames = []
    digest = hashlib.sha256()
    for name, video, start in args.source:
        cap = cv2.VideoCapture(video)
        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if not cap.isOpened() or not math.isfinite(fps) or fps < args.hz:
                raise ValueError(f"Cannot sample {video} at the requested rate.")
            for i in range(args.count):
                index = round((float(start) + i / args.hz) * fps)
                item = {
                    "id": f"{name}-{index:06d}", "source": Path(video).name,
                    "matchGroup": args.group, "frameIndex": index,
                    "timestampSec": round(index / fps, 6),
                    "contextOffsetSec": round(4 / fps, 6),
                }
                for offset, key in [(0, "image"), (-4, "before"), (4, "after")]:
                    context_index = max(0, index + offset)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, context_index)
                    ok, image = cap.read()
                    if not ok:
                        raise ValueError(f"{video} ends before frame {context_index}. Shorten the batch.")
                    relative = f"media/{name}-{context_index:06d}.jpg"
                    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 93])
                    if not ok:
                        raise ValueError("Image encoding failed.")
                    (args.output / relative).write_bytes(encoded.tobytes())
                    digest.update(encoded.tobytes())
                    item[key] = relative
                    item["width"] = image.shape[1]
                    item["height"] = image.shape[0]
                frames.append(item)
        finally:
            cap.release()
    digest.update(json.dumps(frames, sort_keys=True).encode())
    batch = {
        "id": f"pitchcam-{digest.hexdigest()[:16]}",
        "version": 1, "title": args.title, "frames": frames,
    }
    (args.output / "batch.json").write_text(json.dumps(batch, indent=2))
    print(f"Prepared {len(frames)} frames in {args.output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--source", nargs=3, action="append", required=True,
                        metavar=("LABEL", "VIDEO", "START_SECONDS"))
    parser.add_argument("--group", required=True, help="Match identity for training/evaluation grouping")
    parser.add_argument("--title", default="Ball review")
    parser.add_argument("--count", type=int, default=24)
    parser.add_argument("--hz", type=float, default=4)
    options = parser.parse_args()
    try:
        prepare(options)
    except (OSError, ValueError, cv2.error) as error:
        parser.exit(1, f"{error}\n")
