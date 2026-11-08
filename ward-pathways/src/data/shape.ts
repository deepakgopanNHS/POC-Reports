export type DataRow = Record<string, unknown>;

/** One ward stay within a spell, in sequence order. */
export interface Stay {
  ward: string; // local ward type
  bed: string; // MHSDS bed type
  days: number;
}

/** One inpatient spell with its stays and case-mix attributes. */
export interface Spell {
  id: string;
  stays: Stay[];
  open: boolean;
  year: number;
  adm: string; // admission month, yyyy-mm
  age: string;
  legal: string;
  dx: string;
  admAt: number; // admission date-time, ms (NaN if missing)
  disAt: number; // discharge date-time, ms (NaN while in hospital)
}

export interface WardData {
  spells: Spell[];
  extractDate: string;
}

const str = (v: unknown): string => {
  const s = v == null ? "" : String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : "";
};
const num = (v: unknown): number => {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const when = (v: unknown): number => {
  const s = str(v);
  return s ? Date.parse(s) : NaN;
};

/** Shape raw query rows into spells. Exported so it can be tested without the connector. */
export function shapeWardData(stays: DataRow[], spells: DataRow[], extract: unknown): WardData {
  return { spells: buildSpells(stays, spells), extractDate: str(extract) };
}

function buildSpells(stayRows: DataRow[], spellRows: DataRow[]): Spell[] {
  const bySpell = new Map<string, { q: number; stay: Stay }[]>();
  for (const r of stayRows) {
    const id = str(r.s);
    if (!id) continue;
    const list = bySpell.get(id) ?? [];
    // A handful of stays have small negative durations; treat them as zero.
    list.push({
      q: num(r.q),
      stay: { ward: str(r.w) || "Unknown", bed: str(r.b) || "Unknown", days: Math.max(0, num(r.d)) },
    });
    bySpell.set(id, list);
  }
  const out: Spell[] = [];
  for (const r of spellRows) {
    const id = str(r.spell_id ?? r.s);
    const list = bySpell.get(id);
    if (!list) continue;
    list.sort((a, b) => a.q - b.q);
    out.push({
      id,
      stays: list.map((x) => x.stay),
      open: /inpatient/i.test(str(r.st)),
      year: num(r.y),
      adm: /^\d{4}-\d{2}$/.test(str(r.am)) ? str(r.am) : "",
      age: str(r.age) || "Unknown",
      legal: legalGroup(str(r.leg)),
      dx: dxGroup(str(r.dx)),
      admAt: when(r.ad),
      disAt: when(r.dd),
    });
  }
  return out;
}

/** Collapse Mental Health Act sections into a few groups for like-for-like comparison. */
function legalGroup(v: string): string {
  if (!v) return "Unknown";
  if (/^informal/i.test(v)) return "Informal";
  if (/^section 2$/i.test(v)) return "Section 2";
  if (/^section 3$/i.test(v)) return "Section 3";
  if (/section (37|38|47|48)/i.test(v)) return "Forensic section";
  if (/17a/i.test(v)) return "CTO recall";
  if (/section (135|136|5\()/i.test(v)) return "Place of safety / holding";
  return "Other";
}

/** ICD-10 F-chapter blocks. */
function dxGroup(v: string): string {
  const m = /^F(\d{2})/i.exec(v);
  if (!m) return v ? "Other (non-F code)" : "Not recorded";
  const n = +m[1];
  if (n < 10) return "Organic incl. dementia (F00–F09)";
  if (n < 20) return "Substance use (F10–F19)";
  if (n < 30) return "Psychosis (F20–F29)";
  if (n < 40) return "Mood (F30–F39)";
  if (n < 50) return "Anxiety & stress (F40–F48)";
  if (n < 60) return "Eating & behavioural (F50–F59)";
  if (n < 70) return "Personality (F60–F69)";
  if (n < 80) return "Learning disability (F70–F79)";
  return "Developmental & other (F80–F99)";
}
