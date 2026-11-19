"""Run the same NovelOS judge with shared request pacing and rate-limit recovery."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
from threading import Lock
from time import monotonic, sleep


class RequestPacer:
    def __init__(self, requests_per_minute, tokens_per_minute):
        self.request_interval = 60 / requests_per_minute
        self.seconds_per_token = 60 / tokens_per_minute
        self.ready_at = 0
        self.lock = Lock()

    def acquire(self, tokens):
        while True:
            with self.lock:
                now = monotonic()
                wait = self.ready_at - now
                if wait <= 0:
                    self.ready_at = now + max(self.request_interval, tokens * self.seconds_per_token)
                    return
            sleep(wait)

    def defer(self, seconds):
        with self.lock:
            self.ready_at = max(self.ready_at, monotonic() + seconds)


def retry_delay(error, attempt):
    headers = error.response.headers if error.response is not None else {}
    for key, factor in (("retry-after-ms", .001), ("retry-after", 1)):
        try:
            value = float(headers[key]) * factor
            if value > 0:
                return max(value, 1)
        except (KeyError, TypeError, ValueError):
            continue
    return min(45, 4 * (attempt + 1))


def main():
    path = Path(__file__).with_name("novelos-evaluate.py")
    spec = spec_from_file_location("harbinger_novelos_evaluator", path)
    evaluator = module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    args = evaluator.cli()
    evaluator.verify_checkout(args.novelos.resolve())
    from core import llm_client
    from openai import RateLimitError

    original_client = llm_client.LLMClient
    request_rate = int(os.environ.get("HARBINGER_NOVELOS_RPM", "420"))
    token_rate = int(os.environ.get("HARBINGER_NOVELOS_TPM", "1750000"))
    pacer = RequestPacer(request_rate, token_rate)

    class PacedClient(original_client):
        def complete(self, system, user, max_tokens=None):
            reserved_tokens = (len(system) + len(user)) / 3.4 + (max_tokens or self.max_tokens)
            for attempt in range(12):
                pacer.acquire(reserved_tokens)
                try:
                    return super().complete(system, user, max_tokens)
                except RateLimitError as error:
                    if error.code == "insufficient_quota" or attempt == 11:
                        raise
                    pacer.defer(retry_delay(error, attempt))

    llm_client.LLMClient = PacedClient
    return evaluator.main()


if __name__ == "__main__":
    raise SystemExit(main())
