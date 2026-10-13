"""Build a portable GitHub Pages site from the existing database and images."""
import json
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote, quote

ROOT = Path(__file__).resolve().parent.parent


def build():
    output = ROOT / "_site"
    output.mkdir(exist_ok=True)
    static = ROOT / "web/static"
    for name in ("app.js", "style.css", "placeholder.png"):
        shutil.copy2(static / name, output / name)
    html = (static / "index.html").read_text(encoding="utf-8")
    html = html.replace('<html lang="ko">', '<html lang="ko" data-static="true">')
    html = html.replace('/static/style.css', './style.css').replace('/static/app.js', './app.js')
    (output / "index.html").write_text(html, encoding="utf-8")
    db = json.loads((ROOT / "web/data/memes.json").read_text(encoding="utf-8"))
    sources = {"dataset": ROOT / "dataset/images", "llm": ROOT / "llm_run/llm collected"}
    image_maps = {
        group: {unicodedata.normalize("NFC", p.name): p for p in directory.iterdir() if p.is_file()}
        for group, directory in sources.items()
    }
    for meme in db["memes"]:
        _, images, group, filename = unquote(meme["image_url"]).split("/", 3)
        if images != "images" or Path(filename).name != filename:
            raise ValueError(f"Invalid image path: {meme['id']}")
        source = image_maps[group].get(unicodedata.normalize("NFC", filename))
        if source is None:
            raise FileNotFoundError(sources[group] / filename)
        target = output / "images" / group / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        meme["image_url"] = "./images/" + group + "/" + quote(filename)
    (output / "data").mkdir(exist_ok=True)
    (output / "data/memes.json").write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
    (output / ".nojekyll").touch()
    print(f"Built {len(db['memes'])} memes with all images: {output}")


if __name__ == "__main__":
    build()
