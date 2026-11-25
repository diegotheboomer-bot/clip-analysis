"""Publish the committed label directory to the repository's GitHub Pages branch."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(*args, **kwargs):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, text=True, **kwargs)


def publish():
    if git("status", "--porcelain", "--", "label", capture_output=True).stdout.strip():
        raise ValueError("Commit changes in label/ before publishing.")
    tree = git("rev-parse", "HEAD:label", capture_output=True).stdout.strip()
    existing = git("ls-remote", "--heads", "origin", "gh-pages", capture_output=True).stdout.strip()
    parents = []
    if existing:
        git("fetch", "origin", "gh-pages")
        parent = git("rev-parse", "FETCH_HEAD", capture_output=True).stdout.strip()
        old_tree = git("rev-parse", parent + "^{tree}", capture_output=True).stdout.strip()
        if old_tree == tree:
            print("GitHub Pages already has this version.")
            return
        parents = ["-p", parent]
    commit = git("commit-tree", tree, *parents, "-m", "Publish PitchCam ball labelling",
                 capture_output=True).stdout.strip()
    git("push", "origin", commit + ":refs/heads/gh-pages")


if __name__ == "__main__":
    try:
        publish()
    except (ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
