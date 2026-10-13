from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import json
import os

from fastapi.testclient import TestClient

from web.recommend import recommend_memes
from web.server import create_app


class RecommendationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.database = Path(self.directory.name) / "cache.sqlite3"
        self.memes = [{"id": f"meme-{index}", "title": f"Document {index}",
                       "situation": "A scene", "keywords": ["archive"]} for index in range(40)]
        self.client = MagicMock()
        self.client.__enter__.return_value = self.client

        def embed(**kwargs):
            return SimpleNamespace(data=[SimpleNamespace(index=index, embedding=(
                [1.0, 0.0] if text == "A different expression" or "Document 39" in text else [0.0, 1.0]))
                for index, text in enumerate(kwargs["input"])])

        self.client.embeddings.create.side_effect = embed
        self.client.responses.create.return_value.output_text = json.dumps({
            "interpretation": "The user's intent", "selections": [
                {"id": "meme-39", "reason": "Related meaning"},
                {"id": "meme-39", "reason": "Duplicate"}]})
        self.env = patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
        self.env.start()
        self.api = patch("web.recommend.OpenAI", return_value=self.client)
        self.api.start()

    def tearDown(self):
        self.api.stop()
        self.env.stop()
        self.directory.cleanup()

    def recommend(self):
        return recommend_memes("A different expression", 3, self.memes, self.database)

    def test_semantic_candidates_and_grounded_llm_result(self):
        result = self.recommend()
        self.assertEqual(result["mode"], "llm")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["recommendations"][0]["meme"]["id"], "meme-39")
        request = self.client.responses.create.call_args.kwargs
        candidates = json.loads(request["input"])["candidates"]
        self.assertEqual(len(candidates), 32)
        self.assertEqual(candidates[0]["id"], "meme-39")
        self.assertFalse(request["store"])

    def test_document_cache_reused_and_changed_documents_reembedded(self):
        self.recommend()
        self.recommend()
        calls = self.client.embeddings.create.call_args_list
        self.assertEqual([len(call.kwargs["input"]) for call in calls], [40, 1, 1])
        self.memes[0]["situation"] = "Changed text"
        self.recommend()
        calls = self.client.embeddings.create.call_args_list
        self.assertEqual([len(call.kwargs["input"]) for call in calls], [40, 1, 1, 1, 1])

    def test_unknown_meme_is_rejected(self):
        self.client.responses.create.return_value.output_text = json.dumps({
            "interpretation": "Intent", "selections": [{"id": "invented", "reason": "A reason"}]})
        with self.assertRaises(ValueError):
            self.recommend()

    def test_no_suitable_meme_returns_empty_results(self):
        self.client.responses.create.return_value.output_text = json.dumps({
            "interpretation": "No suitable meme", "selections": []})
        self.assertEqual(self.recommend()["count"], 0)

    def test_missing_key_and_invalid_queries_are_not_fake_ai(self):
        with TestClient(create_app(Path(self.directory.name))) as client:
            with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
                self.assertFalse(client.get("/api/ai-status").json()["enabled"])
                self.assertEqual(client.post("/api/recommend", json={"query": "A question"}).status_code, 503)
            for query in ("", "  ", "x" * 1001):
                self.assertEqual(client.post("/api/recommend", json={"query": query}).status_code, 422)
            self.assertEqual(client.post("/api/recommend", json={"query": "hello", "top_k": 100}).status_code, 422)

    def test_endpoint_uses_current_wiki_and_handles_failed_ai(self):
        with TestClient(create_app(Path(self.directory.name))) as client:
            with patch("web.server.recommend_memes", return_value={"mode": "llm", "count": 0}) as recommend:
                self.assertEqual(client.post("/api/recommend", json={"query": " hello ", "top_k": 2}).status_code, 200)
                args = recommend.call_args.args
                self.assertEqual(args[0], "hello")
                self.assertEqual(args[1], 2)
                self.assertEqual(len(args[2]), 427)
            with patch("web.server.recommend_memes", side_effect=ValueError("Invalid AI response")):
                response = client.post("/api/recommend", json={"query": "hello"})
                self.assertEqual(response.status_code, 502)
                self.assertNotIn("recommendations", response.json())


if __name__ == "__main__":
    unittest.main()
