import * as d3 from "d3";
import type { Spell } from "./data/shape";

/* ---------- types & helpers ---------- */

export type GroupBy = "ward" | "bed" | "broad";
export type Status = "all" | "disc" | "open";

export interface Seg {
  ward: string;
  days: number;
}
export interface S extends Spell {
  seq: Seg[]; // consecutive stays of the same type merged
  path: string[];
  los: number;
}

export const DOT_CAP = 1200; // dots drawn per LOS row; stats always use every spell

/** Broad groups built from the local ward type. */
export const BROAD: Record<string, string> = {
  "Adult acute": "Acute",
  "Adult assessment": "Acute",
  "Older adult acute": "Acute",
  "CAMHS acute": "Acute",
  "Adult PICU": "PICU",
  "Adult rehab": "Rehab / step-down",
  "Older adult step-down": "Rehab / step-down",
  Forensic: "Forensic / secure",
  "Older adult CONC": "Continuing care",
  "Adult CONC": "Continuing care",
  "Eating disorders": "Eating disorders",
};
export function broad(w: string): string {
  if (BROAD[w]) return BROAD[w];
  if (/rehab|step.?down/i.test(w)) return "Rehab / step-down";
  if (/picu/i.test(w)) return "PICU";
  if (/secure|forensic/i.test(w)) return "Forensic / secure";
  if (/acute|assess/i.test(w)) return "Acute";
  return w;
}

export const fmt = d3.format(",");
export const fd = (x: number) => fmt(Math.round(x));
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + "%" : "–");
export const q = (arr: number[], p: number) => d3.quantileSorted(arr, p) ?? NaN;
export const sorted = (xs: number[]) => xs.slice().sort(d3.ascending);
export const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export function seeded(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function moves(s: S, from: string, to: string): number {
  let n = 0;
  for (let i = 0; i < s.path.length - 1; i++) if (s.path[i] === from && s.path[i + 1] === to) n++;
  return n;
}
export function returnedTo(s: S, from: string, to: string): boolean {
  for (let i = 0; i < s.path.length - 1; i++)
    if (s.path[i] === from && s.path[i + 1] === to) return s.path.slice(i + 2).includes(from);
  return false;
}
/** Days on the "from" ward before the first from→to move. */
export function daysBeforeMove(s: S, from: string, to: string): number | null {
  for (let i = 0; i < s.path.length - 1; i++)
    if (s.path[i] === from && s.path[i + 1] === to) return s.seq[i].days;
  return null;
}
/** Days from the last from→to move to discharge (or to now). */
export function daysAfterMove(s: S, from: string, to: string): number | null {
  let k = -1;
  for (let i = 0; i < s.path.length - 1; i++) if (s.path[i] === from && s.path[i + 1] === to) k = i + 1;
  return k < 0 ? null : d3.sum(s.seq.slice(k), (x) => x.days);
}

