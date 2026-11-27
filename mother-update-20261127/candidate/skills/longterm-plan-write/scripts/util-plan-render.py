"""Local PDF extraction. Text pages stay text; image-only pages are rendered."""
import argparse
import hashlib
import json
from pathlib import Path
import pymupdf


def extract(pdf, prefix):
    source = Path(pdf)
    result = {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "pages": []}
    with pymupdf.open(source) as document:
        if not len(document):
            raise ValueError("PDF has no pages")
        for index, page in enumerate(document):
            text = page.get_text().strip()
            row = {"page": index + 1, "text": text}
            if not text:
                path = Path(str(prefix) + "_p%d.png" % (index + 1))
                if path.exists():
                    raise FileExistsError(path.name)
                page.get_pixmap(dpi=110).save(path)
                if not path.is_file() or not path.stat().st_size:
                    raise ValueError("PNG not created")
                row["png"] = str(path.resolve())
            result["pages"].append(row)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("prefix")
    args = parser.parse_args()
    print(json.dumps(extract(args.pdf, args.prefix), ensure_ascii=True))
