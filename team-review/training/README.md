# Preparing for a local or rented GPU

Download **Labels & training → Download training ZIP** in the organiser dashboard. Keep each original ZIP as an immutable dataset snapshot. The same images and COCO labels work on your RTX 5060 and on a rented NVIDIA GPU. GPU choice changes training speed, VRAM capacity and batch size; it does not change the labels you need.

Use Python 3.10 or newer. This helper needs no extra packages. In Windows PowerShell, from this app directory

```powershell
py training/prepare_dataset.py "$HOME/Downloads/pitchcam-training.zip" prepared --train-only
```

On Linux

```sh
python3 training/prepare_dataset.py pitchcam-training.zip prepared --train-only
```

When you have at least three separate matches, reserve complete matches for validation and testing

```sh
python3 training/prepare_dataset.py pitchcam-training.zip prepared \
  --validation-match "Club A vs Club B" \
  --test-match "Club C vs Club D"
```

All other matches become training data. You can repeat the match options to hold out more matches. The output has `images/`, `annotations/train.json`, `annotations/val.json`, `annotations/test.json`, and a split manifest. Image paths in the COCO files are relative to the output root. The command refuses to overwrite an existing dataset folder.

Do not measure model improvement using adjacent frames from the same match in both training and testing. Clips from the same game, including excerpts, need one shared match identity. The existing 55 starter images belong to a single unconfirmed match, so only the training-only option is appropriate for that batch.

The app preserves uncertain/hidden answers in the original export but leaves those images out of training. White-boot mistakes corrected by reviewers remain useful negative evidence within correctly labelled images. Confirmed outside-frame images have no ball annotation and are explicit negatives.

Before renting a GPU, prepare the reviewed ZIP, grouped split, exact model/code version, a dependency file and a training command that first completes a small batch locally. Save checkpoints to persistent storage. Use a one-class detector for the match ball and measure small-ball recall, false positives on boots/lines, and performance on the held-out matches.

YOLOX offers Apache-2.0 code and the compatible export format for this app. Use the model's training repository with COCO dataset paths adapted to this output. RF-DETR is another option after checking the chosen model/code/weight licences; its exported model requires a new adapter in this app. This helper prepares data and does not start training or claim a custom PitchCam model exists yet.
