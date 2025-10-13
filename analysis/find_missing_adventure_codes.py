from __future__ import annotations

import json
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]
DATA_JS_PATH = ROOT / "data.js"
OUTPUT_PATH = Path(__file__).with_name("missing_adventure_codes.md")

PREFIX = "export const DATA = "

def load_data() -> dict:
    raw_text = DATA_JS_PATH.read_text(encoding="utf-8")
    if not raw_text.startswith(PREFIX):
        raise ValueError("Unexpected data.js format: missing expected prefix")
    json_text = raw_text[len(PREFIX):].strip()
    if json_text.endswith(";"):
        json_text = json_text[:-1]
    return json.loads(json_text)


def format_cell(value):
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:g}"
    return str(value).replace("\n", " ")


def collect_missing_entries(data: dict) -> list[dict]:
    entries: list[dict] = []
    for character, info in sorted(data.get("characters", {}).items()):
        for idx, log in enumerate(info.get("logs", []), start=1):
            if log.get("adventureCode"):
                continue
            entries.append(
                {
                    "character": character,
                    "log_index": idx,
                    "date": log.get("date"),
                    "adventureName": log.get("adventureName"),
                    "dm": log.get("dm"),
                    "downtimePlus": log.get("downtimePlus"),
                    "downtimeMinus": log.get("downtimeMinus"),
                    "goldPlus": log.get("goldPlus"),
                    "goldMinus": log.get("goldMinus"),
                    "notes": log.get("notes"),
                }
            )
    return entries


def build_markdown(entries: list[dict]) -> str:
    header = dedent(
        """
        # Log Entries Missing Adventure Codes

        The table below enumerates every log entry whose `adventureCode` field is empty. Use this list to manually review and classify each entry as an adventure or a downtime activity.

        | Character | Log # | Date | Adventure Name | DM | Downtime (+/−) | Gold (+/−) | Notes |
        | --- | --- | --- | --- | --- | --- | --- | --- |
        """
    ).strip()
    rows = []
    for entry in entries:
        downtime = format_cell(entry["downtimePlus"]) + " / " + format_cell(entry["downtimeMinus"])
        gold = format_cell(entry["goldPlus"]) + " / " + format_cell(entry["goldMinus"])
        row = "| " + " | ".join(
            [
                format_cell(entry["character"]),
                format_cell(entry["log_index"]),
                format_cell(entry["date"]),
                format_cell(entry["adventureName"]),
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
