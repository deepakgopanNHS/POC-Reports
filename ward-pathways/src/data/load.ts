import { runQuery } from "./client";
import { shapeWardData, type WardData } from "./shape";

export type { Spell, Stay, WardData } from "./shape";

// One row per ward stay. Kept narrow: 75k rows.
const STAYS_DAX = `
EVALUATE
SELECTCOLUMNS(
  WardMovement,
  "s", WardMovement[spell_id],
  "q", WardMovement[ward_seq],
  "w", WardMovement[ward_type],
  "b", WardMovement[bed_type],
  "d", WardMovement[days]
)`;

// One row per spell. These attributes are constant within a spell.
// admission_date and discharge_date are ISO text; discharge is "null" while in hospital.
const SPELLS_DAX = `
EVALUATE
SUMMARIZECOLUMNS(
  WardMovement[spell_id],
  "st", MIN(WardMovement[spell_status]),
  "y", YEAR(MIN(WardMovement[admission_month])),
  "am", FORMAT(MIN(WardMovement[admission_month]), "yyyy-mm"),
  "age", MIN(WardMovement[age_band]),
  "leg", MIN(WardMovement[legal_status]),
  "dx", MIN(WardMovement[primary_dx_icd3]),
  "ad", MIN(WardMovement[admission_date]),
  "dd", MIN(WardMovement[discharge_date])
)`;

const EXTRACT_DAX = `EVALUATE ROW("x", FORMAT(MAX(WardMovement[extract_date]), "d mmm yyyy"))`;

export async function loadWardData(): Promise<WardData> {
  const [stays, spells, ext] = await Promise.all([
    runQuery(STAYS_DAX, "Ward stays"),
    runQuery(SPELLS_DAX, "Spells"),
    runQuery(EXTRACT_DAX, "Extract date"),
  ]);
  return shapeWardData(stays, spells, ext[0]?.x);
}
