"""Normalise the AL campaign data export and surface unresolved issues."""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "data.js"
MANUAL_PATH = ROOT / "analysis" / "manual_corrections.md"
PREFIXES = (
    "export const DATA = ",
    "window.DATA = ",
)
DEFAULT_PREFIX = PREFIXES[0]
_current_prefix = DEFAULT_PREFIX

# Common data-entry typos we can safely normalise.
ITEM_CORRECTIONS = {
    "Glamoured Studed Leather": "Glamoured Studded Leather",
    "Plauge Fly": "Plague Fly",
    "Moon-Tcouhed Greatsword": "Moon-Touched Greatsword",
    "Opal of the ild rune": "Opal of the Ild Rune",
    "Anstruth Hapr": "Anstruth Harp",
    "Belt of HIll Giant Strength": "Belt of Hill Giant Strength",
    "to Staff of the Python": "Staff of the Python",
    "Sixth Sword": "The Sixth Sword",
    "Pipe of Smoke Monsters (Guardian)": "Pipe of Smoke Monsters (Guardian)",
}

COUNTERPARTY_CORRECTIONS = {
    "Norixious": "Norixius",
    "Norragen": "Noraggen",
    "Fai Chen": "Fai Chen",
}

ADVENTURE_CODE_REMAP = {
    "dm reward": "DM-REWARD",
    "dm rewards": "DM-REWARD",
}


@dataclass
class ManualIssue:
    character: str
    index: int
    date: str | None
    adventure_name: str | None
    reason: str
    notes: str | None = None

    def to_markdown_row(self) -> str:
        date = self.date or ""
        name = self.adventure_name or ""
        notes = (self.notes or "").replace("\n", " ")
        return f"| {self.character} | {self.index} | {date} | {name} | {self.reason} | {notes} |"


def _detect_prefix(raw: str) -> str:
    for prefix in PREFIXES:
        if raw.startswith(prefix):
            return prefix
    raise ValueError("Unexpected data/data.js prefix")


def load_data() -> Dict[str, Any]:
    raw = DATA_PATH.read_text(encoding="utf-8")
    prefix = _detect_prefix(raw)
    global _current_prefix
    _current_prefix = prefix
    json_blob = raw[len(prefix) :].strip()
    if json_blob.endswith(";"):
        json_blob = json_blob[:-1]
    return json.loads(json_blob)


def write_data(data: Dict[str, Any]) -> None:
    json_blob = json.dumps(data, indent=2, ensure_ascii=False)
    prefix = _current_prefix or DEFAULT_PREFIX
    DATA_PATH.write_text(f"{prefix}{json_blob};\n", encoding="utf-8")


