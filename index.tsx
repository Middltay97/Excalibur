import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/verify")({
  component: VerifyRoute,
});

function VerifyRoute() {
  const { pathname } = useLocation();
  if (pathname !== "/app/verify") return <Outlet />;
  return <VerifyList />;
}

interface Cycle {
  id: string;
  name: string;
  status: string;
  created_at: string;
  baseline_filename: string | null;
  due_date: string | null;
}

interface ItemRow {
  cycle_id: string;
  is_unexpected: boolean;
  expected_qty: number;
  counted_qty: number | null;
  verified_at: string | null;
}

function VerifyList() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [counts, setCounts] = useState<Record<string, { needsReview: number; verified: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase
        .from("cycle_counts")
        .select("id,name,status,created_at,baseline_filename,due_date")
        .in("status", ["verified", "verifying", "in_progress"])
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      const list = (cs ?? []) as Cycle[];
      setCycles(list);

      if (list.length) {
        const ids = list.map((c) => c.id);
        const { data: items } = await supabase
          .from("count_items")
          .select("cycle_id,is_unexpected,expected_qty,counted_qty,verified_at")
          .in("cycle_id", ids)
          .limit(20000);
        const agg: Record<string, { needsReview: number; verified: number }> = {};
        for (const id of ids) agg[id] = { needsReview: 0, verified: 0 };
        for (const i of (items ?? []) as ItemRow[]) {
          const expected = Number(i.expected_qty ?? 0);
          const counted = i.counted_qty == null ? null : Number(i.counted_qty);
          if (i.verified_at) {
            agg[i.cycle_id].verified++;
          } else if (i.is_unexpected) {
            agg[i.cycle_id].needsReview++;
          } else if (counted != null && counted !== expected) {
            agg[i.cycle_id].needsReview++;
          }
        }
        setCounts(agg);
      }
      setLoading(false);
    })();
  }, []);

  const verified = useMemo(() => cycles.filter((c) => c.status === "verified"), [cycles]);
  const verifying = useMemo(() => cycles.filter((c) => c.status === "verifying"), [cycles]);
  const inProgress = useMemo(() => cycles.filter((c) => c.status === "in_progress"), [cycles]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Verify Counts</h2>
        <p className="text-sm text-muted-foreground">
          Review variances and unexpected SKUs for cycles ready for verification.
        </p>
      </div>

      <Section title="Verified — ready to finalize" cycles={verified} counts={counts} loading={loading} empty="No verified cycles waiting to finalize." />
      <Section title="Ready for verification" cycles={verifying} counts={counts} loading={loading} empty="No cycles are ready for verification yet." />
      <Section title="In progress (preview)" cycles={inProgress} counts={counts} loading={loading} empty="No active cycles." muted />
    </div>
  );
}

function Section({
  title,
  cycles,
  counts,
  loading,
  empty,
  muted,
}: {
  title: string;
  cycles: Cycle[];
  counts: Record<string, { needsReview: number; verified: number }>;
  loading: boolean;
  empty: string;
  muted?: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className={`text-sm font-medium uppercase tracking-wide ${muted ? "text-muted-foreground" : ""}`}>{title}</h3>
      <div className="card-elevated p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : cycles.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Needs review</th>
                <th className="px-4 py-3 text-right">Verified</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => {
                const n = counts[c.id] ?? { needsReview: 0, verified: 0 };
                return (
                  <tr key={c.id} className="border-t border-border hover:bg-accent/40">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs text-warning-foreground">
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-destructive">{n.needsReview}</td>
                    <td className="px-4 py-3 text-right text-success">{n.verified}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.due_date ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/app/verify/$id"
                        params={{ id: c.id }}
                        className="text-primary hover:underline"
                      >
                        Verify →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
