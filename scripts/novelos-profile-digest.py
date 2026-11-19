"""Summarize one 50-turn NovelOS profile for an evidence-based tuning review."""

import argparse
from collections import Counter
from difflib import SequenceMatcher
from hashlib import sha256
import json
from pathlib import Path
import re


SCORES = ("Responsiveness", "Voice", "Pacing", "Specificity")
WORDS = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("benchmark", type=Path)
    parser.add_argument("evaluation", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--reference", type=Path, help="Benchmark against which to compare the exact action strings.")
    return parser.parse_args()


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def benchmark_turns(data):
    styles = data["styles"]
    if len(styles) != 5 or any(len(style["turns"]) != 10 for style in styles):
        raise SystemExit("Expected five playstyles with ten committed turns each.")
    rows = {(style["id"], turn["number"]): turn for style in styles for turn in style["turns"]}
    if len(rows) != 50:
        raise SystemExit("Benchmark contains duplicate style and turn references.")
    return rows


def key(row):
    return row["style"], row["turn"]


def tokens(text):
    return [match.group().casefold().replace("’", "'") for match in WORDS.finditer(text)]


def excerpt(prose, finding):
    best, original = None, []
    compared = tokens(finding)
    for paragraph in re.split(r"\n\s*\n", prose):
        spans = list(WORDS.finditer(paragraph))
        matched = SequenceMatcher(None, tokens(paragraph), compared, autojunk=False).find_longest_match()
        if best is None or matched.size > best.size:
            best, original = matched, spans
            passage = paragraph
    if best and best.size >= 5:
        length = min(best.size, 24)
        start, end = original[best.a].start(), original[best.a + length - 1].end()
        return {"text": passage[start:end], "kind": "literal-overlap-with-judge-finding", "matchedWords": best.size}
    return {"text": prose.split("\n\n", 1)[0][:220], "kind": "literal-opening-for-independent-review"}


def review_item(evaluated, turns, dimension=None):
    rubric = evaluated["guardian"]
    turn = turns[key(evaluated)]
    evidence = {
        "style": evaluated["style"], "turn": evaluated["turn"], "action": turn["action"],
        "words": turn["words"], "commitMs": turn["durationMs"],
        "judgeStatus": rubric["status"], "judgeFinding": rubric["finding"],
        "excerpt": excerpt(turn["prose"], rubric["finding"]),
        "exactParagraphReuses": evaluated["reusedParagraphs"],
    }
    if dimension:
        evidence["score"] = rubric["scores"][dimension]
    return evidence


def lowest_examples(rows, turns, dimension):
    if not rows:
        return None
    scores = Counter(row["guardian"]["scores"][dimension] for row in rows)
    lowest = min(scores)
    candidates = [
        row for row in rows if row["guardian"]["scores"][dimension] == lowest
    ]
    candidates.sort(key=lambda row: (-row["reusedParagraphs"],) + key(row))
    first_per_style = {}
    for row in candidates:
        first_per_style.setdefault(row["style"], row)
    selected = list(first_per_style.values())[:5]
    if len(selected) < 5:
        selected.extend([row for row in candidates if row not in selected][: 5 - len(selected)])
    return {
        "distribution": dict(sorted(scores.items())),
        "minimum": lowest,
        "minimumTies": len(candidates),
        "examples": [review_item(row, turns, dimension) for row in selected],
    }


def matching_actions(rows, reference):
    actions = {key: turn["action"] for key, turn in rows.items()}
    canonical = [[style, number, actions[style, number]] for style, number in sorted(actions)]
    result = {"actionSequenceSha256": sha256(json.dumps(canonical, ensure_ascii=False).encode("utf-8")).hexdigest()}
    if reference:
        earlier = benchmark_turns(load_json(reference))
        differences = [
            {"style": style, "turn": number, "reference": (earlier.get((style, number)) or {}).get("action"),
             "current": actions.get((style, number))}
            for style, number in sorted(set(actions) | set(earlier))
            if actions.get((style, number)) != (earlier.get((style, number)) or {}).get("action")
        ]
        result.update(reference=reference.name, identicalActionCount=50-len(differences), differingActions=differences)
    return result


def wait_evidence(turns):
    return {
        "observedWaits": [
            {"style": style, "turn": number, "commitMs": turn["durationMs"], **wait}
            for (style, number), turn in turns.items() for wait in turn.get("providerWaits") or []
        ],
        "terminalProviderStalls": [
            {"style": style, "turn": number, "commitMs": turn["durationMs"], "operations": turn["providerStalls"],
             "storySaveCount": turn["saveCount"]}
            for (style, number), turn in turns.items() if turn.get("providerStalls")
        ],
        "gatewayFailures": sum((turn.get("gateway") or {}).get("failures", 0) for turn in turns.values()),
    }


def digest(args):
    benchmark = load_json(args.benchmark)
    evaluation = load_json(args.evaluation)
    turns = benchmark_turns(benchmark)
    evaluation_input = evaluation.get("inputSha256")
    if evaluation_input and evaluation_input != sha256(args.benchmark.read_bytes()).hexdigest():
        raise SystemExit("Evaluation input fingerprint differs from the provided benchmark.")
    if not evaluation_input and evaluation.get("input") != args.benchmark.name:
        raise SystemExit("Evaluation input name differs from the provided benchmark.")
    rows = evaluation["turns"]
    if len(rows) != 50 or {key(row) for row in rows} != turns.keys():
        raise SystemExit("The evaluation does not cover these 50 turn references.")
    for row in rows:
        source = turns[key(row)]
        if any(row[field] != source[field] for field in ("words", "durationMs", "saveCount", "actionSaveCount")):
            raise SystemExit(f"Evaluation and benchmark metadata differ for {key(row)}.")
    graded = [row for row in rows if (row.get("guardian") or {}).get("scores")]
    flagged = [
        {**review_item(row, turns), "flags": {
            flag: verdict for flag, verdict in row["guardian"]["flags"].items() if verdict != "NO"
        }}
        for row in graded if any(verdict != "NO" for verdict in row["guardian"]["flags"].values())
    ]
    return {
        "formatVersion": 1,
        "profile": args.profile,
        "input": args.benchmark.name,
        "evaluation": args.evaluation.name,
        "judge": {field: evaluation.get(field) for field in ("novelOSRevision", "guardianModel", "rubricSha256", "evaluatorSha256")},
        "gameRoles": benchmark.get("roles"),
        "comparison": {
            **matching_actions(turns, args.reference),
            "fixture": benchmark.get("fixture"),
            "parallelGameplay": benchmark.get("parallel"),
            "stallReportingEnabled": benchmark.get("reportStalls"),
            "playedTurnCount": len(turns),
            "validGradeCount": len(graded),
        },
        "runtime": {**(benchmark.get("summary") or {}), **wait_evidence(turns)},
        "officialScores": evaluation["allStyles"],
        "byStyle": evaluation["styles"],
        "minimumScoreSamples": {dimension: lowest_examples(graded, turns, dimension) for dimension in SCORES},
        "reviewCandidates": flagged,
        "independentAudit": evaluation.get("independentAudit"),
        "reviewNotes": [
            "The scores and findings are the original judge output. Exact excerpts come from the committed prose.",
            "Minimum score examples span playstyles when minimum scores tie.",
            "Pacing grades describe the prose. Commit latency is a separate measurement.",
            "A positive judge finding does not explain why a prose score was below 5.",
            "Automated issue flags are leads. Verify grounding against the actor's evidence and the resolved events.",
        ],
    }


if __name__ == "__main__":
    args = arguments()
    result = digest(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
