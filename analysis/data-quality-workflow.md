# Data Quality Workflow

This project now relies on the browser-side data pipeline (`data-pipeline.js`) to
normalise and validate every `data.js` payload before it reaches the UI.
Understanding how that flow works is helpful when you need to diagnose or fix
bad records.

## Normalisation pipeline

* `normalizeData(raw)` coerces every character, adventure, and metadata field
  into a predictable shape (numbers, ISO dates, trimmed strings, tokenised
  lists). The function also returns a list of `issues` that can be surfaced in
  the UI or saved for later audit.【F:data-pipeline.js†L17-L212】【F:data-pipeline.js†L400-L456】
* `prepareForSave(data)` removes computed properties before serialising back to
  `data.js`, ensuring we only persist fields defined in the schema.【F:data-pipeline.js†L431-L448】
* `validateData(data)` is a light-weight check that runs the normaliser on a
  cloned payload and reports any issues without mutating the original.

## UI behaviour

`index.html` loads the pipeline, blocks on normalisation during bootstrap, and
shows a data-quality banner/modal whenever the validator reports issues. Manual
edits run through the same pipeline before save, so any problems must be fixed
in the GUI before they can be persisted.【F:index.html†L1295-L1382】【F:index.html†L1553-L1580】

Saving an edited log uses `prepareForSave` to strip derived fields, so the
written `data.js` file now matches the schema and is ready for version control
without post-processing.【F:index.html†L1339-L1350】

## Regenerating `data.js` outside the UI

You can run the pipeline in Node to regenerate a clean `data.js` file:

```bash
node - <<'NODE'
const fs = require('fs');
const vm = require('vm');
const pipeline = require('./data-pipeline');
const sandbox = { window:{}, globalThis:{} };
vm.createContext(sandbox);
const source = fs.readFileSync('./data.js','utf8');
vm.runInContext(source, sandbox);
const { data } = pipeline.normalizeData(sandbox.window.DATA);
const clean = pipeline.prepareForSave(data);
fs.writeFileSync('./data.js', 'window.DATA = ' + JSON.stringify(clean, null, 2) + ';\n');
NODE
```

The command above is what we used to regenerate the committed `data.js` so that
all derived properties (`__levelAfter`, cached search blobs, etc.) are gone from
source control.【F:data.js†L1-L40】
