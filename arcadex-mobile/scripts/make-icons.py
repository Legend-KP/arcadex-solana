from PIL import Image
from pathlib import Path

# App / APK launcher mark (square)
src = Path(r"E:\kushal paliwal\Coding\arcadex-solana\public\arcadeX.webp")
out = Path(r"E:\kushal paliwal\Coding\arcadex-solana\arcadex-mobile\assets")
public = Path(r"E:\kushal paliwal\Coding\arcadex-solana\public")

img = Image.open(src).convert("RGBA")


def square_fit(im, size, bg=(255, 255, 255, 255), pad_ratio=0.0):
    canvas = Image.new("RGBA", (size, size), bg)
    pad = int(size * pad_ratio)
    box = size - pad * 2
    fitted = im.copy()
    fitted.thumbnail((box, box), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.paste(fitted, (x, y), fitted)
    return canvas


icon = square_fit(img, 1024, pad_ratio=0.06)
icon.save(out / "icon.png", "PNG")

fg = square_fit(img, 1024, bg=(0, 0, 0, 0), pad_ratio=0.18)
fg.save(out / "android-icon-foreground.png", "PNG")

bg = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
bg.save(out / "android-icon-background.png", "PNG")

mono_src = square_fit(img, 1024, bg=(0, 0, 0, 0), pad_ratio=0.18)
alpha = mono_src.split()[-1]
white = Image.new("L", (1024, 1024), 255)
mono = Image.merge("RGBA", (white, white, white, alpha))
mono.save(out / "android-icon-monochrome.png", "PNG")

square_fit(img, 48, pad_ratio=0.05).save(out / "favicon.png", "PNG")
square_fit(img, 512, pad_ratio=0.1).save(out / "splash-icon.png", "PNG")

public.mkdir(parents=True, exist_ok=True)
square_fit(img, 512, pad_ratio=0.05).save(public / "app-icon.png", "PNG")
print("ok — icons from arcadeX.webp")
