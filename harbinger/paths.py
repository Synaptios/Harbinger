"""Paths for Harbinger's local assets, credentials, and saved state."""

from pathlib import Path


_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = _ROOT / "public"
STORY_FILE = _ROOT / "story" / "ortuzar-first-contact.json"
STATE_DIR = _ROOT / "app-state"
CREDENTIAL_FILE = _ROOT / ".credentials"
