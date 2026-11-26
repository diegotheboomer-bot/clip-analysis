import json
from pathlib import Path
import tempfile
import unittest
from prepare_dataset import prepare


class SplitTests(unittest.TestCase):
    def fixture(self, root):
        source = root / "export"
        (source / "images").mkdir(parents=True)
        images = []
        for n, group in enumerate(["game-a", "game-a", "game-b", "game-c"], 1):
            name = f"images/{n}.jpg"
            (source / name).write_bytes(bytes([n]))
            images.append(dict(id=n, file_name=name, width=1280, height=720, match_group=group))
        (source / "annotations.json").write_text(json.dumps(dict(images=images, annotations=[], categories=[dict(id=1, name="ball")])))
        return source

    def test_complete_matches_never_cross_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = self.fixture(root)
            result = prepare(source, root / "prepared", ["game-b"], ["game-c"])
            self.assertEqual(result, {"train": {"game-a": 2}, "val": {"game-b": 1}, "test": {"game-c": 1}})
            self.assertEqual((root / "prepared/images/1.jpg").read_bytes(), b"\1")
            with self.assertRaises(FileExistsError):
                prepare(source, root / "prepared", ["game-b"], ["game-c"])

    def test_refuses_shared_validation_and_test_match(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "both validation and testing"):
                prepare(self.fixture(root), root / "prepared", ["game-b"], ["game-b"])

    def test_refuses_implicit_random_frame_split(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaisesRegex(ValueError, "Choose separate"):
                prepare(self.fixture(root), root / "prepared")


if __name__ == "__main__":
    unittest.main()
