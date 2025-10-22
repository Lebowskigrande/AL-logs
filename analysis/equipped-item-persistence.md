# Equipped item persistence findings

## Summary
- Active and attuned permanent items are written into each character's `inventory_state` structure, which is part of the shared `DATA` payload and therefore only persists after a successful `saveDataJs` call.
- Active supernatural gifts are stored in-memory on `DATA.characters[charKey].supernatural_active`, but today no records in `data.js` contain that field, implying the UI never persisted the value to the shared payload.
- Carried consumables are tracked exclusively in `localStorage`, so they never sync to other browsers or devices.

## Evidence
- Permanent inventory persistence funnels through `persistInventoryState`, which writes directly into `DATA.characters[charKey].inventory_state` and marks the data as dirty so it can be saved.【F:index.html†L7889-L7919】 The normalization pipeline keeps this field when preparing `data.js` for commit.【F:data-pipeline.js†L97-L109】【F:data-pipeline.js†L411-L437】
- Active supernatural gifts follow a parallel code path (`persistSupernaturalState`) that should populate a `supernatural_active` object on the character and mark the dataset dirty.【F:index.html†L7927-L7993】 The pipeline explicitly preserves this field.【F:data-pipeline.js†L111-L119】【F:data-pipeline.js†L411-L437】 Yet the current repository snapshot of `data.js` contains `inventory_state` entries but no `supernatural_active`, showing that the field is never making it back into the committed file.【F:data.js†L2068-L2107】【F:data.js†L11098-L11140】
- Carried consumables are read and written only through `localStorage` helpers (`loadCarriedConsumables` / `saveCarriedConsumables`), and there is no corresponding field on the shared data payload. This makes the state device-specific by design.【F:index.html†L8307-L8318】
- The server-side save endpoint simply commits whatever JSON payload the browser sends; there is no additional persistence layer that would reconcile per-device caches.【F:api/save-data.js†L1-L146】

## Recommendations
1. **Add server-backed storage for supernatural gifts.** Ensure that the UI calls `persistSupernaturalState` with `applyMode:'immediate'` (or otherwise guarantees it runs) when users pick a blessing/boon, and add regression coverage that verifies the resulting `supernatural_active` block survives a round-trip through the save pipeline.
2. **Persist carried consumables in shared data.** Introduce a canonical field (for example `consumables.carried`) under each character, store edits there instead of `localStorage`, and extend the pipeline so the field is normalized and emitted with `data.js`.
3. **Guard against silent save misses.** Add analytics or UI feedback after equipping items or gifts to prompt a `saveDataJs` call, and consider queueing an automatic save (or at least draft persistence) so the state survives navigation before the user explicitly clicks "Save".
4. **Implement conflict handling.** Because the save endpoint overwrites `data.js` on every request, add optimistic locking (e.g., with a SHA precondition) or surface merge conflicts so multi-device edits do not unexpectedly discard equipped states.

