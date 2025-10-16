"""Generate a level accrual report from the DM log data.

The front-end (``index.html``) computes the "levels available" indicator by
parsing the DM log, identifying allocations that grant an additional level to
the pool, and subtracting any levels spent. This script mirrors that logic so
the calculation can be inspected from the command line.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DM_DATA_PATH = ROOT / "dmData.js"

DM_DATA_PATTERN = re.compile(r"window\.DMDATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$", re.MULTILINE)
@dataclass
class LevelEvent:
    """Represents an allocation or run that affects the level pool."""

    date: str
    season: str
    kind: str  # "allocation" or "run"
    description: str
    levels_earned: int
    levels_spent: float


def load_dm_data() -> Dict[str, Any]:
    raw = DM_DATA_PATH.read_text(encoding="utf-8")
    match = DM_DATA_PATTERN.search(raw)
    if not match:
        raise RuntimeError("Could not locate window.DMDATA payload")
    return json.loads(match.group(1))


def normalize_match_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def extract_allocation_recipient_details(text: Any) -> List[Dict[str, Any]]:
    raw = str(text or "")
    if not raw.strip():
        return []
    lower = raw.lower()
    first_to_idx = lower.find(" to ")
    if first_to_idx == -1:
        return []
    leading_segment = raw[:first_to_idx]

    def extract_levelish_number(segment: str) -> Optional[int]:
        if not segment:
            return None
        for match in re.finditer(r"([0-9]+)", segment):
            try:
                value = int(match.group(1))
            except ValueError:
                continue
            after = segment[match.end() :]
            after_stripped = after.lstrip()
            if not after_stripped:
                return value
            next_char = after_stripped[0]
            if next_char in ",.)]":
                return value
            lowered = after_stripped.lower()
            for prefix in ("level", "levels", "lvl", "to"):
                if lowered.startswith(prefix):
                    return value
            # Numbers that are immediately followed by alphabetic characters (e.g. "3rd" or
            # "10k") should not be treated as level counts.
            if next_char.isalpha():
                continue
            return value
        return None

    leading_number = extract_levelish_number(leading_segment)
    first_count_hint = int(leading_number) if leading_number is not None else None
    tail = raw[first_to_idx + 4 :]
    tail = re.sub(r"[,.;]+$", "", tail)
    tail = re.sub(r"\band\b", ",", tail, flags=re.I)
    tail = tail.replace("&", ",").replace("/", ",")

    def extract_number(segment: str) -> Optional[int]:
        return extract_levelish_number(segment or "")

    results: List[Dict[str, Any]] = []
    for index, part in enumerate(filter(None, (p.strip() for p in tail.split(",")))):
        working = part
        count_hint: Optional[int] = None
        inner_to_idx = working.lower().rfind(" to ")
        if inner_to_idx != -1:
            before_inner = working[:inner_to_idx]
            after_inner = working[inner_to_idx + 4 :].strip()
            if after_inner:
                working = after_inner
            inner_number = extract_number(before_inner)
            if inner_number is not None:
                count_hint = inner_number
        prefix_match = re.match(r"^([0-9]+)\s*(?:levels?|lvl)?\b", working, flags=re.I)
        if prefix_match:
            count_hint = int(prefix_match.group(1))
            working = working[prefix_match.end() :].strip()
        multiplier_match = re.search(r"\(x\s*([0-9]+)\s*\)", working, flags=re.I)
        if multiplier_match:
            count_hint = int(multiplier_match.group(1))
            working = re.sub(r"\(x\s*[0-9]+\s*\)", "", working, count=1, flags=re.I).strip()
        suffix_match = re.search(r"([0-9]+)\s*(?:levels?|lvl)\b", working, flags=re.I)
        if suffix_match:
            count_hint = int(suffix_match.group(1))
            working = working.replace(suffix_match.group(0), "").strip()
        working = re.sub(r"^[+&]+", "", working).strip()
        if not working:
            continue
        if count_hint is None and index == 0 and first_count_hint is not None:
            count_hint = first_count_hint
        if count_hint is None:
            count_hint = 1
        results.append({"name": working, "count": count_hint})
    return results


def extract_allocation_item_tokens(text: Any) -> List[str]:
    if isinstance(text, dict):
        tokens = text.get("allocation_item_tokens")
        if isinstance(tokens, list):
            return list(tokens)
        text = text.get("allocation", "")
    raw = str(text or "")
    if not raw:
        return []
    idx = raw.lower().rfind(" to ")
    before = raw if idx == -1 else raw[:idx]
    candidates = [normalize_match_token(part) for part in re.split(r"[+,&/]+", before)]
    tokens: List[str] = []
    for token in candidates:
        if not token or len(token) < 4:
            continue
        if not re.search(r"[a-z]", token):
            continue
        if re.fullmatch(r"(?:level|levels|hours|extra|bonus|dtd|gp)", token):
            continue
        if token[0].isdigit():
            continue
        tokens.append(token)
    seen: List[str] = []
    for token in tokens:
        if token not in seen:
            seen.append(token)
    return seen


def interpret_allocation_details(text: Any) -> Dict[str, Any]:
    raw = str(text or "")
    recipients = [item["name"] for item in extract_allocation_recipient_details(raw)]
    item_tokens = extract_allocation_item_tokens(raw)
    tokens = {f"item:{token}" for token in item_tokens if token}

    def add_numeric_token(prefix: str, value: Optional[float]) -> None:
        if value is None:
            return
        rounded = int(value) if value % 1 == 0 else round(value, 2)
        tokens.add(f"{prefix}:{rounded}")

    def normalize_number(value: Any, thousand_flag: Any) -> Optional[float]:
        if value is None:
            return None
        cleaned = str(value).replace(",", "")
        if not cleaned:
            return None
        try:
            number = float(cleaned)
        except ValueError:
            return None
        if thousand_flag:
            number *= 1000
        return number

    detail: Dict[str, Any] = {
        "recipients": recipients,
        "itemTokens": item_tokens,
        "tokens": None,
        "levelsSpent": None,
        "levelsGained": None,
        "downtimeSpent": None,
        "goldSpent": None,
    }

    for rec in recipients:
        normalized = normalize_match_token(rec)
        if normalized:
            tokens.add(f"recipient:{normalized}")

    explicit_level_matches: List[float] = []
    for match in re.finditer(r"(?:^|[\s,+/&-])([0-9]+)\s*(?:levels?|lvl)\b", raw, flags=re.I):
        parsed = normalize_number(match.group(1), False)
        if parsed is not None:
            explicit_level_matches.append(parsed)
    explicit_level_total = sum(explicit_level_matches)
    has_level_keyword = bool(re.search(r"\b(?:levels?|lvl)\b", raw, flags=re.I))
    level_assignment_hint = bool(
        re.search(r"\blevels?\s+to\b", raw, flags=re.I)
        or re.search(r"\blvl\s+to\b", raw, flags=re.I)
    )

    multiplier_matches: List[float] = []
    for match in re.finditer(r"\(x\s*([0-9]+)\s*\)", raw, flags=re.I):
        parsed = normalize_number(match.group(1), False)
        if parsed is not None:
            multiplier_matches.append(parsed)

    if has_level_keyword and level_assignment_hint:
        recipient_details = extract_allocation_recipient_details(raw)
        levels_from_recipients = sum(
            item["count"]
            for item in recipient_details
            if isinstance(item, dict)
            and isinstance(item.get("count"), (int, float))
            and item["count"] > 0
        )
        if levels_from_recipients > 0:
            detail["levelsSpent"] = levels_from_recipients
        elif explicit_level_total > 0:
            detail["levelsSpent"] = explicit_level_total
        elif multiplier_matches:
            multiplier_total = sum(multiplier_matches)
            if multiplier_total > 0:
                detail["levelsSpent"] = multiplier_total
        elif recipient_details:
            detail["levelsSpent"] = len(recipient_details)
        else:
            detail["levelsSpent"] = 1

    dtd_matches: List[float] = []
    for match in re.finditer(r"([0-9][0-9,]*)(?:\s*(k))?\s*dtd\b", raw, flags=re.I):
        parsed = normalize_number(match.group(1), match.group(2))
        if parsed is not None:
            dtd_matches.append(parsed)
    if dtd_matches:
        dtd_total = sum(dtd_matches)
        if dtd_total > 0:
            detail["downtimeSpent"] = dtd_total

    gp_matches: List[float] = []
    for match in re.finditer(r"([0-9][0-9,]*)(?:\s*(k))?\s*gp\b", raw, flags=re.I):
        parsed = normalize_number(match.group(1), match.group(2))
        if parsed is not None:
            gp_matches.append(parsed)
    if gp_matches:
        gp_total = sum(gp_matches)
        if gp_total > 0:
            detail["goldSpent"] = gp_total

    if detail["levelsSpent"] is not None:
        add_numeric_token("levels", float(detail["levelsSpent"]))
    if detail["downtimeSpent"] is not None:
        add_numeric_token("dtd", float(detail["downtimeSpent"]))
    if detail["goldSpent"] is not None:
        add_numeric_token("gp", float(detail["goldSpent"]))

    detail["tokens"] = list(tokens)
    return detail


def parse_season_number(label: str) -> Optional[int]:
    if not label:
        return None
    match = re.search(r"season\s*(\d+)", str(label), flags=re.I)
    if not match:
        return None
    value = int(match.group(1))
    return value


def allocation_season_eligible_for_level_accrual(season_label: str) -> bool:
    if not season_label:
        return True
    normalized = str(season_label).lower()
    if "pre-season 11" in normalized or "pre season 11" in normalized:
        return False
    season_number = parse_season_number(season_label)
    if season_number is None:
        return True
    return season_number >= 11


def allocation_has_non_level_reward(allocation_text: str, parsed: Optional[Dict[str, Any]] = None) -> bool:
    detail = parsed or interpret_allocation_details(allocation_text)
    if detail.get("downtimeSpent") and detail["downtimeSpent"] > 0:
        return True
    if detail.get("goldSpent") and detail["goldSpent"] > 0:
        return True
    tokens = detail.get("itemTokens") or []
    if any(token and not re.search(r"(?:loss|period|expire|expiration|forfeit|penalty)", token, flags=re.I) for token in tokens):
        return True
    raw = str(allocation_text or "").lower()
    if not raw.strip():
        return False
    if re.search(r"\b(loss|forfeit|expire|expiration|penalty)\b", raw):
        return False
    if re.search(
        r"\b(?:reward|item|potion|tattoo|wand|staff|amulet|boots|armor|shield|ring|stone|cloak|rod|scroll|saddle|quiver|caress|fiddle|maul|sword|bow|splint|mace|gem|guide|arrows|favor|rescue|gloves|cowl|blade|tome|pen|shawl|sling)\b",
        raw,
    ):
        return True
    if "+" in raw:
        return True
    return False


def is_level_only_allocation(allocation_text: str, parsed: Optional[Dict[str, Any]] = None) -> bool:
    detail = parsed or interpret_allocation_details(allocation_text)
    levels_spent = detail.get("levelsSpent")
    if levels_spent is None or not isinstance(levels_spent, (int, float)) or levels_spent <= 0:
        return False
    if detail.get("itemTokens"):
        return False
    if detail.get("downtimeSpent") and detail["downtimeSpent"] > 0:
        return False
    if detail.get("goldSpent") and detail["goldSpent"] > 0:
        return False
    working = str(allocation_text or "").lower()
    if not working.strip():
        return False
    recipients = detail.get("recipients") or []
    for name in recipients:
        if not name:
            continue
        lowered = str(name).lower().strip()
        if not lowered:
            continue
        working = re.sub(re.escape(lowered), " ", working, flags=re.I)
    working = re.sub(r"\b\d+\s*(?:levels?|lvl)\b", " ", working)
    working = re.sub(r"\blevels?\b", " ", working)
    working = re.sub(r"\bplayer\b", " ", working)
    working = re.sub(r"\brewards?\b", " ", working)
    working = re.sub(r"\band\b", " ", working)
    working = re.sub(r"\bbonus\b", " ", working)
    working = re.sub(r"\bto\b", " ", working)
    working = re.sub(r"[+,&:()]+", " ", working)
    working = re.sub(r"\s+", " ", working).strip()
    return working == ""


def allocation_grants_level_to_pool(
    season_label: str, allocation_text: str, parsed: Optional[Dict[str, Any]] = None
) -> bool:
    if not allocation_season_eligible_for_level_accrual(season_label):
        return False
    if is_level_only_allocation(allocation_text, parsed):
        return False
    return allocation_has_non_level_reward(allocation_text, parsed)


def dm_normalize_season_label(label: Any) -> str:
    text = str(label or "").strip()
    return text or "Unlabeled season"


def dm_to_nullable_number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not (number == number):  # NaN check
        return None
    return number


def build_level_events(dm_data: Dict[str, Any]) -> Tuple[List[LevelEvent], Dict[str, Dict[str, float]]]:
    events: List[LevelEvent] = []
    per_season: Dict[str, Dict[str, float]] = {}

    def season_bucket(season: str) -> Dict[str, float]:
        season = dm_normalize_season_label(season)
        bucket = per_season.setdefault(
            season,
            {
                "earned": 0.0,
                "spent": 0.0,
                "net": 0.0,
                "runs": 0,
                "allocations": 0,
            },
        )
        return bucket

    def add_run(season_label: str, run: Dict[str, Any]) -> None:
        season = dm_normalize_season_label(season_label)
        levels_plus = dm_to_nullable_number(run.get("levels_plus"))
        levels_minus = dm_to_nullable_number(run.get("levels_minus"))
        eligible = allocation_season_eligible_for_level_accrual(season)
        bucket = season_bucket(season)
        bucket["runs"] += 1
        earned = levels_plus or 0.0
        spent = levels_minus or 0.0
        if eligible and (earned or spent):
            events.append(
                LevelEvent(
                    date=str(run.get("date") or ""),
                    season=season,
                    kind="run",
                    description=str(run.get("name") or run.get("code") or ""),
                    levels_earned=int(earned),
                    levels_spent=spent,
                )
            )
            if earned:
                bucket["earned"] += earned
            if spent:
                bucket["spent"] += spent

    def add_allocation(season_label: str, alloc: Dict[str, Any]) -> None:
        season = dm_normalize_season_label(season_label)
        bucket = season_bucket(season)
        bucket["allocations"] += 1
        allocation_text = str(alloc.get("allocation") or "")
        parsed = interpret_allocation_details(allocation_text)
        parsed_levels = parsed.get("levelsSpent")
        raw_levels = dm_to_nullable_number(alloc.get("levels_plus"))
        has_level_keyword = bool(re.search(r"\b(?:levels?|lvl)\b", allocation_text, flags=re.I))
        level_assignment_hint = bool(
            re.search(r"\blevels?\s+to\b", allocation_text, flags=re.I)
            or re.search(r"\blvl\s+to\b", allocation_text, flags=re.I)
        )
        levels_spent: Optional[float]
        if isinstance(parsed_levels, (int, float)) and parsed_levels > 0:
            levels_spent = float(parsed_levels)
        else:
            levels_spent = None

        if (
            has_level_keyword
            and level_assignment_hint
            and isinstance(raw_levels, (int, float))
            and raw_levels > 0
            and (levels_spent is None or raw_levels > levels_spent)
        ):
            levels_spent = float(raw_levels)

        earns_level = allocation_grants_level_to_pool(season, allocation_text, parsed)
        eligible = allocation_season_eligible_for_level_accrual(season)
        earned = 1 if earns_level else 0
        spent = levels_spent or 0.0
        if eligible and (earned or spent):
            events.append(
                LevelEvent(
                    date=str(alloc.get("date") or ""),
                    season=season,
                    kind="allocation",
                    description=allocation_text,
                    levels_earned=earned,
                    levels_spent=spent,
                )
            )
            if earned:
                bucket["earned"] += earned
            if spent:
                bucket["spent"] += spent

    pre_entries = dm_data.get("preS11")
    if isinstance(pre_entries, list):
        for entry in pre_entries:
            season = dm_normalize_season_label("Pre-Season 11")
            bucket = season_bucket(season)
            bucket["runs"] += 1
            # Pre-season allocations never count toward the level pool, so we skip
            # adding LevelEvent records here.

    seasonal = dm_data.get("seasonal")
    if isinstance(seasonal, dict):
        for season_name, season_data in seasonal.items():
            runs = season_data.get("runs") if isinstance(season_data, dict) else None
            if isinstance(runs, list):
                for run in runs:
                    add_run(season_name, run)
            allocations = season_data.get("allocations") if isinstance(season_data, dict) else None
            if isinstance(allocations, list):
                for alloc in allocations:
                    add_allocation(season_name, alloc)

    for bucket in per_season.values():
        bucket["net"] = bucket["earned"] - bucket["spent"]

    events.sort(key=lambda evt: (evt.date or "", evt.season, evt.kind))
    return events, per_season


def fmt_number(value: float) -> str:
    if isinstance(value, int) or value.is_integer():
        return f"{int(value)}"
    return f"{value:.2f}"


def render_report(events: Iterable[LevelEvent], per_season: Dict[str, Dict[str, float]]) -> str:
    total_earned = sum(bucket["earned"] for bucket in per_season.values())
    total_spent = sum(bucket["spent"] for bucket in per_season.values())
    lines = []
    lines.append("Level accrual summary\n=======================\n")
    lines.append(f"Total levels earned: {fmt_number(total_earned)}")
    lines.append(f"Total levels spent: {fmt_number(total_spent)}")
    lines.append(f"Net available levels: {fmt_number(total_earned - total_spent)}\n")

    if per_season:
        lines.append("Breakdown by season:")
        lines.append("Season | Earned | Spent | Net")
        lines.append(":-- | --: | --: | --:")
        for season, bucket in sorted(per_season.items()):
            if not allocation_season_eligible_for_level_accrual(season):
                continue
            lines.append(
                f"{season} | {fmt_number(bucket['earned'])} | {fmt_number(bucket['spent'])} | {fmt_number(bucket['net'])}"
            )
        lines.append("")

    relevant_events = [evt for evt in events if evt.levels_earned or evt.levels_spent]
    if relevant_events:
        lines.append("Level-impacting entries:")
        lines.append("Date | Season | Type | Earned | Spent | Description")
        lines.append(":-- | :-- | :-- | --: | --: | :--")
        for evt in relevant_events:
            lines.append(
                f"{evt.date or '—'} | {evt.season} | {evt.kind} | "
                f"{fmt_number(evt.levels_earned)} | {fmt_number(evt.levels_spent)} | {evt.description or '—'}"
            )
    return "\n".join(lines)


def main() -> None:
    dm_data = load_dm_data()
    events, per_season = build_level_events(dm_data)
    report = render_report(events, per_season)
    print(report)


if __name__ == "__main__":
    main()
