# Ward Pathways

A read-only Microsoft Fabric app (Rayfin) showing how mental health inpatient spells move between ward types from admission to discharge, and what a move from rehab back to an acute ward does to length of stay.

Data comes live from the `Ward_Movement` semantic model in the NLFT Business Intelligence workspace, through the `wardmodel` connector (`rayfin/rayfin.yml`). Each viewer signs in with their own Fabric account and needs access to that model. Patient-level spell data is held only in the viewer's browser.

Live app: https://easy-plume-dbb4a8caf5-ukwest.webapp.fabricapps.net

## What it shows

- **Controls**: highlight a move (default Adult rehab → Adult acute); group wards by local ward type, MHSDS bed type or broad group.
- **Headline tiles**: spells in view, share of rehab spells moved to acute, and current inpatients with that move.
- **Patient flow**: a Sankey of ward stays in order. Hover a ward or band to trace where those patients go; click to follow only them, keeping earlier wards visible (faded) and the real ward numbers. Changes animate. The flow can start at admission or at the first stay on any ward.
- **Total length of stay by pathway type**: every spell as a dot, with medians and interquartile ranges.
- **Length of stay by discharge ward**: average stay split by ward type, with options to remove chosen wards' days or leave out spells that used them. Click a bar or segment to drill through to the spells.
- **Current inpatients** who have had the highlighted move, with days on each ward.
- **All pathways**: every distinct ward sequence, searchable and sortable, with average stay. Open a pathway to see its spells, ward by ward, with admission and discharge dates. Downloadable as CSV.

Admission and discharge dates come from the model's `admission_date` and `discharge_date` columns (discharge is blank while a patient is in hospital).

## Run and deploy

```bash
npm install
npx rayfin login                     # once
npx rayfin up --workspace-id 37471f67-3749-414e-884b-01adfc920709 --item-name ward-pathways
npx rayfin up status
```

## Code

- `src/data/load.ts`: DAX queries. `src/data/shape.ts`: rows to spells, plus diagnosis and legal status groups.
- `src/analysis.ts`: shared helpers (move counting, formatting).
- `src/explorer.ts`: page layout, charts and tables (d3). `src/main.ts`: Fabric sign-in and loading.
