// Centralized SKU normalization.
//
// Official SKU master formats:
//   10-char body:  XXXXX-XXXXX             e.g. 67293-08030
//   12-char body:  XXXXX-XXXXX-XX          e.g. 67772-04030-E0
//
// SKU bodies are alphanumeric (letters can appear anywhere, e.g. 63209-0E050).
//
// RF scanner payloads strip hyphens and append a metadata/check character.
// Two canonical scan shapes:
//   Rule A — 10-char body:  /^[A-Z0-9]{10}\s+[A-Z0-9]$/    e.g. "5312206040 D"
//   Rule B — 12-char body:  /^[A-Z0-9]{13}$/               e.g. "5384835120A17"
//
// We additionally accept master-formatted inputs (with hyphens) and compact
// 10/12-char strings so this same function can be used everywhere — scanner
// ingestion, display, lookups, exports, manual entry.

export type SkuParseResult = {
  raw: string;                 // original input, preserved exactly
  canonical: string | null;    // hyphenated canonical form, e.g. "53122-06040"
  body: string | null;         // alphanumeric body, no hyphens, UPPERCASE
  pattern:
    | "rule-a-10-space-suffix"
    | "rule-b-13-trailing-suffix"
    | "master-hyphenated"
    | "compact-10"
    | "compact-12"
    | "compact-11-trim-suffix"
    | "compact-13-trim-suffix"
    | "invalid";
  valid: boolean;
};

const ALNUM = /^[A-Z0-9]+$/;

let debug = false;
export function setSkuDebug(on: boolean) {
  debug = on;
}

function log(...args: unknown[]) {
  if (debug) console.log("[sku-normalize]", ...args);
}

function formatBody(body: string): string {
  if (body.length === 10) return `${body.slice(0, 5)}-${body.slice(5)}`;
  if (body.length === 12) return `${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10)}`;
  return body;
}

export function parseSkuScan(raw: string | null | undefined): SkuParseResult {
  const original = raw ?? "";
  // STEP 2: detect structure BEFORE trimming whitespace
  const upper = original.toUpperCase();

  // Rule A: 10 alnum + 1+ whitespace + 1 alnum metadata
  const a = upper.match(/^([A-Z0-9]{10})\s+[A-Z0-9]$/);
  if (a) {
    const body = a[1];
    const res: SkuParseResult = {
      raw: original,
      body,
      canonical: formatBody(body),
      pattern: "rule-a-10-space-suffix",
      valid: true,
    };
    log("ruleA", { raw: original, body, canonical: res.canonical });
    return res;
  }

  // Rule B: 13 alnum, last char is metadata
  const b = upper.match(/^([A-Z0-9]{12})[A-Z0-9]$/);
  if (b) {
    const body = b[1];
    const res: SkuParseResult = {
      raw: original,
      body,
      canonical: formatBody(body),
      pattern: "rule-b-13-trailing-suffix",
      valid: true,
    };
    log("ruleB", { raw: original, body, canonical: res.canonical });
    return res;
  }

  // Already-formatted master SKU (with hyphens) or compact alnum
  const trimmed = upper.trim();
  if (/^[A-Z0-9]{5}-[A-Z0-9]{5}(-[A-Z0-9]{2})?$/.test(trimmed)) {
    const body = trimmed.replace(/-/g, "");
    return {
      raw: original,
      body,
      canonical: formatBody(body),
      pattern: "master-hyphenated",
      valid: true,
    };
  }

  const compact = trimmed.replace(/[^A-Z0-9]/g, "");
  if (compact.length === 10 && ALNUM.test(compact)) {
    return { raw: original, body: compact, canonical: formatBody(compact), pattern: "compact-10", valid: true };
  }
  if (compact.length === 12 && ALNUM.test(compact)) {
    return { raw: original, body: compact, canonical: formatBody(compact), pattern: "compact-12", valid: true };
  }
  // Fallback truncations (defensive — scanner variants without separator)
  if (compact.length === 11 && ALNUM.test(compact)) {
    const body = compact.slice(0, 10);
    return { raw: original, body, canonical: formatBody(body), pattern: "compact-11-trim-suffix", valid: true };
  }
  if (compact.length === 13 && ALNUM.test(compact)) {
    const body = compact.slice(0, 12);
    return { raw: original, body, canonical: formatBody(body), pattern: "compact-13-trim-suffix", valid: true };
  }

  const res: SkuParseResult = {
    raw: original,
    body: null,
    canonical: null,
    pattern: "invalid",
    valid: false,
  };
  log("INVALID", {
    raw: original,
    rawLength: original.length,
    compactLength: compact.length,
  });
  return res;
}

// Compact uppercase body — for indexes, lookups, comparisons. Always compare
// canonical bodies, never raw strings.
export function canonicalBody(raw: string | null | undefined): string {
  return parseSkuScan(raw).body ?? (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Hyphenated display form. Falls back to the raw value when unparseable so
// the UI never shows blank.
export function displaySku(raw: string | null | undefined): string {
  const p = parseSkuScan(raw);
  return p.canonical ?? (raw ?? "").trim();
}

// Lowercase compact body for case-insensitive equality (matches DB
// normalize_code()).
export function canonicalKey(raw: string | null | undefined): string {
  return canonicalBody(raw).toLowerCase();
}

// ============================================================================
// Centralized normalization for SKU and bin values.
//
// Use these EVERYWHERE values cross a trust boundary: scanner input, CSV
// import, lookups, comparisons, display. They guarantee that "53153‑02090\r",
// "53153-02090 ", "53153-02090", and "53153–02090" all collapse to the same
// canonical form.
//
// Hidden characters we fold:
//   \r \n \t       carriage return / newline / tab (scanner suffixes)
//   \u00A0          non-breaking space (CSV from Excel)
//   \u200B-\u200D   zero-width characters
//   \uFEFF          BOM
// Unicode dashes folded to ASCII hyphen-minus "-":
//   \u2010 hyphen, \u2011 non-breaking hyphen, \u2012 figure dash,
//   \u2013 en dash, \u2014 em dash, \u2015 horizontal bar, \u2212 minus
// ============================================================================

const CONTROL_RE = /[\r\n\t\u00A0\u200B\u200C\u200D\uFEFF]/g;
const UNICODE_DASH_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

/** Canonical SKU. Strips all whitespace, folds dashes, uppercases. */
export function normalizeSku(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(CONTROL_RE, "")
    .replace(UNICODE_DASH_RE, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/** Canonical bin. Preserves leading zeros and single-spaces; trims edges. */
export function normalizeBin(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(CONTROL_RE, " ")
    .replace(UNICODE_DASH_RE, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Bin equivalence with leading-zero tolerance for numeric bins. */
export function binsMatch(a: unknown, b: unknown): boolean {
  const na = normalizeBin(a);
  const nb = normalizeBin(b);
  if (na === nb) return true;
  if (/^\d+$/.test(na) && /^\d+$/.test(nb)) {
    return na.replace(/^0+/, "") === nb.replace(/^0+/, "");
  }
  return false;
}

/** Debug snapshot for a raw scan — for failed-lookup logging only. */
export function scanDiagnostic(raw: unknown) {
  const rawStr = raw == null ? "" : String(raw);
  const normalized = normalizeSku(rawStr);
  return {
    raw: rawStr,
    normalized,
    length: normalized.length,
    rawLength: rawStr.length,
    charCodes: Array.from(rawStr).map((c) => c.charCodeAt(0)),
  };
}
