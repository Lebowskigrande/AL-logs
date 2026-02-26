# Data Quality Workflow

`data/data.js` is committed in normalized form so the browser can load it without
running a heavy normalization pass on each page load.

## Normalization Pipeline

- `normalizeData(raw)` coerces characters, adventures, and metadata into a
  predictable shape and emits normalization issues.
- `prepareForSave(data)` strips internal/computed fields before serializing back
  to `data/data.js`.
- `validateNormalizedData(data)` performs explicit schema/invariant checks on
  normalized payloads. It verifies:
  - `characters` is an object.
  - each adventure contains required fields.
  - adventure dates are strict ISO `YYYY-MM-DD`.
  - `kind` is one of `adventure` or `Downtime Activity`.
  - `trade` uses the allowed object shape.
  - `item_events` uses the canonical lifecycle event shape.
  - `inventory_state` uses the `{ active, attuned, common }` array shape.
- `validateItemEventIntegrity(data)` performs cross-entry integrity checks:
  - outgoing item events must have a prior acquisition path.
  - legacy trades should have reciprocal inverse entries on both character logs.
  - explicit `trade_id` groups should contain exactly two reciprocal legs.
- `validateData(data)` runs normalization and then invariant validation,
  returning both issue sets without mutating the original input.

## UI Behavior

`index.html` loads the pipeline, adopts committed payload data, and runs
validation so data-quality issues can be surfaced in the UI.

When saving edits, the app normalizes first and then applies `prepareForSave`,
so persisted output follows the same schema contract as the Node pipeline.

## Regenerating `data/data.js`

```bash
node analysis/normalize-data.js
```

## Automated Tests

```bash
npm test
```

This uses a lightweight Node assertion runner via `tests/run-tests.js`, so no
external test dependencies are required.

## Integrity Audit Report

```bash
npm run audit:data
```

This writes `analysis/data-integrity-report.json` with issue counts, severities,
and top examples for the highest-priority cleanup categories.

## Manual Cleanup UI

Open `cleanup.html` in the app to review integrity issues, apply guided fixes,
edit individual adventure JSON entries, revalidate, and save back to
`data/data.js`.
