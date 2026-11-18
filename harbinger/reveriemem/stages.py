"""Stage descriptions and defaults sent to the Harbinger browser."""

DEFAULT_CHAT_MODEL = "openai/gpt-5-mini"
DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"


def _generation(stage_id, label, phase, description, prompt):
    return {
        "id": stage_id,
        "label": label,
        "phase": phase,
        "kind": "generation",
        "description": description,
        "defaultModel": DEFAULT_CHAT_MODEL,
        "defaultPrompt": prompt,
    }


def _embedding(stage_id, label, description):
    return {
        "id": stage_id,
        "label": label,
        "phase": "reasoning",
        "kind": "embedding",
        "description": description,
        "defaultModel": DEFAULT_EMBEDDING_MODEL,
    }


stages = [
    _generation(
        "scenePreparation", "Scene preparation", "source",
        "Organize the character’s evidence from each ordered event.",
        "Group the supplied source evidence into the situation, actions and perceptions available to the focus character. "
        "Keep the source order. Do not infer unrecorded dialogue or knowledge.",
    ),
    _generation(
        "episodic", "Episodic summary", "source",
        "Recall a scene in the first person.",
        "Write a brief first-person retrospective. Describe what I personally perceived, felt or did, using only the supplied evidence. "
        "Do not add dialogue, names, motives, or conclusions that are absent from it.",
    ),
    _generation(
        "entities", "Entity extraction", "source",
        "Identify people, places and objects named in the scene evidence.",
        "Identify the explicitly named entities and recorded aliases. Keep names recognizable and do not add entities from outside the evidence.",
    ),
    _generation(
        "facts", "Fact extraction", "source",
        "Build subject–predicate–object facts with explicit causes.",
        "Extract subject, predicate and object for each supported statement. Set cause to an empty string unless it is explicit. "
        "Keep the source evidence ID for every relation.",
    ),
    _generation(
        "visibility", "Visibility verification", "source",
        "Check the claimed access against the original evidence.",
        "Verify each fact and the proposed scene recollection against the supplied source evidence and its access route. "
        "Mark unsupported or ambiguous material unverifiable. Never expand a visibility grant.",
    ),
    _generation(
        "emotionAnnotation", "Emotional annotation", "source",
        "Build the character’s chronological emotion record.",
        "Annotate each scene with the emotion, intensity, trigger, and inferred intent supported by the focus character’s source evidence. "
        "Leave uncertain fields empty and distinguish inference from observation.",
    ),
    _generation(
        "personality", "Personality patterns", "source",
        "Distill situational speech and behavior with source anchors.",
        "Find distinct speech or behavior patterns the character displays at the supplied scene. Use short labels and describe the observed cadence, gesture, and tone. "
        "Return excerpts only when the exact words appear in an allowed source excerpt. Cite that excerpt’s evidence ID.",
    ),
    _embedding("anchor", "Anchor", "Embed the question and the character’s eligible scenes for dense recall."),
    _generation(
        "selfProbe", "Self-probe", "reasoning",
        "Ask a focused question to fill a gap in the recalled scenes.",
        "Briefly restate what the character is being asked, using the recalled scenes. Propose one concrete probe about a person, object, relation, event, time, or place. "
        "Each follow-up should explore a different angle than the prior probes.",
    ),
    _embedding(
        "retrieve", "Visibility-gated retrieval", "Embed probes and rank only facts the character can know at the selected event.",
    ),
    _generation(
        "sufficiency", "Evidence sufficiency", "reasoning",
        "Decide whether the current evidence supports an answer.",
        "Decide whether the recalled scenes and facts are enough to answer the question from the character’s perspective. "
        "Treat the user’s premise as unverified. Mark insufficient if the answer would require guessing or using outside knowledge.",
    ),
    _generation(
        "conclusion", "Grounded conclusion", "reasoning",
        "Synthesize the answer supported by the final evidence pool.",
        "Give a brief conclusion grounded in the supplied memories. Distinguish established facts from uncertainty. "
        "If the evidence cannot answer the question, mark it unsupported and describe the gap.",
    ),
    _generation(
        "emotionGate", "Emotional salience", "fusion",
        "Check whether this turn calls for a change in emotional state.",
        "Decide whether the current dialogue has an emotionally salient event for this character. Leave the gate closed for routine exchanges.",
    ),
    _generation(
        "emotionTransition", "Emotion transition", "fusion",
        "Infer the next emotional state from the available record.",
        "Predict the next emotion, intensity, trigger, and inferred intent from the current conversation and the eligible emotion record. "
        "Use the last state as context. Avoid inventing a factual trigger.",
    ),
    _generation(
        "pattern", "Pattern selection", "fusion",
        "Choose a behavior pattern that fits the character and situation.",
        "Select exactly one provided pattern ID based on the current emotion and dialogue. Choose the closest available fit and explain the choice in one short sentence.",
    ),
    _generation(
        "fusion", "Memory fusion", "fusion",
        "Respond in character using the allowed evidence and selected style.",
        "Speak as the character in one to three natural first-person sentences. Answer the immediate question directly and stop when it is answered. "
        "Let the selected pattern guide cadence and expression. Keep your knowledge limits in character. Leave the underlying evidence records and analysis out of the dialogue.",
    ),
]


def _bounded_text(value, limit):
    if isinstance(value, str):
        trimmed = value.strip()
        if len(trimmed.encode("utf-16-le", errors="surrogatepass")) // 2 <= limit:
            return trimmed
    return ""


def resolve_settings(overrides=None):
    overrides = overrides if isinstance(overrides, dict) else {}
    settings = {}
    for stage in stages:
        candidate = overrides.get(stage["id"])
        candidate = candidate if isinstance(candidate, dict) else {}
        settings[stage["id"]] = {
            "model": _bounded_text(candidate.get("model"), 180) or stage["defaultModel"],
            "prompt": _bounded_text(candidate.get("prompt"), 16_000) or stage.get("defaultPrompt"),
        }
    return settings
