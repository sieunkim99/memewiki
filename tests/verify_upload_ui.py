"""Optional browser integration check: pip install playwright; use installed Edge."""
from io import BytesIO
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
from unittest.mock import patch

from PIL import Image
from playwright.sync_api import sync_playwright
import uvicorn

from web.server import create_app
from tests.test_upload import sample_analysis


def verify():
    output = Path(".state/qa")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}):
        app = create_app(Path(directory))
        categories = next(route.endpoint() for route in app.routes if getattr(route, "path", None) == "/api/database")["categories"]
        analysis = sample_analysis(categories)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("Server did not start")
            time.sleep(0.05)
        try:
            with patch("web.server.analyze_image", return_value=analysis), patch(
                    "web.server.recommend_memes", side_effect=lambda query, top_k, memes, database: {
                        "query": query, "count": 1, "mode": "llm", "interpretation": "AI interpretation",
                        "recommendations": [{"meme": memes[0], "reason": "AI recommendation reason"}]}), sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="msedge", headless=True)
                try:
                    for name, viewport in (("desktop", {"width": 1440, "height": 1000}),
                                           ("mobile", {"width": 390, "height": 844})):
                        page = browser.new_page(viewport=viewport)
                        errors = []
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.goto(f"http://127.0.0.1:{port}")
                        page.locator(".meme-card").first.wait_for()
                        page.locator("#btn-add-meme").click()
                        page.wait_for_function("document.getElementById('upload-status').textContent.includes('이미지를 선택')")
                        initial_count = page.request.get(f"http://127.0.0.1:{port}/api/database").json()["stats"]["upload_count"]
                        files = []
                        for index in range(6):
                            image = BytesIO()
                            Image.new("RGB", (240, 180), (index * 35, 30 if name == "desktop" else 200, 100)).save(image, format="PNG")
                            files.append({"name": f'test"meme-{index}.png', "mimeType": "image/png", "buffer": image.getvalue()})
                        page.locator("#upload-file").set_input_files(files)
                        assert page.locator(".upload-item").count() == 0
                        assert "5장" in page.locator("#upload-status").inner_text()
                        page.locator("#upload-file").set_input_files(files[:5])
                        assert page.locator(".upload-item").count() == 5
                        assert page.locator("#upload-submit").is_disabled()
                        page.wait_for_timeout(300)
                        page.screenshot(path=str(output / f"{name}-upload.png"))
                        if name == "desktop":
                            page.route("**/api/uploads/analyze", lambda route: route.fulfill(
                                status=504, content_type="application/json", body='{"detail":"Analysis timed out"}'), times=1)
                        page.locator("#upload-analyze").click()
                        if name == "desktop":
                            page.wait_for_function("!uploadAnalyzing && document.querySelector('.upload-item-error') !== null")
                            assert page.locator("#upload-submit").is_disabled()
                            page.locator('[data-action="retry"]').click()
                        page.wait_for_function("!document.getElementById('upload-submit').disabled")
                        assert page.locator(".upload-editor").count() == 5
                        assert page.request.get(f"http://127.0.0.1:{port}/api/database").json()["stats"]["upload_count"] == initial_count
                        first = page.locator(".upload-item").first
                        title = f'Reviewed {name} "meme" <safe>'
                        first.locator('[data-field="title"]').fill(title)
                        first.locator('[data-field="situation"]').fill("Reviewed situation before saving")
                        first.locator('[data-field="intent"]').fill("Edited intent")
                        first.locator('[data-field="humor_type"]').fill("Edited humor")
                        first.locator('[data-field="cautions"]').fill("Edited caution")
                        first.locator('[data-field="emotions_raw"]').fill("Edited emotion")
                        first.locator('[data-field="examples"]').first.fill("Edited example")
                        first.locator('[data-field="keywords"]').fill("edited, review")
                        first.locator('[data-field="category_emotion"]').select_option(categories["emotions"][1])
                        first.locator('[data-field="category_situation"]').select_option(categories["situations"][1])
                        first.locator('[data-field="tier"]').select_option(categories["tiers"][1])
                        first.locator('[data-field="category_recipients"]').first.uncheck()
                        first.locator('[data-field="category_recipients"]').nth(1).check()
                        page.locator(".upload-item").last.locator('[data-action="remove"]').click()
                        assert page.locator(".upload-item").count() == 4
                        page.locator("#upload-close").click()
                        page.locator("#btn-add-meme").click()
                        assert first.locator('[data-field="title"]').input_value() == title
                        first.scroll_into_view_if_needed()
                        page.wait_for_timeout(300)
                        page.screenshot(path=str(output / f"{name}-review.png"))
                        if name == "desktop":
                            page.route("**/api/uploads", lambda route: route.fulfill(
                                status=503, content_type="application/json", body='{"detail":"Save failed"}'), times=1)
                            page.locator("#upload-submit").click()
                            page.wait_for_function("document.getElementById('upload-status').textContent === 'Save failed'")
                            assert page.locator(".upload-item").count() == 4
                        page.locator("#upload-submit").click()
                        page.locator("#upload-modal").wait_for(state="hidden")
                        database = page.request.get(f"http://127.0.0.1:{port}/api/database").json()
                        assert database["stats"]["upload_count"] == initial_count + 4
                        saved = next(meme for meme in database["memes"] if meme["title"] == title)
                        assert saved["examples"][0] == "Edited example"
                        assert saved["category_emotion"] == categories["emotions"][1]
                        assert saved["category_recipients"] == [categories["recipients"][1]]
                        assert saved["keywords"] == ["edited", "review"]
                        page.evaluate("id => openModal(id)", saved["id"])
                        page.locator("#meme-modal").wait_for(state="visible")
                        assert "Reviewed situation before saving" in page.locator("#modal-content").inner_text()
                        assert page.locator("#detail-modal-img").get_attribute("alt") == title
                        assert page.locator("#detail-modal-img").evaluate("el => el.complete && el.naturalWidth > 0")
                        page.wait_for_timeout(300)
                        page.screenshot(path=str(output / f"{name}-result.png"))
                        page.locator("#modal-close").click()
                        page.reload()
                        page.locator(".meme-card").first.wait_for()
                        assert "Reviewed situation before saving" in page.locator("#meme-grid").inner_text()
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                        page.locator("#btn-add-meme").click()
                        page.wait_for_function("uploadAvailable")
                        page.locator("#upload-file").set_input_files(files[0])
                        page.locator("#upload-analyze").click()
                        page.wait_for_function("!document.getElementById('upload-submit').disabled")
                        assert "기존 이미지" in page.locator(".upload-item-status").inner_text()
                        assert page.locator('[data-field="title"]').is_enabled()
                        page.locator('[data-field="title"]').fill("Edited existing " + name)
                        page.locator('[data-field="situation"]').fill("User corrected the AI analysis")
                        page.locator("#upload-submit").click()
                        page.locator("#meme-modal").wait_for(state="visible")
                        assert "User corrected the AI analysis" in page.locator("#modal-content").inner_text()
                        updated = page.request.get(f"http://127.0.0.1:{port}/api/database").json()
                        assert updated["stats"]["upload_count"] == initial_count + 4
                        assert next(meme for meme in updated["memes"] if meme["id"] == saved["id"])["title"] == "Edited existing " + name
                        page.locator("#modal-close").click()
                        page.locator("#search-input").fill("A different expression")
                        page.locator("#ai-search-form").evaluate("form => form.requestSubmit()")
                        page.wait_for_function("document.getElementById('ai-query-display').textContent === 'AI interpretation'")
                        assert page.locator(".reason-box").inner_text().find("AI recommendation reason") >= 0
                        assert page.locator(".badge-pill.confidence").inner_text() == "LLM 추천"
                        page.screenshot(path=str(output / f"{name}-ai-search.png"))
                        page.route("**/api/recommend", lambda route: route.fulfill(
                            status=503, content_type="application/json", body='{"detail":"AI unavailable"}'), times=1)
                        page.locator("#ai-search-form").evaluate("form => form.requestSubmit()")
                        page.wait_for_function("document.getElementById('ai-query-display').textContent === 'AI unavailable'")
                        assert page.locator(".meme-card").count() == 0
                        assert not errors, errors
                        page.close()
                        print(name + ": five-image review, new/existing edits, removal, save, reload and AI search passed")
                finally:
                    browser.close()
        finally:
            server.should_exit = True
            thread.join(timeout=10)


if __name__ == "__main__":
    verify()
