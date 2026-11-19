"""Capture the pinned upstream Architect and Writer prompts using a local fixture."""

from dataclasses import asdict
import json
import os
from pathlib import Path
import sys


UPSTREAM_REVISION = "1c4efc0a557ea79cda9ee2d20cfa25a40cd0f315"
UPSTREAM = Path(__file__).resolve().parents[1] / ".harbinger" / "dramatica-flow-upstream"

OPENING = (
    "Martin has the folded market permit in the guild room. The runner says the "
    "seal was loose when the paper was handed over. The runner did not see it stamped."
)
CONFLICT = (
    "Martin needs an entry he can defend, and the runner can give an account "
    "of receiving the folded permit but cannot identify who first stamped it."
)
UPCOMING_QUESTION = "Who can make the permit available for examination?"
CONTINUITY = (
    "The requested examination is still pending. Its wax and fold are outside "
    "the public view. No ruling, blame, or change in the stall's position has occurred."
)
PACE = "Answer the request immediately. End with the next person or source that can help."
STYLE_GUIDE = (
    "Write in English and use the clerk's point of view in second-person present. "
    "Let the cost of the case carry the feeling. Use only the current public record. "
    "Actor speech and the engine's visible result are supplied separately."
)


def main():
    head = UPSTREAM / ".git" / "HEAD"
    if not head.is_file() or head.read_text(encoding="utf-8").strip() != UPSTREAM_REVISION:
        raise SystemExit(f"Check out Dramatica Flow at detached revision {UPSTREAM_REVISION}.")

    # The source modules below need no credentials and make provider calls only
    # through the object we pass. Run as a dedicated Python process.
    os.environ.clear()
    sys.path.insert(0, str(UPSTREAM))
    from core.agents import ArchitectAgent, WriterAgent
    from core.llm import LLMProvider, LLMResponse
    from core.narrative import ChapterOutlineSchema
    from core.types.narrative import Character, CharacterNeed, CharacterWorldview

    fixture_blueprint = {
        "core_conflict": CONFLICT,
        "hooks_to_advance": [],
        "hooks_to_plant": [],
        "emotional_journey": {"start": "An unanswered request", "end": "A concrete next question"},
        "chapter_end_hook": UPCOMING_QUESTION,
        "pace_notes": PACE,
        "pre_write_checklist": {
            "active_characters": ["The clerk", "Martin", "Guild runner"],
            "required_locations": ["Guild room"],
            "resources_in_play": ["Folded market permit", "Runner's attributed account"],
            "hooks_status": ["The permit examination remains pending."],
            "risk_scan": CONTINUITY,
        },
    }

    class PromptRecorder(LLMProvider):
        def __init__(self):
            self.calls = []

        def complete(self, messages):
            self.calls.append([message.to_dict() for message in messages])
            if len(self.calls) == 1:
                return LLMResponse(content=json.dumps(fixture_blueprint))
            if len(self.calls) == 2:
                # Return empty fixture data after capturing the Writer request.
                return LLMResponse(content="")
            raise ValueError("Unexpected provider invocation in the prompt recorder.")

        def stream(self, messages, on_chunk):
            raise ValueError("The fixture only records the two synchronous requests.")

    clerk = Character(
        id="player",
        name="The clerk",
        need=CharacterNeed("Examine the permit, as requested in the fixture.", "Left to the player."),
        obstacles=[],
        worldview=CharacterWorldview(power="accepts", trust="selective", coping="freeze"),
        arc="flat",
        profile="A London household clerk. The player determines their words and acts.",
        behavior_lock=["Future actions, private feelings, and intent belong to the player."],
        current_goal="Examine the permit.",
        role="protagonist",
    )
    outline = ChapterOutlineSchema.model_validate({
        "chapter_number": 1,
        "title": "The seal under the fold",
        "summary": OPENING,
        "sequence_id": "loose-seal",
        "thread_id": "loose-seal",
        "pov_character_id": "player",
        "beats": [
            {"id": "request", "description": "The clerk asks to examine the permit.",
             "dramatic_function": "decision"},
            {"id": "pending", "description": "The examination is pending. Name a source who can help.",
             "dramatic_function": "consequence"},
        ],
        "emotional_arc": fixture_blueprint["emotional_journey"],
        "mandatory_tasks": ["Keep the examination and the attributed report distinct."],
        "target_words": 245,
    })
    public_context = f"{OPENING}\n{CONTINUITY}"
    recorder = PromptRecorder()
    blueprint = ArchitectAgent(recorder).plan_chapter(
        outline, public_context, pending_hooks="", pov_character=clerk,
    )
    writer = WriterAgent(recorder, style_guide=STYLE_GUIDE, genre="historical fiction")
    writer.write_chapter(
        scene_summaries="\n".join(beat.description for beat in outline.beats),
        blueprint=blueprint,
        protagonist=clerk,
        world_context=public_context,
        chapter_number=outline.chapter_number,
        chapter_title=outline.title,
        target_words=outline.target_words,
        writing_notes=PACE,
        causal_chain="A request to inspect opens a possible examination. The paper remains unavailable.",
        pov_instruction="The clerk can hear the runner's report and knows their own request.",
    )
    assert blueprint.core_conflict == CONFLICT
    assert blueprint.pre_write_checklist.risk_scan == CONTINUITY
    assert len(recorder.calls) == 2 and all(len(call) == 2 for call in recorder.calls)
    assert STYLE_GUIDE in recorder.calls[1][0]["content"]
    assert CONFLICT in recorder.calls[1][1]["content"]
    assert CONTINUITY in recorder.calls[1][1]["content"]
    print(json.dumps({
        "upstreamRevision": UPSTREAM_REVISION,
        "outline": outline.model_dump(mode="json"),
        "blueprint": asdict(blueprint),
        "architectMessages": recorder.calls[0],
        "writerMessages": recorder.calls[1],
    }, indent=2))


if __name__ == "__main__":
    main()
