"""
White-out exterior black backdrop without chromakey (keeps goggles/hat black).
Fast path: colored seeds → dilate → erode outer black fringe (no flood fill).
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def dilate(mask_u8: Image.Image, times: int, size: int = 5) -> Image.Image:
    out = mask_u8
    for _ in range(times):
        out = out.filter(ImageFilter.MaxFilter(size))
    return out


def erode(mask_u8: Image.Image, times: int, size: int = 3) -> Image.Image:
    out = mask_u8
    for _ in range(times):
        out = out.filter(ImageFilter.MinFilter(size))
    return out


def protect_character(rgb: np.ndarray) -> np.ndarray:
    seed = rgb.max(axis=2) > 30
    seed_img = Image.fromarray((seed.astype(np.uint8) * 255))
    # Pull in black clothing / hat / frames next to color.
    grown = dilate(seed_img, times=10, size=5)
    # Cut outer black silhouette that was invisible on black bg.
    cut = erode(grown, times=3, size=3)
    soft = cut.filter(ImageFilter.GaussianBlur(0.8))
    return np.asarray(soft) > 110


def whiten_frame(path: Path) -> None:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im).copy()
    keep = protect_character(rgb)
    rgb[~keep] = (255, 255, 255)
    Image.fromarray(rgb).save(path, format="PNG", optimize=True)


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: whiten_intro_bg.py <input.mp4> <output.mp4>")
        return 2
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    work = Path(tempfile.mkdtemp(prefix="intro_whiten_"))
    frames = work / "frames"
    frames.mkdir()
    try:
        run(["ffmpeg", "-y", "-i", str(src), "-vf", "fps=30", str(frames / "f_%04d.png")])
        paths = sorted(frames.glob("f_*.png"))
        for i, p in enumerate(paths):
            whiten_frame(p)
            if i % 20 == 0:
                print(f"whitened {i + 1}/{len(paths)}", flush=True)
        run(
            [
                "ffmpeg",
                "-y",
                "-framerate",
                "30",
                "-i",
                str(frames / "f_%04d.png"),
                "-vf",
                "scale=720:-2:flags=lanczos,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p",
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-crf",
                "17",
                "-preset",
                "medium",
                "-an",
                "-movflags",
                "+faststart",
                str(dst),
            ]
        )
        print("wrote", dst, dst.stat().st_size)
        return 0
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
