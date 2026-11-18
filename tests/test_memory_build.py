import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from harbinger.reveriemem.construction import build_memory
from harbinger.reveriemem.store import MemoryStore


def evidence(statement, witness, route="direct", excerpt=""):
    return {"statement": statement, "visibleTo": [witness], "route": route, "evidence": excerpt}


def event(event_id, participant, *grants):
    return {"id": event_id, "title": event_id, "participants": [participant], "knowledge": list(grants)}


class MemoryBuildTests(unittest.TestCase):
    def test_build_filters_evidence_and_personal_stages(self):
        ada = {"id": "ada", "name": "Ada", "aliases": ["A."]}
        story = {
            "characters": [ada, {"id": "ben", "name": "Ben", "aliases": []}],
            "events": [
                event("closed", "ben", evidence("SEALED-JOURNAL", "ben")),
                event(
                    "dock", "ada",
                    evidence("Ada opens the sluice at dawn.", "ada", excerpt='Ada says, "Raise the gate."'),
                    evidence("HIDDEN-KEY", "ben"),
                    evidence("Ada watches the bell.", "ada", "observation"),
                ),
                event("notice", "ada", evidence("The canal is closed at dusk.", "ada", "organization")),
            ],
        }
        calls = []

        def relation(evidence_id, subject, predicate, object_text):
            return {"evidence_id": evidence_id, "subject": subject, "predicate": predicate, "object": object_text}

        responses = {
            "scenePreparation": {"scene": "The evidence in order."},
            "episodic": {"memory": "I opened the sluice at dawn."},
            "entities": {"entities": ["Ada", "sluice"]},
            "emotionAnnotation": {"transitions": [{"emotion": "focused", "trigger": "Opening the sluice"}]},
            "personality": {"patterns": [{
                "label": "Direct", "description": "Gives short instructions.",
                "excerpts": [
                    {"evidence_id": "dock-1", "text": "Raise the gate."},
                    {"evidence_id": "dock-1", "text": "Move the boat."},
                ],
            }]},
        }

        def generate(*, model, instructions, data):
            stage = model.removeprefix("openai/test-")
            calls.append((stage, data))
            is_dock = data["evidence"][0]["id"] == "dock-1"
            if stage == "facts":
                facts = [
                    relation("dock-1", "A.", "opens", "the sluice"),
                    relation("dock-2", "Ben", "takes", "a key"),
                    relation("dock-3", "Ada", "takes", "a key"),
                ] if is_dock else [relation("notice-1", "The canal", "closes at", "dusk")]
                return json.dumps({"facts": facts})
            if stage == "visibility":
                return json.dumps({
                    "accepted_evidence_ids": ["dock-1", "dock-2"] if is_dock else ["notice-1"],
                    "episode_supported": is_dock,
                })
            return json.dumps(responses[stage])

        settings = {stage: {"model": f"openai/test-{stage}"} for stage in (*responses, "facts", "visibility")}
        memory = build_memory(story=story, character=ada, settings=settings, providers=SimpleNamespace(generate=generate))

        self.assertNotRegex(json.dumps(calls), r"SEALED-JOURNAL|HIDDEN-KEY|closed-1|dock-2")
        personal_stages = {"episodic", "emotionAnnotation", "personality"}
        self.assertCountEqual(
            [(stage, [item["id"] for item in data["evidence"]]) for stage, data in calls if stage in personal_stages],
            [(stage, ["dock-1", "dock-3"]) for stage in personal_stages],
        )
        self.assertEqual(
            [[item["id"] for item in data["candidates"]] for stage, data in calls if stage == "visibility"],
            [["dock-1", "dock-3"], ["notice-1"]],
        )
        self.assertEqual([item["id"] for item in memory["episodes"]], ["dock"])
        self.assertEqual([(item["id"], item["route"], item["index"]) for item in memory["facts"]], [
            ("dock-1", "direct", 1), ("notice-1", "organization", 2),
        ])
        self.assertEqual(memory["facts"][0]["subject"], "Ada")
        self.assertEqual([item["index"] for item in memory["emotions"]], [1])
        self.assertEqual([item["excerpts"] for item in memory["patterns"]], [["Raise the gate."]])

    def test_store_reuses_legacy_node_memory_file(self):
        story = {"title": "L’Écluse", "characters": [{"id": "ada", "name": "Ada", "aliases": []}], "events": []}
        # The original Node store derived this prefix from SHA-256 of JSON.stringify(story).
        filename = "c77225f1ecc6091f-ada.json"
        legacy = '{"episodes":[{"id":"dock","title":"L’Écluse","index":0,"text":"J’ai levé la porte."}],"facts":[],"patterns":[],"emotions":[]}'
        with TemporaryDirectory() as directory:
            path = Path(directory, filename)
            path.write_text(legacy, encoding="utf-8")
            store = MemoryStore(story, directory)
            saved = json.loads(legacy)
            self.assertEqual(store.get("ada"), saved)

            updated = {**saved, "emotions": [{"index": 0, "emotion": "soulagée"}]}
            store.save("ada", updated)
            self.assertEqual(store.get("ada"), updated)
            self.assertEqual(MemoryStore(story, directory).get("ada"), updated)
            self.assertEqual(path.read_text(encoding="utf-8"), json.dumps(updated, ensure_ascii=False, separators=(",", ":")))
            self.assertEqual(list(path.parent.iterdir()), [path])
