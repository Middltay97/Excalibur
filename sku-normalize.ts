import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch ALL unit costs from sku_master, paginating past Supabase's default
 * 1000-row limit. Returns a Map<sku, unit_cost>.
 *
 * Prefer fetchSkuCostsFor(skus) when you only need costs for a known set of
 * SKUs — a single targeted query is dramatically faster than scanning the
 * entire master (~32k rows).
 */
export async function fetchAllSkuCosts(): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  for (let i = 0; i < 1000; i++) {
    const { data, error } = await supabase
      .from("sku_master")
      .select("sku,unit_cost")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const s of rows) {
      if (s.sku && s.unit_cost != null) costs.set(s.sku, Number(s.unit_cost));
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return costs;
}

/**
 * Fetch unit costs only for the given SKUs. Chunked .in() queries run in
 * parallel — typically one round-trip for a single cycle's worth of SKUs.
 */
export async function fetchSkuCostsFor(
  skus: (string | null | undefined)[],
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(skus.filter((s): s is string => !!s)));
  const out = new Map<string, number>();
  if (unique.length === 0) return out;
  const chunkSize = 500;
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  const results = await Promise.all(
    chunks.map((c) =>
      supabase.from("sku_master").select("sku,unit_cost").in("sku", c),
    ),
  );
  for (const { data, error } of results) {
    if (error) throw error;
    for (const s of data ?? []) {
      if (s.sku && s.unit_cost != null) out.set(s.sku, Number(s.unit_cost));
    }
  }
  return out;
}
