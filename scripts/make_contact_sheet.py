from __future__ import annotations

import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    evidence_path = Path(args.evidence)
    output_path = Path(args.output)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    items = evidence["samples"]
    thumbs = []
    for item in items:
        path = evidence_path.parent / item["path"]
        image = Image.open(path).convert("RGB")
        draw = ImageDraw.Draw(image)
        label = f'{item["shotId"]}  f{item["frame"]}'
        draw.rectangle((0, 0, image.width, 28), fill=(0, 0, 0))
        draw.text((8, 6), label, fill=(255, 255, 255))
        thumbs.append(image)
    cols = 5
    rows = (len(thumbs) + cols - 1) // cols
    gap = 12
    cell_w = max(image.width for image in thumbs)
    cell_h = max(image.height for image in thumbs)
    sheet = Image.new("RGB", (cols * cell_w + (cols + 1) * gap, rows * cell_h + (rows + 1) * gap), (18, 20, 30))
    for index, image in enumerate(thumbs):
        x = gap + (index % cols) * (cell_w + gap)
        y = gap + (index // cols) * (cell_h + gap)
        sheet.paste(image, (x, y))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG")
    print(f"CONTACT_SHEET_CREATED={output_path}")


if __name__ == "__main__":
    main()
