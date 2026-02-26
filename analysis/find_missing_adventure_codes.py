from __future__ import annotations

import json
import re
from pathlib import Path
from textwrap import dedent
from typing import Any, Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
DATA_JS_PATH = ROOT / "data" / "data.js"
OUTPUT_PATH = Path(__file__).with_name("missing_adventure_codes.md")

DATA_ASSIGNMENT_PATTERN = re.compile(
    r"^\s*(?:window\.DATA|export\s+const\s+DATA)\s*=\s*(\{[\s\S]*\})\s*;?\s*$",
    re.MULTILINE,
)


def load_data() -> dict:
    raw_text = DATA_JS_PATH.read_text(encoding="utf-8")
    match = DATA_ASSIGNMENT_PATTERN.search(raw_text)
    if not match:
        raise ValueError("Unexpected data/data.js format: missing DATA assignment")
    return json.loads(match.group(1))


def format_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:g}"
    return str(value).replace("\n", " ")


def read_first(entry: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in entry and entry.get(key) not in (None, ""):
            return entry.get(key)
    return None


def iter_character_entries(character_info: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    adventures = character_info.get("adventures")
    if isinstance(adventures, list):
        return adventures
    logs = character_info.get("logs")
    if isinstance(logs, list):
        return logs
    return []


def collect_missing_entries(data: dict) -> List[dict]:
    entries: List[dict] = []
    characters = data.get("characters", {})
    if not isinstance(characters, dict):
        return entries

    for character, info in sorted(characters.items()):
        if not isinstance(info, dict):
            continue
        for idx, entry in enumerate(iter_character_entries(info), start=1):
            if not isinstance(entry, dict):
                continue
            code = read_first(entry, "code", "adventureCode")
            if code:
                continue
            entries.append(
                {
                    "character": character,
                    "entry_index": idx,
                    "date": read_first(entry, "date"),
                    "title": read_first(entry, "title", "adventureName"),
                    "dm": read_first(entry, "dm"),
                    "downtime_plus": read_first(entry, "dtd_plus", "downtimePlus") or 0,
                    "downtime_minus": read_first(entry, "dtd_minus", "downtimeMinus") or 0,
                    "gold_plus": read_first(entry, "gp_plus", "goldPlus") or 0,
                    "gold_minus": read_first(entry, "gp_minus", "goldMinus") or 0,
                    "notes": read_first(entry, "notes"),
                }
            )
    return entries


def build_markdown(entries: List[dict]) -> str:
    header = dedent(
        """
        # Log Entries Missing Adventure Codes

        The table below enumerates entries whose adventure code is empty (`code` in the current schema, `adventureCode` in legacy data). Use this list to manually review and classify each entry as an adventure or downtime activity.

        | Character | Entry # | Date | Title | DM | Downtime (+/-) | Gold (+/-) | Notes |
        | --- | --- | --- | --- | --- | --- | --- | --- |
        """
    ).strip()
    if not entries:
        return header + "\n| (none) |  |  |  |  |  |  |  |\n"

    rows = []
    for entry in entries:
        downtime = format_cell(entry["downtime_plus"]) + " / " + format_cell(entry["downtime_minus"])
        gold = format_cell(entry["gold_plus"]) + " / " + format_cell(entry["gold_minus"])
        row = "| " + " | ".join(
            [
                format_cell(entry["character"]),
                format_cell(entry["entry_index"]),
                format_cell(entry["date"]),
                format_cell(entry["title"]),
                format_cell(entry["dm"]),
                downtime,
                gold,
                format_cell(entry["notes"]),
            ]
        ) + " |"
        rows.append(row)
    return header + "\n" + "\n".join(rows) + "\n"


def main() -> None:
    data = load_data()
    entries = collect_missing_entries(data)
    markdown = build_markdown(entries)
    OUTPUT_PATH.write_text(markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
