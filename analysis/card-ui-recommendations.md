# Card, Edit, and New Entry UI Review

## Current layout observations

### Collapsed and expanded card states
- Cards are composed in `makeCard`, which builds a header with the title, metadata, and date blocks stacked vertically in `.log-row-info`, followed by an optional chip row for level, GP, and downtime totals.【F:index.html†L4730-L4858】
- The metadata block formats date, code, DM name, and downtime flag into a bullet-separated `pre`, while the date is also rendered separately in `.log-row-date`, so the same information appears twice when the card is closed.【F:index.html†L4761-L4786】
- Expanded content lives inside `.card-bd`, which slides open and contains two parallel structures: a read-only `.bd-in` summary and a `.edit-form` with the same data in editable fields.【F:index.html†L294-L313】【F:index.html†L4917-L4950】

### Edit mode experience
- Field groups rely on vertically stacked `.field` wrappers with light labels and large margins, so even short entries consume a lot of vertical space when editing.【F:index.html†L307-L349】
- Numeric inputs for gold and downtime are split into individual `.kvsingle` rows within `.kv2` grids, but the controls still align labels in a separate column, increasing the form depth.【F:index.html†L352-L360】【F:index.html†L4984-L5028】
- Entering edit mode appends action buttons above the form and toggles the read-only block, producing duplicated content and a long scroll when many optional sections are present.【F:index.html†L4918-L4950】【F:index.html†L5004-L5076】

### New-entry overlay
- Creating a new log entry instantiates the same card markup, applies `overlay-card`, and injects it into the fixed `.card-overlay` modal capped at 720 px wide.【F:index.html†L1234-L1243】【F:index.html†L516-L519】
- The overlay keeps the full card chrome (header chips, edit controls) even though the user only needs the form, which adds visual noise in the constrained modal space.【F:index.html†L4730-L4934】【F:index.html†L516-L519】

## Recommendations

### 1. Streamline the card header hierarchy
- Merge `.log-row-meta` details (date, code, DM) into the primary header row next to the title instead of repeating the date block underneath; reserve the secondary line for optional tags such as downtime status.【F:index.html†L4738-L4786】
- Replace the text-heavy chips with more compact icon-tag pairs, or consolidate GP/DTD deltas into a single “Totals” pill, so crowded entries no longer shorten their titles to make room for three separate slots.【F:index.html†L4788-L4867】

### 2. Reduce duplication between read and edit states
- Consider rendering field values once and swapping individual controls in place, rather than maintaining both `.bd-in` and `.edit-form` trees; this would halve the markup in `.card-bd` and cut the scroll height for expanded cards.【F:index.html†L294-L313】【F:index.html†L4917-L4950】
- If dual rendering is required, hide the read-only `.bd-in` entirely during edit mode instead of keeping both blocks in the DOM, to save space and simplify focus order.【F:index.html†L294-L313】【F:index.html†L4917-L4950】

### 3. Reshape the edit form for better scanning
- Convert the `.field` stack into a responsive grid (e.g., 2-column above 768 px) so related inputs sit side by side; the existing `.kv2` structure can be generalized across the form to reduce vertical whitespace.【F:index.html†L307-L360】【F:index.html†L352-L360】
- Group optional sections (magic items, consumables, gifts, notes) behind collapsible accordions or pill toggles so rarely used lists stay collapsed until needed, improving perceived simplicity.【F:index.html†L4984-L5076】
- Add inline helper text or placeholder examples directly under inputs rather than relying on muted labels above them, keeping the form visually denser without sacrificing clarity.【F:index.html†L307-L349】

### 4. Focus the new-entry modal on task completion
- When a card is launched inside `.card-overlay`, skip rendering chips and the read-only summary so the modal opens straight into edit mode with a task-specific heading and primary action button anchored at the top or bottom.【F:index.html†L516-L519】【F:index.html†L1234-L1243】
- Expand the modal width on large screens or allow a multi-step flow (basic details first, optional extras second) so first-time users are not overwhelmed by the full adventure schema at once.【F:index.html†L516-L519】【F:index.html†L4984-L5076】

### 5. Polish interaction affordances
- Keep the floating `.card-actions` visible (at reduced opacity) even when the card is collapsed so users can discover editing without expanding first, reducing clicks.【F:index.html†L4918-L4934】
- Introduce clearer section dividers or subtle background panels inside `.card-bd` to visually separate Rewards, Items, and Notes, reinforcing hierarchy and improving attractiveness without additional space.【F:index.html†L294-L349】【F:index.html†L4984-L5076】

Implementing these adjustments would make the cards more legible at a glance, shorten the editing workflow, and ensure the new-entry dialog feels purpose-built instead of a squeezed version of the full card UI.
