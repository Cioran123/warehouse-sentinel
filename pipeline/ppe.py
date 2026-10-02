"""Hard-hat and robot cues for tracked people (no PPE model needed).

Stock COCO weights have no hard-hat class, and this footage also has humanoid robots that the
person detector picks up. Each tracked person's head-and-shoulders crop goes through two cues:

  * CLIP zero-shot (ViT-B/32) against prompts for hard hats, bare heads, caps, and robots.
  * A color veto on the crown: solid saturated or bright-white pixels mean a shell is there,
    whatever CLIP thought (CLIP confuses orange hard hats with orange hair).

Per box the result is "hat", "none" (bare head or a soft cap: neither is a hard hat), "robot",
or "unknown". candidates.py only acts on a track whose labels agree over several frames, and
the verifier still reviews the clip. A real PPE model can replace HeadClassifier without
touching the checks.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

MIN_HEAD_PX = 9
MIN_BOX_H = 0.07  # normalized; smaller people are too far for a usable head crop
KP_CONF = 0.3
HEAD_KP = (0, 1, 2, 3, 4)  # nose, eyes, ears
CLIP_MODEL = os.environ.get("SENTINEL_PPE_CLIP", "ViT-B/32")

PROMPTS = {
    "hat": [f"a worker wearing a {c} hard hat" for c in ("orange", "pink", "white", "blue", "yellow", "gray", "red")]
           + ["a person wearing a plastic safety helmet"],
    "none": ["a person with short black hair and no hat", "a person with curly hair and no hat",
             "a person with long hair and no hat", "a bald person with no hat", "the back of a person's bare head",
             "a person wearing a baseball cap"],
    "robot": ["a humanoid robot", "a black robot head", "a teal and white robot"],
}


def head_crop(frame: np.ndarray, box: list[float], kp: list[list[float]] | None) -> np.ndarray | None:
    """Pixels of the crown: the top of the box, centered on the head when keypoints exist."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    size = max((y2 - y1) * 0.12, 1.0)
    cx = (x1 + x2) / 2
    bottom = y1 + size * 0.6
    if kp:
        pts = [(kp[i][0] * w, kp[i][1] * h) for i in HEAD_KP if kp[i][2] >= KP_CONF]
        if pts:
            cx = float(np.mean([p[0] for p in pts]))
            bottom = max(y1 + size * 0.5, float(np.mean([p[1] for p in pts])) - size * 0.15)
    return _cut(frame, cx - size * 0.45, y1, cx + size * 0.45, bottom)


def head_shoulders(frame: np.ndarray, box: list[float]) -> np.ndarray | None:
    """A square around the head and shoulders, the framing CLIP's prompts describe."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    side = max(x2 - x1, (y2 - y1) * 0.32, 24)
    cx = (x1 + x2) / 2
    return _cut(frame, cx - side / 2, y1 - side * 0.08, cx + side / 2, y1 + side)


def _cut(frame: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> np.ndarray | None:
    h, w = frame.shape[:2]
    a, b = int(max(0, x1)), int(min(w, x2))
    c, d = int(max(0, y1)), int(min(h, y2))
    if b - a < MIN_HEAD_PX or d - c < MIN_HEAD_PX // 2:
        return None
    return frame[c:d, a:b]


def color_says_hat(crop: np.ndarray | None) -> bool:
    """True when the crown is mostly a solid saturated or bright-white shell."""
    if crop is None or crop.size == 0:
        return False
    crown = crop[: max(1, crop.shape[0] // 2)]
    hsv = cv2.cvtColor(crown, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(np.int32)
    hue, sat, val = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    skin = ((hue <= 25) | (hue >= 170)) & (sat >= 45) & (sat <= 150) & (val >= 55) & (val <= 235)
    shell = (((sat >= 120) & (val >= 120)) | ((val >= 200) & (sat <= 110))) & ~skin
    return float(shell.mean()) >= 0.3


class HeadClassifier:
    """Batched CLIP zero-shot over head-and-shoulders crops, loaded on first use."""

    def __init__(self, device: str | None = None) -> None:
        self.device = device
        self._model = None

    def _load(self):
        import clip
        import torch

        dev = self.device if self.device in ("cuda", "mps") else "cpu"
        model, preprocess = clip.load(CLIP_MODEL, device=dev)
        prompts = [p for v in PROMPTS.values() for p in v]
        self._owner = [k for k, v in PROMPTS.items() for _ in v]
        with torch.no_grad():
            text = model.encode_text(clip.tokenize(prompts).to(dev)).float()
            self._text = text / text.norm(dim=-1, keepdim=True)
        self._model, self._preprocess, self._dev = model, preprocess, dev

    def classify(self, frame: np.ndarray, boxes: list[dict]) -> None:
        """Sets box["ppe"] on every box big enough to judge."""
        import torch
        from PIL import Image

        todo = [(b, head_shoulders(frame, b["box"])) for b in boxes if b["box"][3] - b["box"][1] >= MIN_BOX_H]
        todo = [(b, c) for b, c in todo if c is not None]
        if not todo:
            return
        if self._model is None:
            self._load()
        batch = torch.stack([self._preprocess(Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB))) for _, c in todo])
        with torch.no_grad():
            img = self._model.encode_image(batch.to(self._dev)).float()
            img = img / img.norm(dim=-1, keepdim=True)
            probs = (100 * img @ self._text.T).softmax(dim=-1).cpu().numpy()
        for (b, _), p in zip(todo, probs):
            best: dict[str, float] = {}
            for k, v in zip(self._owner, p):
                best[k] = max(best.get(k, 0.0), float(v))
            label = max(best, key=best.get)
            if label != "robot" and color_says_hat(head_crop(frame, b["box"], b.get("kp"))):
                label = "hat"
            b["ppe"] = label if best[label] >= 0.35 else "unknown"
