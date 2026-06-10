import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { roles, isAdmin } = useAuth();

  const { data: cycles } = useQuery({
    queryKey: ["cycles-summary"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cycle_counts")
        .select("id, name, status, due_date, created_at, baseline_source")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const cycleIds = cycles?.map((c) => c.id) ?? [];
  const { data: progress } = useQuery({
    queryKey: ["cycles-progress", cycleIds],
    enabled: cycleIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("count_items")
        .select("cycle_id, expected_qty, counted_qty, is_unexpected, verified_at")
        .in("cycle_id", cycleIds);
      const map: Record<string, { total: number; counted: number; verified: number; needsReview: number }> = {};
      for (const id of cycleIds) map[id] = { total: 0, counted: 0, verified: 0, needsReview: 0 };
      for (const it of data ?? []) {
        const m = map[it.cycle_id as string];
        if (!m) continue;
        const expected = Number(it.expected_qty ?? 0);
        const counted = it.counted_qty != null ? Number(it.counted_qty) : null;
        const visible = it.is_unexpected || expected > 0 || (counted != null && counted > 0);
        if (!visible) continue;
        m.total += 1;
        if (counted != null) m.counted += 1;
        if (it.verified_at) {
          m.verified += 1;
        } else if (it.is_unexpected || counted == null || counted !== expected) {
          m.needsReview += 1;
        }
      }
      return map;
    },
  });

  const open = cycles?.filter((c) => c.status === "in_progress" || c.status === "draft").length ?? 0;
  const verifying = cycles?.filter((c) => c.status === "verifying").length ?? 0;
  const finalized = cycles?.filter((c) => c.status === "finalized").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Signed in as {roles.length ? roles.join(", ") : "no role yet — ask an admin to assign one"}
          </p>
        </div>
        {isAdmin && (
          <Link to="/app/cycles" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            New cycle count
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card-stats">
          <span className="metric-label">Open</span>
          <span className="metric-value">{open}</span>
        </div>
        <div className="card-stats">
          <span className="metric-label">Awaiting verification</span>
          <span className="metric-value">{verifying}</span>
        </div>
        <div className="card-stats">
          <span className="metric-label">Finalized (recent)</span>
          <span className="metric-value">{finalized}</span>
        </div>
      </div>

      <div className="card-elevated p-0">
        <div className="border-b border-border px-6 py-4">
          <h3 className="font-semibold">Recent cycle counts</h3>
        </div>
        {cycles && cycles.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Count progress</th><th>Verification progress</th><th>Due</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => {
                const p = progress?.[c.id] ?? { total: 0, counted: 0, verified: 0, needsReview: 0 };
                const countPct = p.total > 0 ? Math.round((p.counted / p.total) * 100) : 0;
                const verifyDenom = p.verified + p.needsReview;
                const verifyPct = verifyDenom > 0 ? Math.round((p.verified / verifyDenom) * 100) : 100;
                return (
                  <tr key={c.id}>
                    <td className="font-medium">{c.name}</td>
                    <td><span className="status-badge-active">{c.status}</span></td>
                    <td className="min-w-[160px]">
                      <ProgressBar pct={countPct} label={`${p.counted}/${p.total}`} />
                    </td>
                    <td className="min-w-[160px]">
                      <ProgressBar pct={verifyPct} label={`${p.verified}/${verifyDenom}`} />
                    </td>
                    <td>{c.due_date ?? "—"}</td>
                    <td className="text-right">
                      <Link to="/app/cycles/$id/activity" params={{ id: c.id }} className="text-primary hover:underline">Open</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No cycle counts yet. {isAdmin && <Link to="/app/cycles" className="text-primary hover:underline">Create one</Link>}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="w-20 text-right text-xs tabular-nums text-muted-foreground">{label} ({pct}%)</span>
    </div>
  );
}
