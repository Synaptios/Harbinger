"""Load prepared character memories and persist built memories atomically."""

import hashlib
import json
import logging
import os
import tempfile
from pathlib import Path
from threading import Lock


def seed_memory(story, character_id):
    episodes = []
    facts = []
    for index, event in enumerate(story["events"]):
        allowed = [
            {
                "id": f"{event['id']}-{position}",
                "index": index,
                "text": entry["statement"],
                "route": entry["route"],
            }
            for position, entry in enumerate(event["knowledge"], start=1)
            if character_id in entry["visibleTo"]
        ]
        facts.extend(allowed)
        if character_id in event["participants"]:
            lived = [fact["text"] for fact in allowed if fact["route"] in ("direct", "observation")]
            if lived:
                episodes.append(
                    {
                        "id": event["id"],
                        "title": event["title"],
                        "index": index,
                        "text": "I remember this: " + " ".join(lived),
                    }
                )
    return {"episodes": episodes, "facts": facts, "patterns": [], "emotions": []}


def _compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class MemoryStore:
    def __init__(self, story, directory):
        self._directory = Path(directory) if directory is not None else None
        self._revision = hashlib.sha256(_compact_json(story).encode("utf-8")).hexdigest()[:16]
        self._lock = Lock()
        self._entries = {
            character["id"]: self._load(story, character["id"]) for character in story["characters"]
        }

    def _path(self, character_id):
        return self._directory / f"{self._revision}-{character_id}.json"

    def _load(self, story, character_id):
        if self._directory is not None:
            try:
                memory = json.loads(self._path(character_id).read_text(encoding="utf-8"))
                if isinstance(memory, dict) and all(
                    isinstance(memory.get(key), list) for key in ("episodes", "facts", "patterns", "emotions")
                ):
                    return memory
            except FileNotFoundError:
                pass
            except (OSError, ValueError):
                logging.warning("A Harbinger memory file could not be loaded. Using the prepared story memory.")
        return seed_memory(story, character_id)

    def get(self, character_id):
        with self._lock:
            return self._entries[character_id]

    def snapshot(self):
        with self._lock:
            return self._entries.copy()

    def save(self, character_id, memory):
        temporary = None
        try:
            if self._directory is not None:
                self._directory.mkdir(parents=True, exist_ok=True)
                destination = self._path(character_id)
                with tempfile.NamedTemporaryFile(
                    mode="w", encoding="utf-8", dir=self._directory,
                    prefix=destination.name + ".", suffix=".tmp", delete=False,
                ) as handle:
                    temporary = Path(handle.name)
                    handle.write(_compact_json(memory))
            with self._lock:
                if temporary is not None:
                    os.replace(temporary, destination)
                self._entries[character_id] = memory
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
