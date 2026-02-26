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
  - `inventory_state` uses the `{ active, attuned, common }` array shape.
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
