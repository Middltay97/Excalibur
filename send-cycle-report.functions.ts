// Performance metric calculators for cycle counts.
// Pure functions — no Supabase / React deps so they're easy to reason about.

export interface PerfEvent {
  id: string;
  cycle_id: string;
  user_id: string;
  item_id: string | null;
  action: string;
  qty_before: number | null;
  qty_after: number | null;
  created_at: string; // ISO
}

export interface PerfItem {
  id: string;
  cycle_id: string;
  sku: string | null;
  description: string | null;
  expected_qty: number;
  counted_qty: number | null;
  counted_by: string | null;
  counted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_unexpected: boolean;
}

export interface PerfCycle {
  id: string;
  name: string;
  status: string;
  count_started_at: string | null;
  count_ended_at: string | null;
}

export interface PerfProfile {
  id: string;
  full_name: string | null;
  team_id?: string | null;
}

export interface UserMetrics {
  userId: string;
  userName: string;
  itemsCounted: number;
  pieces: number;
  loiMs: number; // length of inventory window
  pph: number; // pieces per hour (cumulative average)
  accuracy: number; // 0..1, NaN if no verified items
  aph: number; // pph * accuracy
  downtimeMs: number;
  verifiedItems: number;
  correctItems: number;
}

export interface HourlyBucket {
  hour: number;
  label: string;
  pieces: number;
  pph: number;
  cumulativePph: number;
  downtimeMin: number;
}

const MS_PER_HOUR = 3_600_000;

/** Pieces represented by a single event. Falls back to 1 for adds with no qty diff. */
export function piecesFor(ev: PerfEvent): number {
  const before = Number(ev.qty_before ?? 0);
  const after = Number(ev.qty_after ?? 0);
  const diff = after - before;
  if (diff > 0) return diff;
  if (ev.action === "unexpected" && after > 0) return after;
  return Math.max(0, diff);
}

/** Total downtime: sum of inter-event gaps exceeding `gapThresholdMs`. */
export function downtimeMs(
  events: PerfEvent[],
  gapThresholdMs: number,
): number {
  if (events.length < 2) return 0;
  const sorted = [...events].sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  );
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap =
      +new Date(sorted[i].created_at) - +new Date(sorted[i - 1].created_at);
    if (gap > gapThresholdMs) total += gap;
  }
  return total;
}

/** LOI window for a set of events (max - min). */
export function loiFromEvents(events: PerfEvent[]): number {
  if (events.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const e of events) {
    const t = +new Date(e.created_at);
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return max - min;
}

/**
 * Accuracy for a user. For each item the verifier finalised, compare the
 * counter's last recorded `qty_after` against the final `counted_qty`.
 * If they differ, the counter was wrong on that line.
 */
export function accuracyFor(
  userId: string,
  items: PerfItem[],
  events: PerfEvent[],
): { verified: number; correct: number } {
  // index latest event per (user, item)
  const latest = new Map<string, PerfEvent>();
  for (const e of events) {
    if (e.user_id !== userId || !e.item_id) continue;
    const key = e.item_id;
    const prev = latest.get(key);
    if (!prev || +new Date(e.created_at) > +new Date(prev.created_at)) {
      latest.set(key, e);
    }
  }
  let verified = 0;
  let correct = 0;
  for (const it of items) {
    if (!it.verified_at) continue;
    const ev = latest.get(it.id);
    if (!ev) continue; // user didn't touch this item
    verified += 1;
    const counterQty = Number(ev.qty_after ?? 0);
    const finalQty = Number(it.counted_qty ?? 0);
    if (counterQty === finalQty) correct += 1;
  }
  return { verified, correct };
}

/** Compute per-user metrics for a cycle. */
export function computeUserMetrics(
  cycle: PerfCycle,
  events: PerfEvent[],
  items: PerfItem[],
  profiles: PerfProfile[],
  opts: { gapThresholdMs?: number } = {},
): UserMetrics[] {
  const gap = opts.gapThresholdMs ?? 5 * 60_000;
  const byUser = new Map<string, PerfEvent[]>();
  for (const e of events) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
    byUser.get(e.user_id)!.push(e);
  }
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const result: UserMetrics[] = [];
  for (const [userId, userEvents] of byUser) {
    const pieces = userEvents.reduce((s, e) => s + piecesFor(e), 0);
    const loi = loiFromEvents(userEvents);
    const itemsCounted = new Set(
      userEvents.filter((e) => e.item_id).map((e) => e.item_id!),
    ).size;
    const dt = downtimeMs(userEvents, gap);
    const activeMs = Math.max(0, loi - dt);
    const hours = activeMs / MS_PER_HOUR;
    const pph = hours > 0 ? pieces / hours : 0;
    const acc = accuracyFor(userId, items, userEvents);
    const accuracy = acc.verified > 0 ? acc.correct / acc.verified : NaN;
    const aph = isNaN(accuracy) ? pph : pph * accuracy;
    result.push({
      userId,
      userName: profileMap.get(userId)?.full_name ?? userId.slice(0, 8),
      itemsCounted,
      pieces,
      loiMs: loi,
      pph,
      accuracy,
      aph,
      downtimeMs: dt,
      verifiedItems: acc.verified,
      correctItems: acc.correct,
    });
  }
  return result.sort((a, b) => b.pieces - a.pieces);
}

