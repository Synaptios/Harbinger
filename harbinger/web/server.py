"""Run the local Harbinger chat and memory API."""

import json
import logging
import os
import re
import select
import socket
from concurrent.futures import CancelledError
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Lock, Thread
from urllib.parse import urlsplit

from ..paths import PUBLIC_DIR, STATE_DIR, STORY_FILE
from ..providers import create_providers
from ..reveriemem.chat import chat
from ..reveriemem.construction import build_memory
from ..reveriemem.execution import StageError, as_text
from ..reveriemem.retrieval import create_ranker
from ..reveriemem.stages import stages
from ..reveriemem.store import MemoryStore


PUBLIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
MAX_BODY = 384_000
# Drain modest oversized uploads so closing a Windows socket does not reset the 413 response.
MAX_DRAIN = MAX_BODY * 2
LOCAL_HOST = re.compile(r"(?:127\.0\.0\.1|localhost)(?::[0-9]+)?", re.IGNORECASE | re.ASCII)
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _invalid_json_constant(value):
    raise ValueError(f"Invalid JSON constant {value}")


def _memory_counts(memory):
    return {key: len(memory[key]) for key in ("episodes", "facts", "patterns")}


def _read_exact(stream, length):
    data = stream.read(length)
    if len(data) != length:
        raise RequestError(400, "Send a valid JSON object.")
    return data


def _discard_body(stream, length):
    while length:
        block = _read_exact(stream, min(length, 65536))
        length -= len(block)


def _chunked_body(stream):
    data = bytearray()
    received = 0
    while True:
        line = stream.readline(1025)
        size = line[:-2].split(b";", 1)[0]
        if not line.endswith(b"\r\n") or len(line) > 1024 or not re.fullmatch(rb"[0-9a-fA-F]+", size):
            raise RequestError(400, "Send a valid JSON object.")
        length = int(size, 16)
        received += length
        if received > MAX_DRAIN:
            raise RequestError(413, "The request is too large.")
        if not length:
            remaining = 8192
            while remaining > 0:
                trailer = stream.readline(remaining + 1)
                if trailer == b"\r\n":
                    if received > MAX_BODY:
                        raise RequestError(413, "The request is too large.")
                    return data
                if not trailer.endswith(b"\r\n"):
                    break
                remaining -= len(trailer)
            raise RequestError(400, "Send a valid JSON object.")
        if received > MAX_BODY:
            _discard_body(stream, length)
        else:
            data.extend(_read_exact(stream, length))
        if _read_exact(stream, 2) != b"\r\n":
            raise RequestError(400, "Send a valid JSON object.")


def _parse_body(headers, stream):
    if headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
        raise RequestError(415, "Send an application/json request.")
    lengths = headers.get_all("Content-Length", [])
    encodings = headers.get_all("Transfer-Encoding", [])
    if encodings:
        if lengths or len(encodings) != 1 or encodings[0].strip().lower() != "chunked":
            raise RequestError(400, "Send a valid JSON object.")
        data = _chunked_body(stream)
    else:
        size = lengths[0].strip() if lengths else "0"
        if len(lengths) > 1 or not re.fullmatch(r"[0-9]+", size):
            raise RequestError(400, "Send a valid JSON object.")
        size = size.lstrip("0") or "0"
        if len(size) > len(str(MAX_DRAIN)):
            raise RequestError(413, "The request is too large.")
        length = int(size)
        if length > MAX_BODY:
            if length <= MAX_DRAIN:
                _discard_body(stream, length)
            raise RequestError(413, "The request is too large.")
        data = _read_exact(stream, length)
    try:
        body = json.loads(data.decode("utf-8"), parse_constant=_invalid_json_constant)
        if not isinstance(body, dict):
            raise ValueError("Expected an object")
        return body
    except (ValueError, RecursionError):
        raise RequestError(400, "Send a valid JSON object.") from None


@contextmanager
def _disconnect_signal(connection):
    """Stop starting provider stages once the browser closes its request."""
    cancelled = Event()
    finished = Event()

    def watch():
        while not finished.is_set():
            try:
                readable, _, _ = select.select([connection], [], [], 0.2)
                if readable and not connection.recv(1, socket.MSG_PEEK):
                    cancelled.set()
                    return
            except OSError:
                if not finished.is_set():
                    cancelled.set()
                return
            if readable:
                finished.wait(0.2)

    Thread(target=watch, daemon=True).start()
    try:
        yield cancelled
    finally:
        finished.set()


