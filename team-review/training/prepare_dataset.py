"""Create COCO snapshots using whole-match splits, on Windows or Linux.

Python 3.10+, no third-party packages. Input can be a downloaded training ZIP
or its extracted directory. Files are copied, so the original export is kept.
"""
import argparse
from collections import Counter
import json
from pathlib import Path, PurePosixPath
import shutil
import zipfile


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError(f"Unsafe image path: {name}")
    return path


def prepare(source, output, validation_matches=(), test_matches=(), train_only=False):
    archive = zipfile.ZipFile(source) if source.is_file() else None

    def open_file(name):
        safe_name(name)
        return archive.open(name) if archive else (source / name).open("rb")

    try:
        with open_file("annotations.json") as stream:
            data = json.load(stream)
        images = data["images"]
        if not images:
            raise ValueError("There are no human-reviewed training images yet.")
        groups = {image.get("match_group") for image in images}
        if None in groups or "" in groups:
            raise ValueError("Every image needs a physical match identity.")
        validation, testing = set(validation_matches), set(test_matches)
        if validation & testing:
            raise ValueError("A match cannot be in both validation and testing.")
        if (validation | testing) - groups:
            raise ValueError("Unknown match name. Available matches: " + ", ".join(sorted(groups)))
        if train_only and (validation or testing):
            raise ValueError("Choose train-only or held-out matches.")
        if not train_only and (not validation or not testing):
            raise ValueError("Choose separate --validation-match and --test-match values, or use --train-only.")
        if not (groups - validation - testing):
            raise ValueError("Leave at least one complete match for training.")
        ids = {image["id"] for image in images}
        if len(ids) != len(images):
            raise ValueError("Duplicate image IDs in export.")
        if any(a["image_id"] not in ids for a in data["annotations"]):
            raise ValueError("An annotation refers to an unknown image.")
        for image in images:
            name = str(safe_name(image["file_name"]))
            if not name.startswith("images/"):
                raise ValueError("Expected image files under images/.")
        output.mkdir(parents=True, exist_ok=False)
        (output / "annotations").mkdir()
        splits = {key: [] for key in ("train", "val", "test")}
        for image in images:
            group = image["match_group"]
            split = "test" if group in testing else "val" if group in validation else "train"
            splits[split].append(image)
            destination = output / image["file_name"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            with open_file(image["file_name"]) as src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        for split, selected in splits.items():
            selected_ids = {image["id"] for image in selected}
            payload = {
                **{key: value for key, value in data.items() if key not in ("images", "annotations")},
                "images": selected,
                "annotations": [a for a in data["annotations"] if a["image_id"] in selected_ids],
            }
            (output / "annotations" / f"{split}.json").write_text(json.dumps(payload), encoding="utf-8")
        summary = {split: dict(Counter(i["match_group"] for i in selected)) for split, selected in splits.items()}
        (output / "split-manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return summary
    finally:
        if archive:
            archive.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--validation-match", action="append", default=[])
    parser.add_argument("--test-match", action="append", default=[])
    parser.add_argument("--train-only", action="store_true")
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.output, args.validation_match, args.test_match, args.train_only)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + "\n")
    print(json.dumps(result, indent=2))
    if args.train_only:
        print("Training-only snapshot. Add different matches before measuring validation/test accuracy.")
