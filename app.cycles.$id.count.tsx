import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/cycles/$id/activity")({
  component: CycleActivity,
});

interface EventRow {
  id: string;
  created_at: string;
  user_id: string;
  item_id: string | null;
  action: string;
  qty_before: number | null;
  qty_after: number | null;
  source: string | null;
}

function CycleActivity() {
  const { id } = useParams({ from: "/app/cycles/$id/activity" });

  const { data: cycle } = useQuery({
    queryKey: ["cycle-activity-meta", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("cycle_counts")
        .select("id,name,status")
        .eq("id", id)
        .single();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["cycle-activity-items", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("count_items")
        .select("id,sku,barcode,expected_qty,counted_qty,is_unexpected,verified_at,verified_by")
        .eq("cycle_id", id)
        .limit(5000);
      return data ?? [];
    },
  });

  const { data: events } = useQuery({
    queryKey: ["cycle-activity-events", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("count_events")
        .select("id,created_at,user_id,item_id,action,qty_before,qty_after,source")
        .eq("cycle_id", id)
        .order("created_at", { ascending: false })
        .limit(1000);
      return (data ?? []) as EventRow[];
    },
  });

  const userIds = Array.from(new Set((events ?? []).map((e) => e.user_id)));
  const { data: profiles } = useQuery({
    queryKey: ["cycle-activity-profiles", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.rpc("get_profile_names", { _ids: userIds });
      const map: Record<string, string> = {};
      for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
        map[p.id] = p.full_name ?? p.id.slice(0, 8);
      }
      return map;
    },
  });

  const itemMap: Record<string, { sku: string | null; barcode: string | null; verified_at: string | null }> = {};
  for (const it of items ?? []) itemMap[it.id] = { sku: it.sku, barcode: it.barcode, verified_at: it.verified_at };

  const visible = (items ?? []).filter(
    (i) =>
      i.is_unexpected ||
      Number(i.expected_qty ?? 0) > 0 ||
      (i.counted_qty != null && Number(i.counted_qty) > 0),
  );
  const total = visible.length;
  const countedItems = visible.filter((i) => i.counted_qty != null);
  const counted = countedItems.length;
  const verified = visible.filter((i) => !!i.verified_at).length;
  const needsReview = visible.filter((i) => {
    if (i.verified_at) return false;
    if (i.is_unexpected) return true;
    if (i.counted_qty == null) return Number(i.expected_qty ?? 0) > 0;
    return Number(i.counted_qty) !== Number(i.expected_qty ?? 0);
  }).length;
  const verifyDenom = verified + needsReview;
  const countPct = total ? Math.round((counted / total) * 100) : 0;
  const verifyPct = verifyDenom ? Math.round((verified / verifyDenom) * 100) : 100;

  return (
    <div className="space-y-5 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/dashboard" className="text-xs text-muted-foreground hover:underline">
            ← Dashboard
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">{cycle?.name ?? "Cycle activity"}</h2>
          <p className="text-sm text-muted-foreground">Status: {cycle?.status ?? "—"}</p>
        </div>
      </div>

      <div className="card-elevated space-y-3 p-4">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Counting progress
            </span>
            <span className="tabular-nums text-muted-foreground">
              {counted} / {total} ({countPct}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${countPct}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              Verification progress
            </span>
            <span className="tabular-nums text-muted-foreground">
              {verified} / {verifyDenom} ({verifyPct}%)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-success transition-all" style={{ width: `${verifyPct}%` }} />
          </div>
        </div>
      </div>

      <div className="card-elevated p-0 overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-semibold">Count entries</h3>
          <p className="text-xs text-muted-foreground">
            {events?.length ?? 0} entries (most recent first)
          </p>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">User ID</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Qty change</th>
                <th className="px-3 py-2">Verified</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((e) => {
                const item = e.item_id ? itemMap[e.item_id] : undefined;
                const delta =
                  e.qty_after != null && e.qty_before != null
                    ? Number(e.qty_after) - Number(e.qty_before)
                    : null;
                const isVerified = !!item?.verified_at;
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums text-muted-foreground whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{profiles?.[e.user_id] ?? "—"}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {e.user_id}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item?.sku ?? "—"}</div>
                      {item?.barcode && (
                        <div className="text-xs text-muted-foreground">{item.barcode}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {e.qty_before ?? "—"} → {e.qty_after ?? "—"}
                      {delta != null && delta !== 0 && (
                        <span
                          className={`ml-2 text-xs ${
                            delta > 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          ({delta > 0 ? `+${delta}` : delta})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isVerified ? (
                        <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                          Verified
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          Unverified
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(events?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                    No count entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