/**
 * Combine per-cycle UserMetrics rows into a single per-user row by summing
 * pieces / time / accuracy components and recomputing derived ratios.
 * Used by the "All cycles" view.
 */
export function aggregateUserMetrics(rows: UserMetrics[]): UserMetrics[] {
  const m = new Map<string, UserMetrics>();
  for (const r of rows) {
    const cur = m.get(r.userId);
    if (!cur) {
      m.set(r.userId, { ...r });
      continue;
    }
    cur.itemsCounted += r.itemsCounted;
    cur.pieces += r.pieces;
    cur.loiMs += r.loiMs;
    cur.downtimeMs += r.downtimeMs;
    cur.verifiedItems += r.verifiedItems;
    cur.correctItems += r.correctItems;
  }
  for (const v of m.values()) {
    const activeMs = Math.max(0, v.loiMs - v.downtimeMs);
    const hours = activeMs / MS_PER_HOUR;
    v.pph = hours > 0 ? v.pieces / hours : 0;
    v.accuracy = v.verifiedItems > 0 ? v.correctItems / v.verifiedItems : NaN;
    v.aph = isNaN(v.accuracy) ? v.pph : v.pph * v.accuracy;
  }
  return Array.from(m.values()).sort((a, b) => b.pieces - a.pieces);
}

/** Cycle-wide LOI from cycle start/end (falls back to events). */
export function cycleLoiMs(cycle: PerfCycle, events: PerfEvent[]): number {
  if (cycle.count_started_at && cycle.count_ended_at) {
    return (
      +new Date(cycle.count_ended_at) - +new Date(cycle.count_started_at)
    );
  }
  if (cycle.count_started_at && events.length) {
    const start = +new Date(cycle.count_started_at);
    let max = start;
    for (const e of events) {
      const t = +new Date(e.created_at);
      if (t > max) max = t;
    }
    return max - start;
  }
  return loiFromEvents(events);
}

/** Hourly buckets for a chart. Anchor = first event time. */
export function hourlyBuckets(
  events: PerfEvent[],
  gapThresholdMs: number = 5 * 60_000,
): HourlyBucket[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  );
  const start = +new Date(sorted[0].created_at);
  const end = +new Date(sorted[sorted.length - 1].created_at);
  const totalHours = Math.max(1, Math.ceil((end - start) / MS_PER_HOUR));
  const buckets: HourlyBucket[] = [];
  for (let h = 0; h < totalHours; h++) {
    buckets.push({
      hour: h + 1,
      label: `Hour ${h + 1}`,
      pieces: 0,
      pph: 0,
      cumulativePph: 0,
      downtimeMin: 0,
    });
  }
  for (const e of sorted) {
    const h = Math.min(
      totalHours - 1,
      Math.floor((+new Date(e.created_at) - start) / MS_PER_HOUR),
    );
    buckets[h].pieces += piecesFor(e);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = +new Date(sorted[i - 1].created_at);
    const curr = +new Date(sorted[i].created_at);
    const gap = curr - prev;
    if (gap > gapThresholdMs) {
      const h = Math.min(totalHours - 1, Math.floor((prev - start) / MS_PER_HOUR));
      buckets[h].downtimeMin += gap / 60_000;
    }
  }
  let cum = 0;
  for (let i = 0; i < buckets.length; i++) {
    buckets[i].pph = buckets[i].pieces;
    cum += buckets[i].pieces;
    buckets[i].cumulativePph = cum / (i + 1);
  }
  return buckets;
}