def iter_character_entries(character_info: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    adventures = character_info.get("adventures")
    if isinstance(adventures, list):
        return adventures
    logs = character_info.get("logs")
    if isinstance(logs, list):
        return logs
    return []


def get_title(log: Dict[str, Any]) -> str:
    return (log.get("title") or log.get("adventureName") or "").strip()


def get_code(log: Dict[str, Any]) -> str:
    return (log.get("code") or log.get("adventureCode") or "").strip()


def set_code(log: Dict[str, Any], value: str) -> None:
    if "code" in log or "adventureCode" not in log:
        log["code"] = value
    if "adventureCode" in log:
        log["adventureCode"] = value


def is_modern_entry(log: Dict[str, Any]) -> bool:
    return "title" in log or "code" in log or "trade" in log


def clean_trade_entry(
    character: str,
    index: int,
    log: Dict[str, Any],
    manual_issues: List[ManualIssue],
) -> None:
    raw_note = (log.get("notes") or "").strip()
    if not raw_note:
        return

    match = re.search(r"\btrade(?:d)?\b", raw_note, flags=re.IGNORECASE)
    if not match:
        return

    prefix = raw_note[: match.start()].strip(" .;")
    clause_and_after = raw_note[match.start() :].strip()

    clause = clause_and_after
    remainder_parts: List[str] = []
    if prefix:
        remainder_parts.append(prefix)

    for sep in [".\n", ";", "\n", "."]:
        if sep in clause:
            primary, after = clause.split(sep, 1)
            clause = primary.strip()
            after = after.strip()
            if after:
                remainder_parts.append(after)
            break
    clause = clause.strip()

    lower_clause = clause.lower()
    if lower_clause.startswith("traded "):
        body = clause[len("traded ") :].strip()
    elif lower_clause.startswith("trade "):
        body = clause[len("trade ") :].strip()
    else:
        manual_issues.append(
            ManualIssue(
                character,
                index,
                log.get("date"),
                get_title(log),
                "Unrecognised trade phrasing",
                raw_note,
            )
        )
        return

    if body.lower().startswith("to "):
        body = body[3:].strip()

    if " for " not in body or " to " not in body:
        manual_issues.append(
            ManualIssue(
                character,
                index,
                log.get("date"),
                get_title(log),
                "Could not parse trade structure",
                raw_note,
            )
        )
        return

    left, received_raw = body.split(" for ", 1)
    if " to " not in left:
        manual_issues.append(
            ManualIssue(
                character,
                index,
                log.get("date"),
                get_title(log),
                "Trade note missing trading counterparty",
                raw_note,
            )
        )
        return

    given_raw, counterparty_raw = left.rsplit(" to ", 1)

    given = ITEM_CORRECTIONS.get(given_raw.strip(" ."), given_raw.strip(" ."))
    counterparty = COUNTERPARTY_CORRECTIONS.get(counterparty_raw.strip(" ."), counterparty_raw.strip(" ."))

    received = ITEM_CORRECTIONS.get(received_raw.strip(" ."), received_raw.strip(" ."))
    suffix = f" to {character}"
    if received.endswith(suffix):
        received = received[: -len(suffix)].strip(" .")
    received = ITEM_CORRECTIONS.get(received, received)

    if not counterparty or " for " in counterparty.lower():
        manual_issues.append(
            ManualIssue(
                character,
                index,
                log.get("date"),
                get_title(log),
                "Trade counterparty unresolved",
                raw_note,
            )
        )
        return

    if not received:
        manual_issues.append(
            ManualIssue(
                character,
                index,
                log.get("date"),
                get_title(log),
                "Trade reward unresolved",
                raw_note,
            )
        )
        return

    trade_notes = " ".join(remainder_parts).strip() or None

    if is_modern_entry(log):
        trade = log.get("trade") if isinstance(log.get("trade"), dict) else {}
        trade["given"] = given or ""
        trade["received"] = received or ""
        trade["counterpartyCharacter"] = counterparty or ""
        if "counterpartyPlayer" not in trade:
            trade["counterpartyPlayer"] = ""
        log["trade"] = trade
    else:
        trades = log.get("trades", [{}])
        first = trades[0] if trades else {}
        first["tradeItemGiven"] = given or None
        first["tradeItemReceived"] = received or None
        first["tradeCharacterName"] = counterparty or None
        first["tradePlayerName"] = first.get("tradePlayerName") or None
        first["tradeNotes"] = trade_notes
        log["trades"] = [first]

    log["notes"] = trade_notes


def normalise_adventure_code(log: Dict[str, Any]) -> Optional[str]:
    code = get_code(log)
    if code:
        return code

    name = get_title(log)
    lower = name.lower()
    if not name:
        return None
    if "trade" in lower:
        return "DT-TRADE"
    if "dm reward" in lower:
        return "DM-REWARD"
    if "bastion" in lower:
        return "DT-BASTION"
    if "downtime activity" in lower:
        if "craft" in lower:
            return "DT-CRAFT"
        if "level up" in lower:
            return "DT-LEVEL-UP"
        return "DT-DOWNTIME"
    if "level up" in lower or "tier up" in lower:
        return "DT-LEVEL-UP"
    if "dreamwalker" in lower:
        return "DT-DREAMWALKER"
    if "scrib" in lower:
        return "DT-SCRIBE"
    if "contact" in lower:
        return "DT-CONTACT"
    if "fai chen" in lower:
        return "DT-FAI-CHEN"
    return None


def clean_legacy_trades(log: Dict[str, Any]) -> None:
    for trade in log.get("trades", []):
        if not isinstance(trade, dict):
            continue
        given = trade.get("tradeItemGiven")
        if isinstance(given, str):
            trade["tradeItemGiven"] = ITEM_CORRECTIONS.get(given, given)
        received = trade.get("tradeItemReceived")
        if isinstance(received, str):
            trade["tradeItemReceived"] = ITEM_CORRECTIONS.get(received, received)
        counterparty = trade.get("tradeCharacterName")
        if isinstance(counterparty, str):
            trade["tradeCharacterName"] = COUNTERPARTY_CORRECTIONS.get(counterparty, counterparty)
        notes = trade.get("tradeNotes")
        if isinstance(notes, str) and not notes.strip():
            trade["tradeNotes"] = None


def clean_modern_trade(log: Dict[str, Any]) -> None:
    trade = log.get("trade")
    if not isinstance(trade, dict):
        return

    given = trade.get("given")
    if isinstance(given, str):
        trade["given"] = ITEM_CORRECTIONS.get(given, given)

    received = trade.get("received")
    if isinstance(received, str):
        trade["received"] = ITEM_CORRECTIONS.get(received, received)

    counterparty = trade.get("counterpartyCharacter")
    if isinstance(counterparty, str):
        trade["counterpartyCharacter"] = COUNTERPARTY_CORRECTIONS.get(counterparty, counterparty)


def clean() -> None:
    data = load_data()
    manual: List[ManualIssue] = []

    for character, info in data.get("characters", {}).items():
        if not isinstance(info, dict):
            continue
        for index, log in enumerate(iter_character_entries(info), start=1):
            if not isinstance(log, dict):
                continue

            # Standardise empty notes.
            if isinstance(log.get("notes"), str) and not log["notes"].strip():
                log["notes"] = "" if is_modern_entry(log) else None

            # Normalise trade structures.
            clean_trade_entry(character, index, log, manual)

            # Ensure any pre-existing trade records use the corrected spellings.
            clean_legacy_trades(log)
            clean_modern_trade(log)

            # Fill missing adventure codes when possible.
            current_code = get_code(log)
            if isinstance(current_code, str) and current_code:
                remapped = ADVENTURE_CODE_REMAP.get(current_code.strip().lower())
                if remapped:
                    set_code(log, remapped)

            code = normalise_adventure_code(log)
            if code:
                set_code(log, code)
            elif not get_code(log):
                manual.append(
                    ManualIssue(
                        character,
                        index,
                        log.get("date"),
                        get_title(log),
                        "Adventure code still missing",
                        log.get("notes"),
                    )
                )

    write_data(data)

    if manual:
        MANUAL_PATH.write_text(
            "\n".join(
                [
                    "# Manual Corrections Needed",
                    "",
                    "The following entries could not be automatically normalised.",
                    "",
                    "| Character | Entry # | Date | Title | Reason | Notes |",
                    "| --- | --- | --- | --- | --- | --- |",
                    *[issue.to_markdown_row() for issue in manual],
                    "",
                ]
            ),
            encoding="utf-8",
        )
    else:
        MANUAL_PATH.write_text("# Manual Corrections Needed\n\nNone.\n", encoding="utf-8")


if __name__ == "__main__":
    clean()
