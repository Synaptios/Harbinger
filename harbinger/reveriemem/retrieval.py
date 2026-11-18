"""Rank visible memories by embedding similarity."""

from math import isfinite, sqrt
from threading import Lock


def _similarity(first, second):
    dot = first_length = second_length = 0.0
    for left, right in zip(first, second, strict=True):
        dot += left * right
        first_length += left * left
        second_length += right * right
    score = dot / (sqrt(first_length * second_length) or 1)
    return score if isfinite(score) else 0.0


def create_ranker(providers):
    indexes = {}
    lock = Lock()

    def rank(*, model, query, records, limit, signal=None):
        if not records:
            return []

        texts = list(dict.fromkeys(record["text"] for record in records))
        with lock:
            if model not in indexes:
                if len(indexes) == 12:
                    del indexes[next(iter(indexes))]
                indexes[model] = {}
            index = indexes[model]
            known = {text: index[text] for text in texts if text in index}
        missing = [text for text in texts if text not in known]

        first = missing[:31]
        needle, *vectors = providers.embed(model=model, texts=[query, *first], signal=signal)
        embedded = dict(zip(first, vectors, strict=True))
        for offset in range(31, len(missing), 32):
            batch = missing[offset : offset + 32]
            vectors = providers.embed(model=model, texts=batch, signal=signal)
            embedded.update(zip(batch, vectors, strict=True))

        with lock:
            index.update(embedded)
        known.update(embedded)

        def score(record):
            return _similarity(needle, known[record["text"]]), record["index"]

        return sorted(records, key=score, reverse=True)[:limit]

    return rank
