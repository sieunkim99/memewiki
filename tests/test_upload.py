from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from web.server import MemeAnalysis, analyze_image, create_app


def sample_image(color="red"):
    buffer = BytesIO()
    Image.new("RGB", (80, 60), color).save(buffer, format="PNG")
    return buffer.getvalue()


def sample_analysis(categories):
    return MemeAnalysis(title='Test "meme"', situation="A test situation",
                        examples=["Example one", "Example two", "Example three"],
                        emotions_raw="Happy", intent="Share", humor_type="Exaggeration",
                        keywords=["test"], cautions="AI generated",
                        category_emotion=categories["emotions"][0],
                        category_situation=categories["situations"][0],
                        category_recipients=[categories["recipients"][0]], tier=categories["tiers"][0])


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = Path(self.directory.name)
        self.client = TestClient(create_app(self.storage))
        self.base = self.client.get("/api/database").json()
        self.analysis = sample_analysis(self.base["categories"])
        self.env = patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "MEMEWIKI_ALLOWED_ORIGINS": ""})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.client.close()
        self.directory.cleanup()

    def analyze(self, content=None):
        return self.client.post("/api/uploads/analyze", files={"files": ("meme.png", sample_image() if content is None else content, "image/png")})

    def save(self, drafts):
        return self.client.post("/api/uploads", json={"items": [
            {"token": draft["token"], "analysis": draft["analysis"]} for draft in drafts]})

    def upload(self):
        return self.save(self.analyze().json()["results"])

    def test_upload_duplicate_restart_and_statistics(self):
        with patch("web.server.analyze_image", return_value=self.analysis) as analyze:
            result = self.upload().json()["results"][0]
            self.assertFalse(result["duplicate"])
            self.assertTrue(self.upload().json()["results"][0]["duplicate"])
            analyze.assert_called_once()
        with TestClient(create_app(self.storage)) as restarted:
            database = restarted.get("/api/database").json()
            self.assertEqual(database["stats"]["total_count"], self.base["stats"]["total_count"] + 1)
            self.assertEqual(database["stats"]["upload_count"], 1)
            self.assertEqual(database["memes"][0]["id"], result["meme"]["id"])
            image = restarted.get(result["meme"]["image_url"])
            self.assertEqual(image.status_code, 200)
            self.assertEqual(image.headers["content-type"], "image/png")

    def test_invalid_large_and_empty_uploads_do_not_call_ai(self):
        with patch("web.server.analyze_image") as analyze:
            self.assertEqual(self.analyze(b"not an image").json()["results"][0]["status"], 400)
            self.assertEqual(self.analyze(b"").json()["results"][0]["status"], 400)
            self.assertEqual(self.analyze(b"x" * (10 * 1024 * 1024 + 1)).json()["results"][0]["status"], 413)
            analyze.assert_not_called()
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 0)

    def test_failed_analysis_does_not_save(self):
        with patch("web.server.analyze_image", side_effect=HTTPException(504, "timeout")):
            self.assertEqual(self.analyze().json()["results"][0]["status"], 504)
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 0)

    def test_missing_api_key_disables_upload_but_keeps_wiki(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            self.assertFalse(self.client.get("/api/upload-status").json()["enabled"])
            self.assertEqual(self.analyze().status_code, 503)
            self.assertEqual(self.client.get("/api/database").status_code, 200)

    def test_concurrent_duplicate_is_stored_once(self):
        with patch("web.server.analyze_image", return_value=self.analysis):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda _: self.upload(), range(2)))
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 1)

    def test_five_images_are_reviewed_and_edited_before_save(self):
        files = [("files", (f"{color}.png", sample_image(color), "image/png"))
                 for color in ("red", "green", "blue", "yellow", "purple")]
        with patch("web.server.analyze_image", return_value=self.analysis):
            drafts = self.client.post("/api/uploads/analyze", files=files).json()["results"]
        self.assertEqual(len(drafts), 5)
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 0)
        for index, draft in enumerate(drafts):
            draft["analysis"]["title"] = f"Edited title {index}"
            draft["analysis"]["situation"] = "Edited situation"
            draft["analysis"]["examples"] = ["Edited example"]
            draft["analysis"]["keywords"] = ["edited"]
        saved = self.save(drafts)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["saved_count"], 5)
        database = self.client.get("/api/database").json()
        self.assertEqual(database["stats"]["upload_count"], 5)
        self.assertEqual({m["title"] for m in database["memes"][:5]}, {f"Edited title {i}" for i in range(5)})
        self.assertTrue(all(m["examples"] == ["Edited example"] for m in database["memes"][:5]))

    def test_six_images_are_rejected_without_analysis(self):
        files = [("files", (f"{index}.png", sample_image(), "image/png")) for index in range(6)]
        with patch("web.server.analyze_image") as analyze:
            self.assertEqual(self.client.post("/api/uploads/analyze", files=files).status_code, 422)
            analyze.assert_not_called()

    def test_excluding_one_image_keeps_the_rest(self):
        with patch("web.server.analyze_image", return_value=self.analysis):
            drafts = self.client.post("/api/uploads/analyze", files=[
                ("files", ("red.png", sample_image("red"), "image/png")),
                ("files", ("blue.png", sample_image("blue"), "image/png"))]).json()["results"]
        self.assertEqual(self.client.delete("/api/upload-drafts/" + drafts[0]["token"]).status_code, 200)
        self.assertEqual(self.save(drafts).status_code, 410)
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 0)
        self.assertEqual(self.save(drafts[1:]).json()["saved_count"], 1)

    def test_invalid_edit_and_expired_draft_do_not_save(self):
        with patch("web.server.analyze_image", return_value=self.analysis):
            drafts = self.analyze().json()["results"]
        drafts[0]["analysis"]["category_emotion"] = "Invalid"
        self.assertEqual(self.save(drafts).status_code, 422)
        drafts[0]["analysis"]["category_emotion"] = self.analysis.category_emotion
        with sqlite3.connect(self.storage / "uploads.sqlite3") as connection:
            connection.execute("UPDATE upload_drafts SET created_at = 0")
        self.assertEqual(self.save(drafts).status_code, 410)
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 0)

    def test_partial_analysis_failure_returns_successful_drafts(self):
        with patch("web.server.analyze_image", side_effect=[HTTPException(504, "timeout"), self.analysis]):
            results = self.client.post("/api/uploads/analyze", files=[
                ("files", ("red.png", sample_image("red"), "image/png")),
                ("files", ("blue.png", sample_image("blue"), "image/png"))]).json()["results"]
        self.assertEqual(results[0]["status"], 504)
        self.assertIn("token", results[1])
        self.assertEqual(self.save(results[1:]).json()["saved_count"], 1)

    def test_retry_after_lost_save_response_returns_the_original_result(self):
        with patch("web.server.analyze_image", return_value=self.analysis):
            drafts = self.analyze().json()["results"]
        original = self.save(drafts).json()
        self.assertEqual(self.save(drafts).json(), original)
        self.assertEqual(self.client.get("/api/database").json()["stats"]["upload_count"], 1)

    def test_existing_image_analysis_can_be_edited_without_creating_a_duplicate(self):
        with patch("web.server.analyze_image", return_value=self.analysis) as analyze:
            original = self.upload().json()["results"][0]["meme"]
            drafts = self.analyze().json()["results"]
            analyze.assert_called_once()
        self.assertTrue(drafts[0]["duplicate"])
        drafts[0]["analysis"].update(title="User correction", situation="Corrected description",
                                     examples=["Corrected example"], keywords=["correction"],
                                     emotions_raw="Corrected emotion", intent="Corrected intent",
                                     humor_type="Corrected humor", cautions="Corrected caution",
                                     category_recipients=[self.base["categories"]["recipients"][1]])
        before = self.client.get("/api/database").json()["memes"][0]
        self.assertEqual(before["title"], original["title"])
        result = self.save(drafts).json()
        self.assertEqual(result["saved_count"], 0)
        self.assertEqual(result["updated_count"], 1)
        edited = result["results"][0]["meme"]
        self.assertEqual(edited["title"], "User correction")
        self.assertEqual(edited["intent"], "Corrected intent")
        self.assertEqual(edited["recipients_raw"], self.base["categories"]["recipients"][1])
        for field in ("id", "image_url", "date"):
            self.assertEqual(edited[field], original[field])
        with TestClient(create_app(self.storage)) as restarted:
            database = restarted.get("/api/database").json()
            self.assertEqual(database["stats"]["upload_count"], 1)
            self.assertEqual(database["memes"][0]["title"], "User correction")

    def test_ai_request_and_invalid_result(self):
        client = MagicMock()
        client.__enter__.return_value = client
        client.responses.create.return_value.output_text = self.analysis.model_dump_json()
        with patch("web.server.OpenAI", return_value=client):
            result = analyze_image(sample_image(), self.base["categories"])
            self.assertEqual(result.title, self.analysis.title)
            request = client.responses.create.call_args.kwargs
            self.assertFalse(request["store"])
            self.assertTrue(request["text"]["format"]["strict"])
            self.assertTrue(request["input"][0]["content"][1]["image_url"].startswith("data:image/png;base64,"))
            invalid = self.analysis.model_copy(update={"category_emotion": "Invalid"})
            client.responses.create.return_value.output_text = invalid.model_dump_json()
            with self.assertRaises(HTTPException) as error:
                analyze_image(sample_image(), self.base["categories"])
            self.assertEqual(error.exception.status_code, 502)

    def test_all_original_images_are_served(self):
        for meme in self.base["memes"]:
            response = self.client.get(meme["image_url"])
            self.assertEqual(response.status_code, 200, meme["id"])
            self.assertTrue(response.headers["content-type"].startswith("image/"), meme["id"])


if __name__ == "__main__":
    unittest.main()
