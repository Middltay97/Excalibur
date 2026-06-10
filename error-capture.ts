import { supabase } from "@/integrations/supabase/client";

export interface AllocationRule {
  user_id: string;
  percentage: number;
}

/**
 * Distribute a list of newly created cycle IDs to users according to
 * the percentages configured in `count_allocation_rules`. Each cycle is
 * assigned to exactly one user; the per-user counts are computed by
 * largest-remainder (so the totals add up exactly), and the cycles are
 * shuffled randomly before being handed out so the selection is
 * randomized rather than ordered.
 *
 * Returns the number of cycle_assignments rows inserted (0 when no
 * rules exist or no cycles were given).
 */
export async function distributeCyclesByAllocation(cycleIds: string[]): Promise<number> {
  if (cycleIds.length === 0) return 0;
  const { data: rules, error } = await supabase
    .from("count_allocation_rules")
    .select("user_id, percentage");
  if (error) throw new Error(error.message);
  const active = (rules ?? []).filter((r) => Number(r.percentage) > 0) as AllocationRule[];
  if (active.length === 0) return 0;

  const totalPct = active.reduce((s, r) => s + Number(r.percentage), 0);
  if (totalPct <= 0) return 0;

  const n = cycleIds.length;
  // Treat percentages as portion of total cycles (e.g. 50% of A + 50% of B
  // assigns all cycles; 50% of A alone assigns half and leaves the rest
  // unassigned). If the total exceeds 100, normalize down so we never try
  // to assign more cycles than exist.
  const scale = totalPct > 100 ? 100 / totalPct : 1;
  const raw = active.map((r) => ({
    user_id: r.user_id,
    exact: (Number(r.percentage) * scale / 100) * n,
  }));
  const floors = raw.map((r) => ({ user_id: r.user_id, count: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  const targetTotal = Math.min(n, Math.round(raw.reduce((s, r) => s + r.exact, 0)));
  let assigned = floors.reduce((s, r) => s + r.count, 0);
  // Distribute remaining seats (up to targetTotal) to the largest remainders.
  const leftover = Math.max(0, targetTotal - assigned);
  if (leftover > 0) {
    const order = [...floors].sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < leftover; i++) order[i % order.length].count += 1;
  }


  // Shuffle cycles, then slice per user.
  const shuffled = [...cycleIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const rows: { cycle_id: string; user_id: string }[] = [];
  let cursor = 0;
  for (const f of floors) {
    for (let k = 0; k < f.count && cursor < shuffled.length; k++, cursor++) {
      rows.push({ cycle_id: shuffled[cursor], user_id: f.user_id });
    }
  }
  if (rows.length === 0) return 0;

  const { error: insErr } = await supabase.from("cycle_assignments").insert(rows);
  if (insErr) throw new Error(insErr.message);
  return rows.length;
}
