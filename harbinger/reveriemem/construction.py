"""Build and store memories derived from a character's explicit knowledge grants."""

import unicodedata
from concurrent.futures import CancelledError, ThreadPoolExecutor

from .execution import as_text, perspective_rule, stage_runner
from .stages import resolve_settings


def _objects(value):
    return (item for item in value if isinstance(item, dict)) if isinstance(value, list) else ()


def _normalize(value):
    return " ".join(unicodedata.normalize("NFKC", value).lower().split())


def _source_evidence(event, character):
    return [
        {
            "id": f"{event['id']}-{position}",
            "statement": entry["statement"],
            "route": entry["route"],
            "excerpt": entry.get("evidence") or "",
        }
        for position, entry in enumerate(event["knowledge"], 1)
        if character["id"] in entry["visibleTo"]
    ]


def _exact_excerpts(value, evidence):
    sources = {source["id"]: source["excerpt"] for source in evidence}
    matches = []
    for quote in _objects(value):
        text = as_text(quote.get("text"), 400)
        evidence_id = quote.get("evidence_id")
        if text and isinstance(evidence_id, str) and text in sources.get(evidence_id, ""):
            matches.append(text)
            if len(matches) == 4:
                break
    return matches


def _candidates(relations, sources):
    results = []
    for relation in _objects(relations.get("facts")):
        evidence_id = relation.get("evidence_id")
        subject = as_text(relation.get("subject"), 250)
        predicate = as_text(relation.get("predicate"), 250)
        object_text = as_text(relation.get("object"), 500)
        if not (isinstance(evidence_id, str) and evidence_id in sources and subject and predicate and object_text):
            continue
        results.append({
            "id": evidence_id,
            "subject": subject,
            "predicate": predicate,
            "object": object_text,
            "cause": as_text(relation.get("cause"), 500),
            "route": sources[evidence_id]["route"],
        })
        if len(results) == len(sources) * 2:
            break
    return results


def _emotions(result, index):
    transitions = []
    for transition in _objects(result.get("transitions")):
        label = as_text(transition.get("emotion"), 120)
        if label:
            transitions.append({
                "index": index, "emotion": label,
                "intensity": as_text(transition.get("intensity"), 80),
                "trigger": as_text(transition.get("trigger"), 400),
                "intent": as_text(transition.get("intent"), 400),
            })
            if len(transitions) == 16:
                break
    return transitions


def _patterns(result, event_id, index, lived):
    patterns = []
    values = result.get("patterns")
    for position, pattern in enumerate(values if isinstance(values, list) else [], 1):
        if not isinstance(pattern, dict):
            continue
        label = as_text(pattern.get("label"), 120)
        description = as_text(pattern.get("description"), 600)
        if label and description:
            patterns.append({
                "id": f"{event_id}-pattern-{position}", "index": index,
                "label": label, "description": description,
                "excerpts": _exact_excerpts(pattern.get("excerpts"), lived),
            })
            if len(patterns) == 5:
                break
    return patterns


