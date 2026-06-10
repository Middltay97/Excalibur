// Helpers for detecting out-of-sequence SKU scans within a bin.
// Bins are organized alphanumerically, so a scan is "out of sequence" when
// its normalized SKU sorts before the immediately previous scan's SKU.

import { canonicalKey } from "./sku-normalize";

// Delegate to the single shared canonical normalizer.
export function normalizeForSort(code: string | null | undefined): string {
  return canonicalKey(code);
}

export const canonicalizeSku = normalizeForSort;

// Weight chars so LETTERS sort BEFORE digits at any position
// (WMS-style alphanumeric: A-Z < 0-9). Letters get prefix '0', digits '1'.
function weightedKey(raw: string | null | undefined): string {
  const k = normalizeForSort(raw);
  let out = "";
  for (let i = 0; i < k.length; i++) {
    const ch = k[i];
    if (ch >= "a" && ch <= "z") out += "0" + ch;
    else if (ch >= "0" && ch <= "9") out += "1" + ch;
    else out += "2" + ch;
  }
  return out;
}

export function compareSku(a: string | null | undefined, b: string | null | undefined): number {
  const wa = weightedKey(a);
  const wb = weightedKey(b);
  return wa < wb ? -1 : wa > wb ? 1 : 0;
}

// Pure lexicographic alphanumeric comparison on the canonical body, with
// letters sorted before digits (matches WMS-style A→Z then 0→9 listings).
export function compareSkuLex(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  return compareSku(a, b);
}


// Given a log ordered newest-first, return a Set of indices that were
// scanned out of alphanumeric order relative to the previously scanned item.
// (log[i] was scanned AFTER log[i+1], so log[i] is out of sequence when
// log[i].sku sorts before log[i+1].sku.)
export function outOfSequenceIndices(
  log: Array<{ sku: string | null; barcode?: string | null }>,
): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < log.length - 1; i++) {
    const cur = log[i].sku ?? log[i].barcode ?? "";
    const prev = log[i + 1].sku ?? log[i + 1].barcode ?? "";
    if (!cur || !prev) continue;
    if (compareSku(cur, prev) < 0) out.add(i);
  }
  return out;
}
