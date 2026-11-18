import io
import json
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch

from harbinger.providers import MAX_RESPONSE_BYTES, PROVIDER_URLS, ProviderError, create_providers


OPENAI = "https://api.openai.com/v1"
OPENROUTER = "https://openrouter.ai/api/v1"


class Response(io.BytesIO):
    def __init__(self, payload, status=200):
        super().__init__(json.dumps(payload).encode("utf-8"))
        self.status = status


class ProviderTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.credential_file = Path(directory) / ".credentials"
        self.requests = {}

    def providers(self, respond, *, env=None, credentials=""):
        self.credential_file.write_text(credentials, encoding="utf-8")

        def transport(request, *, timeout):
            self.requests[request.full_url] = request
            return respond(request.full_url)

        return create_providers(env=env or {}, credential_file=self.credential_file, transport=transport)

    def test_openai_generation_separates_instructions_from_data(self):
        providers = self.providers(
            lambda url: Response({
                "status": "completed",
                "output": [
                    {"type": "reasoning", "summary": []},
                    {"type": "message", "role": "assistant", "content": [
                        {"type": "output_text", "text": "A light in the distance."},
                    ]},
                ],
            }),
            env={"OPENAI_API_KEY": "test-direct", "OPENROUTER_API_KEY": "test-router"},
        )

        result = providers.generate(instructions="Narrate the scene.", data={"scene": "the docks", "action": "look north"})

        self.assertEqual(result, "A light in the distance.")
        request = self.requests[OPENAI + "/responses"]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-direct")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "gpt-5-mini")
        self.assertFalse(body["store"])
        self.assertEqual(body["instructions"], "Narrate the scene.")
        self.assertEqual(json.loads(body["input"]), {"scene": "the docks", "action": "look north"})

    def test_openrouter_generation_prefers_the_environment_key_alias(self):
        providers = self.providers(
            lambda url: Response({"choices": [{"message": {"content": "A storm is coming."}}]}),
            env={"OPEN_AI_API_KEY": "test-direct", "OPEN_ROUTER_API_KEY": "test-router-env"},
            credentials='OPENROUTER_API_KEY="test-router-file" # local default\n',
        )

        result = providers.generate(
            model="anthropic/claude-sonnet-4.6", instructions="Describe the weather.", data={"location": "the docks"},
        )

        self.assertEqual(result, "A storm is coming.")
        request = self.requests[OPENROUTER + "/chat/completions"]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-router-env")
        body = json.loads(request.data)
        self.assertEqual(body["model"], "anthropic/claude-sonnet-4.6")
        self.assertEqual(body["messages"], [
            {"role": "system", "content": "Describe the weather."},
            {"role": "user", "content": '{"location":"the docks"}'},
        ])

    def test_default_openai_embeddings_are_sorted_in_input_order(self):
        providers = self.providers(
            lambda url: Response({"data": [
                {"index": 1, "embedding": [0.4, -0.5]},
                {"index": 0, "embedding": [0.9, 0.2]},
            ]}),
            credentials='# Local configuration\nexport OPEN_AI_API_KEY="test-local"\n',
        )

        vectors = providers.embed(texts=["the pier", "the ship"])

        self.assertEqual(vectors, [[0.9, 0.2], [0.4, -0.5]])
        request = self.requests[OPENAI + "/embeddings"]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-local")
        self.assertEqual(json.loads(request.data), {
            "model": "text-embedding-3-small", "input": ["the pier", "the ship"], "encoding_format": "float",
        })

    def test_catalog_filters_unusable_and_duplicate_models(self):
        responses = {
            OPENAI + "/models": [
                {"id": "gpt-5-mini"}, {"id": "o3-mini"}, {"id": "gpt-image-1"},
                {"id": "gpt-4o-mini-transcribe"}, {"id": "text-embedding-3-large"},
            ],
            OPENROUTER + "/models": [
                {"id": "anthropic/claude-sonnet-4.6", "name": "Anthropic: Claude Sonnet 4.6", "architecture": {
                    "input_modalities": ["text", "image"], "output_modalities": ["text"],
                }},
                {"id": "openai/gpt-5-mini", "name": "Duplicate GPT-5 Mini"},
                {"id": "example/image-model", "architecture": {"output_modalities": ["image"]}},
            ],
            OPENROUTER + "/embeddings/models": [
                {"id": "qwen/qwen3-embedding-8b", "name": "Qwen: Qwen3 Embedding 8B", "architecture": {
                    "input_modalities": ["text"], "output_modalities": ["embeddings"],
                }},
            ],
        }
        providers = self.providers(
            lambda url: Response({"data": responses[url]}),
            credentials=json.dumps({"OPENAI_API_KEY": "test-direct-json", "OPEN_ROUTER_API_KEY": "test-router-json"}),
        )

        catalog = providers.catalog()

        self.assertEqual(catalog["providers"], {"openai": True, "openrouter": True})
        self.assertEqual(sorted((model["id"], model["kind"], model["provider"]) for model in catalog["models"]), [
            ("anthropic/claude-sonnet-4.6", "generation", "openrouter"),
            ("openai/gpt-5-mini", "generation", "openai"),
            ("openai/o3-mini", "generation", "openai"),
            ("openai/text-embedding-3-large", "embedding", "openai"),
            ("openai/text-embedding-3-small", "embedding", "openai"),
            ("qwen/qwen3-embedding-8b", "embedding", "openrouter"),
        ])
        self.assertEqual(catalog["models"][4]["label"], "Anthropic: Claude Sonnet 4.6")
        for url in responses:
            request = self.requests[url]
            token = "test-direct-json" if url.startswith(OPENAI) else "test-router-json"
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("Authorization"), f"Bearer {token}")

    def test_oversized_response_is_rejected_during_the_bounded_read(self):
        response = Response({"output": "x" * (MAX_RESPONSE_BYTES + 1024)})
        providers = self.providers(lambda url: response, env={"OPENAI_API_KEY": "test-direct"})

        with self.assertRaisesRegex(ProviderError, r"^OpenAI returned an invalid response\.$"):
            providers.generate(instructions="Describe the scene.", data={"scene": "the docks"})

        self.assertTrue(response.closed)

    def test_catalog_keeps_models_when_another_endpoint_fails(self):
        def respond(url):
            if url == OPENAI + "/models":
                return Response({"error": {"message": "Upstream echoed test-direct"}}, status=401)
            if url == OPENROUTER + "/models":
                return Response({"data": [{"id": "anthropic/claude-sonnet-4.6"}]})
            raise OSError("Upstream connection failed with test-router")

        providers = self.providers(respond, env={"OPENAI_API_KEY": "test-direct", "OPENROUTER_API_KEY": "test-router"})
        catalog = providers.catalog()

        self.assertEqual([model["id"] for model in catalog["models"]], [
            "openai/gpt-5-mini", "openai/text-embedding-3-small", "anthropic/claude-sonnet-4.6",
        ])
        self.assertEqual(catalog["errors"], [
            "OpenAI model catalog could not be loaded.", "OpenRouter embedding catalog could not be loaded.",
        ])

    def test_openrouter_embeddings_reject_duplicate_indices(self):
        providers = self.providers(
            lambda url: Response({"data": [
                {"index": 0, "embedding": [0.2, 0.3]},
                {"index": 0, "embedding": [0.1, 0.7]},
            ]}),
            env={"OPENAI_API_KEY": "test-direct", "OPENROUTER_API_KEY": "test-router"},
        )

        with self.assertRaisesRegex(ProviderError, r"^OpenRouter returned invalid embeddings\.$"):
            providers.embed(model="qwen/qwen3-embedding-8b", texts=["the pier", "the ship"])

        request = self.requests[OPENROUTER + "/embeddings"]
        self.assertEqual(request.get_header("Authorization"), "Bearer test-router")
        self.assertEqual(json.loads(request.data), {
            "model": "qwen/qwen3-embedding-8b", "input": ["the pier", "the ship"], "encoding_format": "float",
        })

    def test_catalog_never_follows_a_provider_redirect(self):
        paths = []

        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                if self.path == "/models":
                    self.send_response(302)
                    self.send_header("Location", "/target")
                else:
                    self.send_response(404)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = self.enterContext(ThreadingHTTPServer(("127.0.0.1", 0), Redirect))
        thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        try:
            endpoint = f"http://127.0.0.1:{server.server_port}"
            with patch.dict(PROVIDER_URLS, {"openai": endpoint}), patch.dict("os.environ", {"NO_PROXY": "127.0.0.1"}):
                providers = create_providers(env={"OPENAI_API_KEY": "test-direct"}, credential_file=self.credential_file)
                catalog = providers.catalog()
        finally:
            server.shutdown()
            thread.join()

        self.assertEqual(paths, ["/models"])
        self.assertEqual(catalog["errors"], ["OpenAI model catalog could not be loaded."])


if __name__ == "__main__":
    unittest.main()
