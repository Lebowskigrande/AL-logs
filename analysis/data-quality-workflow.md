# Data Quality Workflow

`data.js` is now committed in its already-normalised form, so the browser can
adopt the payload without running the heavy normalisation pass on every load.
The pipeline still powers validation and save operations, so understanding the
flow is helpful when you need to diagnose or fix bad records.

## Normalisation pipeline

* `normalizeData(raw)` coerces every character, adventure, and metadata field
  into a predictable shape (numbers, ISO dates, trimmed strings, tokenised
  lists). The function also returns a list of `issues` that can be surfaced in
  the UI or saved for later audit.【F:scripts/data-pipeline.js†L17-L212】【F:scripts/data-pipeline.js†L400-L456】
* `prepareForSave(data)` removes computed properties before serialising back to
  `data.js`, ensuring we only persist fields defined in the schema.【F:scripts/data-pipeline.js†L431-L448】
* `validateData(data)` is a light-weight check that runs the normaliser on a
  cloned payload and reports any issues without mutating the original.

## UI behaviour

`index.html` loads the pipeline, adopts the committed payload as-is, and then
uses `validateData` to surface any issues in the data-quality banner/modal.【F:index.html†L1378-L1402】

When you persist edits (saving or stashing a draft) the app clones the current
payload, runs it through `normalizeData`, and only then applies
`prepareForSave`. That means every change made in the GUI is normalised before
it leaves the browser, matching the workflow used by the Node helper.【F:index.html†L1405-L1440】【F:index.html†L3829-L3848】

## Regenerating `data.js` outside the UI

You can run the pipeline in Node to regenerate a clean `data.js` file:

```bash
node analysis/normalize-data.js
```

The script above regenerates the committed `data/data.js` so that all derived
properties (`__levelAfter`, cached search blobs, etc.) are gone from source
control.【F:data/data.js†L1-L40】
