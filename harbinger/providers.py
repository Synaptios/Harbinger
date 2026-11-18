"""Server-side model routing for OpenAI and OpenRouter."""

import json
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .paths import CREDENTIAL_FILE


DEFAULT_GENERATION_MODEL = "openai/gpt-5-mini"
DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
PROVIDER_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}
PROVIDER_NAMES = {"openai": "OpenAI", "openrouter": "OpenRouter"}
MAX_REQUEST_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_EMBEDDING_INPUTS = 128
READ_CHUNK_SIZE = 64 * 1024
ASSIGNMENT = re.compile(r"^[ \t]*(?:export[ \t]+)?([^=\r\n#]+?)[ \t]*=[ \t]*", re.MULTILINE)


class ProviderError(RuntimeError):
    """A provider failure whose message can be shown in the UI."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _parse_env(contents):
    values = {}
    consumed = 0
    for match in ASSIGNMENT.finditer(contents):
        if match.start() < consumed:
            continue
        key = match[1].strip()
        start = match.end()
        quote = contents[start:start + 1]
        if quote in ("'", '"', "`"):
            end = contents.find(quote, start + 1)
            if end >= 0:
                value = contents[start + 1:end]
                values[key] = value.replace("\\n", "\n") if quote == '"' else value
                consumed = end + 1
                continue
        line = contents[start:].split("\n", 1)[0]
        values[key] = line.partition("#")[0].strip()
    return values


def _read_credentials(file):
    try:
        contents = Path(file).read_text(encoding="utf-8-sig").strip()
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError):
        raise ProviderError("Could not read the credentials file.") from None

    try:
        values = json.loads(contents) if contents.startswith("{") else _parse_env(contents)
    except (ValueError, RecursionError):
        raise ProviderError("Could not parse the credentials file.") from None
    return values


def _key(*values):
    for value in values:
        if isinstance(value, str) and re.fullmatch(r"[!-~]{1,4096}", value.strip()):
            return value.strip()
    return None


def _valid_model_id(model):
    return isinstance(model, str) and not model.endswith("/") and bool(
        re.fullmatch(r"[a-z0-9][a-z0-9_.:/-]{0,255}", model, re.ASCII | re.IGNORECASE)
    )


def _model_provider(model):
    if model.startswith("openai/") or re.fullmatch(r"(?:gpt-|o[0-9]+(?:-|$)|text-embedding-)[^/]*", model):
        return "openai"
    return "openrouter"


def _select_model(model):
    if not _valid_model_id(model):
        raise ProviderError("A valid model ID is required.")
    provider = _model_provider(model)
    return provider, model.removeprefix("openai/") if provider == "openai" else model


def _openai_model_kind(model_id):
    if model_id.startswith("text-embedding-"):
        return "embedding"
    if re.match(r"(?:gpt-[0-9]|gpt-chat(?:-|$)|o[0-9]+(?:-|$))", model_id) and not re.search(
        r"-(?:audio|image|instruct|live|realtime|search|transcribe|tts)(?:-|$)", model_id
    ):
        return "generation"
    return None


def _object(value):
    return value if isinstance(value, dict) else {}


def _model_entry(model_id, label, kind, provider):
    return {"id": model_id, "label": label, "kind": kind, "provider": provider}


def _catalog_models(data, provider, kind):
    models = []
    for item in data:
        item = _object(item)
        model_id = item.get("id")
        if not _valid_model_id(model_id):
            continue
        if provider == "openai":
            model_kind = _openai_model_kind(model_id)
            if model_kind and "/" not in model_id:
                models.append(_model_entry("openai/" + model_id, model_id, model_kind, provider))
            continue

        if _model_provider(model_id) != "openrouter":
            continue
        architecture = _object(item.get("architecture"))
        inputs = architecture.get("input_modalities")
        outputs = architecture.get("output_modalities")
        output = "text" if kind == "generation" else "embeddings"
        if isinstance(inputs, list) and "text" not in inputs:
            continue
        if isinstance(outputs, list) and output not in outputs:
            continue
        name = item.get("name")
        label = name.strip()[:160] if isinstance(name, str) and name.strip() else model_id
        models.append(_model_entry(model_id, label, kind, provider))
    return models


def _openai_text(payload):
    output = payload.get("output")
    status = payload.get("status")
    if not isinstance(output, list) or (status and status != "completed"):
        return ""

    text = []
    for item in output:
        item = _object(item)
        content = item.get("content")
        if item.get("type") != "message" or item.get("role") != "assistant" or not isinstance(content, list):
            continue
        for part in content:
            part = _object(part)
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                text.append(part["text"])
    return "\n".join(text)


def _finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def _embedding_vectors(payload, count, provider):
    invalid = f"{PROVIDER_NAMES[provider]} returned invalid embeddings."
    data = payload.get("data")
    if not isinstance(data, list) or len(data) != count:
        raise ProviderError(invalid)

    vectors = [None] * count
    dimensions = None
    for item in data:
        item = _object(item)
        index = item.get("index")
        vector = item.get("embedding")
        if type(index) not in (int, float) or not 0 <= index < count or int(index) != index:
            raise ProviderError(invalid)
        index = int(index)
        if vectors[index] is not None or not isinstance(vector, list) or not vector or not all(map(_finite, vector)):
            raise ProviderError(invalid)
        if dimensions is not None and len(vector) != dimensions:
            raise ProviderError(invalid)
        vectors[index] = vector
        dimensions = len(vector)
    return vectors


def _json_text(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _reject_constant(value):
    raise ValueError(f"Invalid JSON constant {value}.")


def _read_json(response, signal):
    content = bytearray()
    read_chunk = getattr(response, "read1", response.read)
    while True:
        if signal is not None and signal.is_set():
            raise InterruptedError
        remaining = MAX_RESPONSE_BYTES + 1 - len(content)
        chunk = read_chunk(min(READ_CHUNK_SIZE, remaining))
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > MAX_RESPONSE_BYTES:
            raise ValueError("Response body exceeds the size limit.")
    return json.loads(content.decode("utf-8-sig"), parse_constant=_reject_constant)


class Providers:
    def __init__(self, keys, transport):
        self._keys = keys
        self._transport = transport

    def _request(self, provider, path, body=None, signal=None):
        label = PROVIDER_NAMES[provider]
        key = self._keys[provider]
        if not key:
            raise ProviderError(f"Set an API key for {label} to use this model.")

        data = None if body is None else _json_text(body).encode("utf-8", "backslashreplace")
        if data is not None and len(data) > MAX_REQUEST_BYTES:
            raise ProviderError("The provider request is too large.")
        headers = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(PROVIDER_URLS[provider] + path, data=data, headers=headers)
        unavailable = f"{label} could not be reached."
        if signal is not None and signal.is_set():
            raise ProviderError(unavailable)
        try:
            response = self._transport(request, timeout=8 if data is None else 120)
        except HTTPError as error:
            error.close()
            if error.code in (301, 302, 303, 307, 308):
                raise ProviderError(unavailable) from None
            raise ProviderError(f"{label} rejected the request (HTTP {error.code}).") from None
        except Exception:
            raise ProviderError(unavailable) from None

        with response:
            if not 200 <= response.status < 300:
                raise ProviderError(f"{label} rejected the request (HTTP {response.status}).")
            try:
                return _object(_read_json(response, signal))
            except Exception:
                raise ProviderError(f"{label} returned an invalid response.") from None

    def generate(self, *, instructions, data, model=None, signal=None):
        if not isinstance(instructions, str) or not instructions.strip():
            raise ProviderError("Generation instructions are required.")
        try:
            user_data = _json_text(data).encode("utf-8", "backslashreplace").decode("utf-8")
        except (TypeError, ValueError, RecursionError):
            raise ProviderError("Generation input must be serializable as JSON.") from None

        provider, model_id = _select_model(DEFAULT_GENERATION_MODEL if model is None else model)
        if provider == "openai":
            payload = self._request(provider, "/responses", {
                "model": model_id,
                "instructions": instructions,
                "input": user_data,
                "max_output_tokens": 16_384,
                "store": False,
            }, signal)
            text = _openai_text(payload)
        else:
            payload = self._request(provider, "/chat/completions", {
                "model": model_id,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": user_data},
                ],
                "max_tokens": 16_384,
            }, signal)
            choices = payload.get("choices")
            message = _object(choices[0]).get("message") if isinstance(choices, list) and choices else None
            text = _object(message).get("content")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError(f"{PROVIDER_NAMES[provider]} returned no generation text.")
        return text

    def embed(self, *, texts, model=None, signal=None):
        if not isinstance(texts, list) or len(texts) > MAX_EMBEDDING_INPUTS:
            raise ProviderError(f"Send up to {MAX_EMBEDDING_INPUTS} texts per embedding request.")
        if any(not isinstance(text, str) or not text.strip() for text in texts):
            raise ProviderError("Embedding input must contain nonempty text.")
        if not texts:
            return []

        provider, model_id = _select_model(DEFAULT_EMBEDDING_MODEL if model is None else model)
        payload = self._request(provider, "/embeddings", {
            "model": model_id,
            "input": texts,
            "encoding_format": "float",
        }, signal)
        return _embedding_vectors(payload, len(texts), provider)

    def catalog(self, *, signal=None):
        providers = {name: bool(key) for name, key in self._keys.items()}
        defaults = [
            _model_entry(DEFAULT_GENERATION_MODEL, "GPT-5 Mini", "generation", "openai"),
            _model_entry(DEFAULT_EMBEDDING_MODEL, "Text Embedding 3 Small", "embedding", "openai"),
        ]
        endpoints = [
            ("openai", "/models", None, "OpenAI model catalog"),
            ("openrouter", "/models", "generation", "OpenRouter generation catalog"),
            ("openrouter", "/embeddings/models", "embedding", "OpenRouter embedding catalog"),
        ]
        configured = [endpoint for endpoint in endpoints if providers[endpoint[0]]]
        models = {(model["kind"], model["id"]): model for model in defaults}
        errors = []

        def load(provider, path, kind):
            data = self._request(provider, path, signal=signal).get("data")
            if not isinstance(data, list):
                raise ProviderError("Invalid model list.")
            return _catalog_models(data, provider, kind)

        if configured:
            with ThreadPoolExecutor(max_workers=len(configured)) as pool:
                loads = [(label, pool.submit(load, provider, path, kind)) for provider, path, kind, label in configured]
                for label, future in loads:
                    try:
                        for model in future.result():
                            models.setdefault((model["kind"], model["id"]), model)
                    except ProviderError:
                        errors.append(f"{label} could not be loaded.")

        result = {"models": list(models.values()), "providers": providers}
        if errors:
            result["errors"] = errors
        return result


def create_providers(*, env=None, credential_file=None, transport=None):
    """Load local credentials and create adapters with injectable HTTP transport."""
    if env is None:
        env = os.environ
    if credential_file is None:
        credential_file = CREDENTIAL_FILE
    local = _read_credentials(credential_file)
    keys = {
        "openai": _key(env.get("OPENAI_API_KEY"), env.get("OPEN_AI_API_KEY"),
                       local.get("OPENAI_API_KEY"), local.get("OPEN_AI_API_KEY")),
        "openrouter": _key(env.get("OPENROUTER_API_KEY"), env.get("OPEN_ROUTER_API_KEY"),
                           local.get("OPENROUTER_API_KEY"), local.get("OPEN_ROUTER_API_KEY")),
    }
    if transport is None:
        transport = build_opener(_NoRedirect()).open
    return Providers(keys, transport)
