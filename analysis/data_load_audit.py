#!/usr/bin/env python3
"""Inspect data.js and related bootstrap markup for loading issues."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "data.js"
INDEX_PATH = ROOT / "index.html"

DATA_PATTERN = re.compile(r"window\.DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$", re.MULTILINE)


@dataclass
class DataSummary:
    characters: int
    adventures: int
    empty_characters: List[str]
    missing_fields: List[str]
    meta: Dict[str, Any]


def extract_data_payload() -> Dict[str, Any]:
    raw = DATA_PATH.read_text(encoding="utf-8")
    match = DATA_PATTERN.search(raw)
    if not match:
        raise SystemExit("Could not locate window.DATA assignment in data/data.js")
    payload = match.group(1)
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Failed to parse data/data.js payload: {exc}") from exc


def summarise_data(data: Dict[str, Any]) -> DataSummary:
    characters = data.get("characters") or {}
    empty_characters: List[str] = []
    adventures_total = 0
    missing_fields: List[str] = []

    for name, record in sorted(characters.items()):
        logs = record.get("adventures")
        if not isinstance(logs, list) or not logs:
            empty_characters.append(name)
            logs = logs if isinstance(logs, list) else []
        adventures_total += len(logs)

        if not record.get("sheet"):
            missing_fields.append(f"{name}: sheet")
        if not record.get("display_name"):
            missing_fields.append(f"{name}: display_name")

    meta = data.get("meta") or {}
    return DataSummary(
        characters=len(characters),
        adventures=adventures_total,
        empty_characters=empty_characters,
        missing_fields=missing_fields,
        meta=meta,
    )


def inspect_index_bootstrap() -> Dict[str, Any]:
    html = INDEX_PATH.read_text(encoding="utf-8")
    diagnostics = {
        "has_data_script": '<script id="dataScript"' in html,
        "uses_legacy_loader": "loadLegacyData" in html,
        "shows_error_details": "buildDataLoadDiagnosticsMarkup" in html,
    }
    return diagnostics


def format_list(items: Iterable[str], limit: int = 10) -> str:
    items = list(items)
    if not items:
        return "(none)"
    if len(items) <= limit:
        return ", ".join(items)
    preview = ", ".join(items[:limit])
    return f"{preview}, … (+{len(items) - limit} more)"


def main() -> None:
    data = extract_data_payload()
    summary = summarise_data(data)
    html_diag = inspect_index_bootstrap()

    print("Data.js summary:")
    print(f"  Characters: {summary.characters}")
    print(f"  Adventures: {summary.adventures}")
    print(f"  Characters missing adventures: {format_list(summary.empty_characters)}")
    print(f"  Missing required fields: {format_list(summary.missing_fields)}")
    generated = summary.meta.get("generated") or summary.meta.get("generatedAt")
    source = summary.meta.get("source_file") or summary.meta.get("sourceFile")
    print(f"  Metadata generated timestamp: {generated or '(missing)'}")
    print(f"  Metadata source file: {source or '(missing)'}")

    print("\nIndex.html bootstrap checks:")
    for key, value in html_diag.items():
        status = "yes" if value else "no"
        print(f"  {key.replace('_', ' ').capitalize()}: {status}")


if __name__ == "__main__":
    main()