def _build_event(event, index, character, canonicalize, run, pool):
    evidence = _source_evidence(event, character)
    if not evidence:
        return None, [], [], []
    lived = [
        entry for entry in evidence if entry["route"] in {"direct", "observation"}
    ] if character["id"] in event["participants"] else []
    context = {"character": character["name"], "evidence": evidence}
    personal = {"character": character["name"], "evidence": lived}

    prepared = run("scenePreparation", context, 'Return JSON {"scene":"briefly organized scene evidence"}.', perspective_rule)
    summary = pool.submit(
        run, "episodic", personal, 'Return JSON {"memory":"first-person scene summary"}.', perspective_rule,
    ) if lived else None
    entities = pool.submit(
        run, "entities", {**context, "scene": as_text(prepared.get("scene"), 2000)},
        'Return JSON {"entities":["name", "object", "place"]}.', perspective_rule,
    )
    emotion = pool.submit(
        run, "emotionAnnotation", personal,
        'Return JSON {"transitions":[{"emotion":"…","intensity":"…","trigger":"…","intent":"…"}]} in narrative order.',
        perspective_rule,
    ) if lived else None
    episode_text = as_text(summary.result().get("memory"), 2000) if summary else ""
    entity_values = entities.result().get("entities")
    entity_names = [as_text(entity, 250) for entity in entity_values] if isinstance(entity_values, list) else []
    emotion_result = emotion.result() if emotion else {}

    relations = run(
        "facts", {**context, "entities": [name for name in entity_names if name][:60]},
        'Return JSON {"facts":[{"evidence_id":"a supplied ID","subject":"…","predicate":"…","object":"…","cause":"…"}]}. '
        'Prefer one relation per evidence ID.', perspective_rule,
    )
    sources = {item["id"]: item for item in evidence}
    candidates = _candidates(relations, sources)
    verification = pool.submit(
        run, "visibility",
        {**context, "candidates": candidates, "episodic": episode_text, "episodicEvidenceIds": [item["id"] for item in lived]},
        'Return JSON {"accepted_evidence_ids":["ID"],"episode_supported":true or false}. '
        'Accept a fact ID only if its proposed relation is supported by the statement and its recorded visibility route. '
        'Accept the episode only if all its claims are supported by the listed episodic evidence.', perspective_rule,
    )
    personality = pool.submit(
        run, "personality", personal,
        'Return JSON {"patterns":[{"label":"…","description":"…","excerpts":[{"evidence_id":"ID","text":"exact dialogue"}]}]}. '
        'Return an empty array when the scene has no supported pattern.', perspective_rule,
    ) if lived else None

    verified = verification.result()
    personality_result = personality.result() if personality else {}
    accepted_ids = verified.get("accepted_evidence_ids")
    accepted = {value for value in accepted_ids if isinstance(value, str)} if isinstance(accepted_ids, list) else set()
    facts = []
    for candidate in candidates:
        evidence_id = candidate["id"]
        if evidence_id not in accepted:
            continue
        statement = sources[evidence_id]["statement"]
        facts.append({
            **candidate, "index": index, "text": statement,
            "subject": canonicalize(candidate["subject"], statement),
            "object": canonicalize(candidate["object"], statement),
        })
    episode = None
    if episode_text and verified.get("episode_supported") is True:
        episode = {"id": event["id"], "title": event["title"], "index": index, "text": episode_text}
    return episode, facts, _emotions(emotion_result, index), _patterns(personality_result, event["id"], index, lived)


def build_memory(*, story, character, settings, providers, signal=None):
    run = stage_runner(providers, resolve_settings(settings), signal=signal)
    aliases = {
        _normalize(alias): item["name"]
        for item in story["characters"] for alias in item["aliases"]
    }

    def canonicalize(name, statement):
        canonical = aliases.get(_normalize(name))
        return canonical if canonical and _normalize(canonical) in _normalize(statement) else name

    memory = {"episodes": [], "facts": [], "patterns": [], "emotions": []}
    fact_keys = set()
    pattern_keys = set()
    with ThreadPoolExecutor(max_workers=3) as pool:
        for index, event in enumerate(story["events"]):
            if signal is not None and signal.is_set():
                raise CancelledError()
            episode, facts, emotions, patterns = _build_event(event, index, character, canonicalize, run, pool)
            if episode:
                memory["episodes"].append(episode)
            memory["emotions"].extend(emotions)
            for fact in facts:
                key = _normalize(fact["text"])
                if key not in fact_keys:
                    fact_keys.add(key)
                    memory["facts"].append(fact)
            for pattern in patterns:
                key = _normalize(f"{pattern['label']} {pattern['description']}")
                if key not in pattern_keys:
                    pattern_keys.add(key)
                    memory["patterns"].append(pattern)
    return memory
