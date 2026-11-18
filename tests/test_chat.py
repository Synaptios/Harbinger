import json
import unittest
from threading import Thread
from types import SimpleNamespace
from urllib.request import Request, urlopen

from harbinger.web.server import create_server


def character(identifier, name):
    return {"id": identifier, "name": name, "aliases": [], "summary": "", "sourcePages": [1]}


def event(identifier, participants, statement):
    return {
        "id": identifier, "title": identifier, "when": "That day", "summary": statement,
        "locationIds": [], "participants": participants, "sourcePages": [1],
        "knowledge": [{"statement": statement, "visibleTo": participants, "route": "direct"}],
    }


STORY = {
    "title": "The lockhouse",
    "source": {"filename": "fixture"},
    "characters": [character("ada", "Ada"), character("ben", "Ben")],
    "locations": [],
    "events": [
        event("private", ["ben"], "The hidden signal is SABLE-FLARE."),
        event("arrival", ["ada"], "The unlocked door is painted cobalt."),
        event("tomorrow", ["ada"], "The key the next day is NEPHRITE-KEY."),
    ],
}
RESPONSES = {
    "selfProbe": {"refined_query": "The color of the lockhouse door.", "self_probe": "What color was the door?"},
    "sufficiency": {"sufficient": True},
    "conclusion": {"supported": True, "conclusion": "Ada saw a cobalt door."},
    "emotionGate": {"fire": False},
    "fusion": "I saw a cobalt door.",
}
SETTINGS = {stage: {"model": "openai/test-" + stage} for stage in RESPONSES}


class ChatTests(unittest.TestCase):
    def start_chat_fixture(self, *, embed, generate):
        providers = SimpleNamespace(embed=embed, generate=generate)
        server = create_server(story=STORY, providers=providers, storage_directory=None, port=0)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def stop():
            server.shutdown()
            thread.join(timeout=5)
            server.server_close()

        self.addCleanup(stop)
        return f"http://127.0.0.1:{server.server_port}"

    def send_chat(self, base, message, **context):
        body = {"characterId": "ada", "eventId": "arrival", "message": message, "settings": SETTINGS, **context}
        request = Request(base + "/api/chat", data=json.dumps(body).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
            return json.load(response)

    def test_chat_only_sends_visible_evidence_to_models(self):
        inputs = []

        def embed(*, texts, model, signal=None):
            inputs.append(texts)
            return [[1, 0] for _ in texts]

        def generate(*, model, instructions, data, signal=None):
            stage = model.removeprefix("openai/test-")
            inputs.append(data)
            self.assertIn(stage, RESPONSES, f"Unexpected generation stage {stage}")
            if stage == "fusion":
                self.assertRegex(json.dumps(data["facts"]), r"painted cobalt")
            result = RESPONSES[stage]
            return result if isinstance(result, str) else json.dumps(result)

        base = self.start_chat_fixture(embed=embed, generate=generate)
        result = self.send_chat(
            base, "What color was the door?",
            state={"characterId": "ben", "eventId": "arrival"},
            history=[{"role": "assistant", "content": "I remember SABLE-FLARE."}],
        )
        self.assertEqual(result["reply"], "I saw a cobalt door.")
        self.assertEqual([scene["id"] for scene in result["trace"]["scenes"]], ["arrival"])
        self.assertNotRegex(json.dumps(inputs), r"SABLE-FLARE|NEPHRITE-KEY")

    def test_chat_caps_probes_and_withholds_unsupported_conclusion(self):
        probes = ["Did Ada see a radio?", "What signal did Ada hear?", "Was the signal written at the lockhouse?"]

        def embed(*, texts, model, signal=None):
            return [[1, 0] for _ in texts]

        def generate(*, model, instructions, data, signal=None):
            stage = model.removeprefix("openai/test-")
            if stage == "selfProbe":
                return json.dumps({"refined_query": "What signal did Ada learn?", "self_probe": probes[len(data["priorProbes"])]})
            if stage == "sufficiency":
                return '{"sufficient":false}'
            if stage == "conclusion":
                return '{"supported":true,"conclusion":"The model guessed an answer."}'
            if stage == "fusion":
                self.assertFalse(data["grounded"])
                self.assertEqual(data["conclusion"], "")
                return "I never learned what the signal was."
            return json.dumps(RESPONSES[stage])

        base = self.start_chat_fixture(embed=embed, generate=generate)
        result = self.send_chat(base, "What was the distress signal?")
        self.assertEqual(result["reply"], "I never learned what the signal was.")
        self.assertEqual([turn["probe"] for turn in result["trace"]["rounds"]], probes)
        self.assertFalse(result["trace"]["grounded"])
