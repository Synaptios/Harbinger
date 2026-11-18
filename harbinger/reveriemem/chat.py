"""Run a perspective-bounded ReverieMem conversation turn."""

from concurrent.futures import ThreadPoolExecutor

from .execution import StageError, as_text, perspective_rule, stage_runner
from .stages import resolve_settings


ROUND_LIMIT = 3


def _visible(records, index):
    return [record for record in records if record["index"] <= index]


def _fields(record, *keys):
    return {key: record[key] for key in keys if key in record}


def _require_flag(result, field, stage):
    value = result.get(field)
    if not isinstance(value, bool):
        raise StageError(stage, "The selected model did not return a yes-or-no decision.")
    return value


def _emotion_from(result):
    if not isinstance(result, dict):
        return None
    emotion = as_text(result.get("emotion"), 120)
    if not emotion:
        return None
    return {
        "emotion": emotion,
        "intensity": as_text(result.get("intensity"), 80),
        "trigger": as_text(result.get("trigger"), 400),
        "intent": as_text(result.get("intent"), 400),
    }


def _describe_fact(record):
    fact = _fields(record, "id", "text", "route")
    if record.get("subject"):
        relation = _fields(record, "subject", "predicate", "object")
        if record.get("cause"):
            relation["cause"] = record["cause"]
        fact["relation"] = relation
    return fact


def _select_pattern(run, context, memory, index, prior):
    patterns = _visible(memory["patterns"], index)
    previous = next((item for item in patterns if item["id"] == prior.get("patternId")), None)
    previous_emotion = _emotion_from(prior.get("emotion"))
    decision = run("emotionGate", {**context, "emotion": previous_emotion},
                   'Return JSON {"fire":true or false}.', perspective_rule)
    if not _require_flag(decision, "fire", "emotionGate"):
        return previous_emotion, previous

    trajectory = _visible(memory["emotions"], index)[-24:]
    result = run("emotionTransition", {**context, "previousEmotion": previous_emotion, "trajectory": trajectory},
                 'Return JSON {"emotion":"…","intensity":"…","trigger":"…","intent":"…"}.', perspective_rule)
    emotion = _emotion_from(result) or previous_emotion
    if not patterns:
        return emotion, None

    candidates = [_fields(pattern, "id", "label", "description") for pattern in patterns]
    choice = run("pattern", {**context, "emotion": emotion, "candidates": candidates},
                 'Return JSON {"chosen_mode_id":"…","brief_reason":"…"}.', perspective_rule)
    pattern = next((item for item in patterns if item["id"] == choice.get("chosen_mode_id")), None)
    if pattern is None:
        raise StageError("pattern", "The selected model did not choose an eligible pattern.")
    return emotion, pattern


def _reason(run, retrieve, context, memory, index, query):
    scenes = retrieve("anchor", query, _visible(memory["episodes"], index), 3)
    scene_context = [_fields(scene, "id", "text") for scene in scenes]
    available = _visible(memory["facts"], index)
    fact_pool = {}
    rounds = []

    def workspace():
        return {**context, "scenes": scene_context, "facts": [_describe_fact(fact) for fact in fact_pool.values()]}

    sufficient = False
    if scenes or available:
        for _ in range(ROUND_LIMIT):
            prior_probes = [turn["probe"] for turn in rounds]
            probing = run("selfProbe", {**workspace(), "priorProbes": prior_probes},
                          'Return JSON {"refined_query":"…","self_probe":"…"}.', perspective_rule)
            probe = as_text(probing.get("self_probe"), 600)
            if not probe:
                raise StageError("selfProbe", "The selected model did not return a retrieval probe.")
            if any(previous.lower() == probe.lower() for previous in prior_probes):
                break

            before = len(fact_pool)
            for fact in retrieve("retrieve", probe, available, 4):
                fact_pool[fact["id"]] = fact
            judgment = run("sufficiency", {**workspace(), "refinedQuestion": as_text(probing.get("refined_query"), 600)},
                           'Return JSON {"sufficient":true or false}.', perspective_rule)
            sufficient = _require_flag(judgment, "sufficient", "sufficiency")
            rounds.append({"probe": probe, "added": len(fact_pool) - before, "sufficient": sufficient})
            if sufficient:
                break

    evidence = workspace()
    result = run("conclusion", {**evidence, "sufficient": sufficient},
                 'Return JSON {"supported":true or false,"conclusion":"…"}.', perspective_rule)
    supported = _require_flag(result, "supported", "conclusion")
    grounded = sufficient and supported
    conclusion = as_text(result.get("conclusion"), 1200) if grounded else ""
    return scenes, evidence["facts"], rounds, grounded, conclusion


def _read_history(entries):
    history = []
    for entry in entries[-10:]:
        if not isinstance(entry, dict) or entry.get("role") not in ("user", "assistant"):
            continue
        text = as_text(entry.get("content"), 4000)
        if text:
            history.append({"role": entry["role"], "content": text})
    return history


def chat(*, character, event_id, index, memory, body, providers, rank, signal=None):
    settings = resolve_settings(body.get("settings"))
    run = stage_runner(providers, settings, signal)
    message = body["message"].strip()
    prior = body.get("state")
    if not isinstance(prior, dict) or prior.get("characterId") != character["id"] or prior.get("eventId") != event_id:
        prior = {}
    entries = body.get("history")
    history = _read_history(entries) if prior and isinstance(entries, list) else []
    context = {"character": character["name"], "message": message, "history": history}
    query = "\n".join([entry["content"] for entry in history[-2:]] + [message])
    options = {"signal": signal} if signal is not None else {}

    def retrieve(stage, text, records, limit):
        try:
            return rank(model=settings[stage]["model"], query=text, records=records, limit=limit, **options)
        except Exception as error:
            raise StageError(stage, str(error)) from error

    with ThreadPoolExecutor(max_workers=1) as pool:
        personality = pool.submit(_select_pattern, run, context, memory, index, prior)
        scenes, facts, rounds, grounded, conclusion = _reason(run, retrieve, context, memory, index, query)
        emotion, pattern = personality.result()

    fusion_context = {
        **context,
        "scenes": [_fields(scene, "id", "text") for scene in scenes],
        "facts": facts,
        "grounded": grounded,
        "conclusion": conclusion,
        "emotion": emotion,
        "pattern": _fields(pattern, "description", "excerpts") if pattern is not None else None,
    }
    reply = run(
        "fusion", fusion_context, constraint=perspective_rule +
        " When grounded is false and the user asks for a story fact, acknowledge in character that you do not know."
        " In a social turn, respond without establishing new story facts.",
    )
    return {
        "reply": reply,
        "state": {
            "characterId": character["id"], "eventId": event_id, "emotion": emotion,
            "patternId": pattern["id"] if pattern is not None else None,
        },
        "trace": {
            "scenes": [_fields(scene, "id", "title") for scene in scenes],
            "facts": [_fields(fact, "id", "text") for fact in facts],
            "rounds": rounds,
            "grounded": grounded,
            "pattern": _fields(pattern, "id", "label") if pattern is not None else None,
        },
    }