export interface VerifierMetrics {
  userId: string;
  userName: string;
  itemsVerified: number;
  adjustments: number;
  catchRate: number; // adjustments / itemsVerified
  windowMs: number;
  activeMs: number;
  itemsPerHour: number;
  downtimeMs: number;
}

/**
 * Per-verifier metrics. For each user who appears as `verified_by` on any
 * count_items row in the cycle, compute throughput and how often the verifier
 * had to adjust the counter's qty. Uses count_events with action='verify*' OR
 * derives a per-item verification "event" from verified_at when no event row
 * exists (older data path).
 */
export function computeVerifierMetrics(
  events: PerfEvent[],
  items: PerfItem[],
  profiles: PerfProfile[],
  opts: { gapThresholdMs?: number } = {},
): VerifierMetrics[] {
  const gap = opts.gapThresholdMs ?? 5 * 60_000;
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Latest counter event per item (to compare against final counted_qty)
  const latestCounterEvent = new Map<string, PerfEvent>();
  for (const e of events) {
    if (!e.item_id) continue;
    if (e.action && e.action.startsWith("verify")) continue;
    const prev = latestCounterEvent.get(e.item_id);
    if (!prev || +new Date(e.created_at) > +new Date(prev.created_at)) {
      latestCounterEvent.set(e.item_id, e);
    }
  }

  // Group verified items by verifier
  const byVerifier = new Map<string, PerfItem[]>();
  for (const it of items) {
    if (!it.verified_at || !it.verified_by) continue;
    if (!byVerifier.has(it.verified_by)) byVerifier.set(it.verified_by, []);
    byVerifier.get(it.verified_by)!.push(it);
  }

  const result: VerifierMetrics[] = [];
  for (const [verifierId, verifiedItems] of byVerifier) {
    let adjustments = 0;
    for (const it of verifiedItems) {
      const ev = latestCounterEvent.get(it.id);
      const counterQty = ev ? Number(ev.qty_after ?? 0) : null;
      const finalQty = Number(it.counted_qty ?? 0);
      if (counterQty != null && counterQty !== finalQty) adjustments += 1;
    }

    // Time window: min/max verified_at
    const times = verifiedItems
      .map((i) => (i.verified_at ? +new Date(i.verified_at) : 0))
      .filter((t) => t > 0)
      .sort((a, b) => a - b);
    const windowMs = times.length > 1 ? times[times.length - 1] - times[0] : 0;

    // Downtime within the verification window
    let downtimeMs = 0;
    for (let i = 1; i < times.length; i++) {
      const g = times[i] - times[i - 1];
      if (g > gap) downtimeMs += g;
    }
    const activeMs = Math.max(0, windowMs - downtimeMs);
    const hours = activeMs / 3_600_000;
    const itemsPerHour = hours > 0 ? verifiedItems.length / hours : 0;

    result.push({
      userId: verifierId,
      userName: profileMap.get(verifierId)?.full_name ?? verifierId.slice(0, 8),
      itemsVerified: verifiedItems.length,
      adjustments,
      catchRate: verifiedItems.length > 0 ? adjustments / verifiedItems.length : 0,
      windowMs,
      activeMs,
      itemsPerHour,
      downtimeMs,
    });
  }

  return result.sort((a, b) => b.itemsVerified - a.itemsVerified);
}


export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatPct(v: number): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function formatNum(v: number): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