def create_server(*, host="127.0.0.1", port=0, story=None, providers=None, storage_directory=STATE_DIR):
    if story is None:
        story = json.loads(STORY_FILE.read_text(encoding="utf-8"))
    if providers is None:
        providers = create_providers()
    characters = {character["id"]: character for character in story["characters"]}
    events = {event["id"]: index for index, event in enumerate(story["events"])}
    store = MemoryStore(story, storage_directory)
    rank = create_ranker(providers)
    build_lock = Lock()
    building = set()

    class Handler(BaseHTTPRequestHandler):
        server_version = "Harbinger"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, *args):
            pass

        def send_error(self, code, message=None, explain=None):
            if code == 501:
                self._json(404, {"error": "Page not found."})
            else:
                self._json(code, {"error": "Send a valid HTTP request."})

        def _send(self, status, content=b"", content_type=None, cache=None):
            self.send_response(status)
            for name, value in SECURITY_HEADERS.items():
                self.send_header(name, value)
            if content_type:
                self.send_header("Content-Type", content_type)
            if cache:
                self.send_header("Cache-Control", cache)
            if status != 204:
                self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            if self.command != "HEAD" and content:
                self.wfile.write(content)

        def _json(self, status, value):
            text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            self._send(status, text.encode("utf-8", errors="backslashreplace"), "application/json; charset=utf-8", "no-store")

        def _route(self):
            hosts = self.headers.get_all("Host", [])
            origin = self.headers.get("Origin")
            if len(hosts) != 1 or not LOCAL_HOST.fullmatch(hosts[0]) or (origin and origin != "http://" + hosts[0]):
                raise RequestError(403, "Open Harbinger from its local address.")
            path = urlsplit(self.path).path
            if self.command in {"GET", "HEAD"} and path in PUBLIC_FILES:
                filename, content_type = PUBLIC_FILES[path]
                self._send(200, (PUBLIC_DIR / filename).read_bytes(), content_type, "no-cache")
            elif self.command == "GET" and path == "/favicon.ico":
                self._send(204)
            elif self.command == "GET" and path == "/api/bootstrap":
                memories = {character_id: _memory_counts(memory) for character_id, memory in store.snapshot().items()}
                self._json(200, {"story": story, "stages": stages, "memory": memories})
            elif self.command == "GET" and path == "/api/models":
                with _disconnect_signal(self.connection) as signal:
                    self._json(200, providers.catalog(signal=signal))
            elif self.command == "POST" and path in {"/api/chat", "/api/memory/build"}:
                self._post(path, _parse_body(self.headers, self.rfile))
            else:
                raise RequestError(404, "Page not found.")

        def _post(self, path, body):
            character_id = body.get("characterId")
            character = characters.get(character_id) if isinstance(character_id, str) else None
            if path == "/api/chat":
                event_id = body.get("eventId")
                index = events.get(event_id) if isinstance(event_id, str) else None
                message = body.get("message")
                if not character or index is None or not as_text(message, 1) or len(message) > 6000:
                    raise RequestError(400, "Choose a character and scene and enter a message up to 6,000 characters.")
                with _disconnect_signal(self.connection) as signal:
                    self._json(200, chat(
                        character=character, event_id=event_id, index=index, memory=store.get(character_id),
                        body=body, providers=providers, rank=rank, signal=signal,
                    ))
            else:
                if not character:
                    raise RequestError(400, "Choose a character before building memory.")
                self._build(character_id, character, body.get("settings"))

        def _build(self, character_id, character, settings):
            with build_lock:
                if character_id in building:
                    raise RequestError(409, "Memory is already building for this character.")
                building.add(character_id)
            try:
                with _disconnect_signal(self.connection) as signal:
                    memory = build_memory(story=story, character=character, settings=settings, providers=providers, signal=signal)
                    if signal.is_set():
                        return
                    if not memory["facts"] and not memory["episodes"]:
                        raise RequestError(422, "The build found no supported memories. Check the character, source, and stage settings.")
                    store.save(character_id, memory)
                    self._json(200, {"memory": _memory_counts(memory)})
            finally:
                with build_lock:
                    building.remove(character_id)

        def _dispatch(self):
            try:
                try:
                    self._route()
                except RequestError as error:
                    self._json(error.status, {"error": str(error)})
                except StageError as error:
                    self._json(502, {"error": str(error), "stage": error.stage})
                except CancelledError:
                    pass
                except TimeoutError:
                    self._json(408, {"error": "The request timed out."})
                except ConnectionError:
                    raise
                except Exception as error:
                    logging.error("Harbinger request failed: %s", type(error).__name__)
                    self._json(500, {"error": "Harbinger could not finish this request."})
            except (ConnectionError, TimeoutError):
                pass

        do_GET = do_HEAD = do_POST = do_OPTIONS = do_PUT = do_PATCH = do_DELETE = _dispatch

    return ThreadingHTTPServer((host, port), Handler)


def main():
    port = int(os.environ.get("PORT") or 4173)
    with create_server(port=port) as server:
        print(f"Harbinger is ready at http://127.0.0.1:{server.server_address[1]}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
