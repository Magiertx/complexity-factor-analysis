"""Packs the PNGs of make_icons.mjs into icon.ico (Windows: program file, window, taskbar),
icon.icns (macOS: the app bundle) and icon.png (Linux and the status window: 256 px).

    cd src/desktop/assets && python make_icons.py
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
PNG = HERE / "png"


def load(name: str) -> Image.Image:
    """Open one of the generated PNGs as RGBA."""
    return Image.open(PNG / name).convert("RGBA")


ico_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
largest = load("icon-256.png")
largest.save(
    HERE / "icon.ico",
    sizes=[(s, s) for s in ico_sizes],
    append_images=[load(f"icon-{s}.png") for s in ico_sizes if s != 256],
)
mac = load("mac-1024.png")
mac.save(HERE / "icon.icns", append_images=[load(f"mac-{s}.png") for s in (16, 32, 64, 128, 256, 512)])
largest.save(HERE / "icon.png")
for name in ("icon.ico", "icon.icns", "icon.png"):
    print(name, (HERE / name).stat().st_size, "bytes")
