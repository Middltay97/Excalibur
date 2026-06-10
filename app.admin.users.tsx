import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/app/admin/diagnostics")({
  component: DiagnosticsPage,
});

interface Diag {
  id: string;
  created_at: string;
  cycle_id: string | null;
  badge_id: string | null;
  raw: string;
  normalized: string | null;
  length: number | null;
  char_codes: number[] | null;
  lookup_key: string | null;
  candidate_keys: string[] | null;
  result_status: string;
  closest_master_sku: string | null;
  notes: any;
}

const STATUSES = ["all", "sku_not_found", "mislocated", "missing_baseline", "invalid_scan", "matched"];

function DiagnosticsPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Diag[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Diag | null>(null);
  const [aliasBusy, setAliasBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scan_diagnostics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data ?? []) as Diag[]);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const visible = useMemo(() => {
    let list = rows;
    if (statusFilter !== "all") list = list.filter((r) => r.result_status === statusFilter);
    if (search.trim()) {
      const f = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.raw?.toLowerCase().includes(f) ||
          r.normalized?.toLowerCase().includes(f) ||
          r.badge_id?.toLowerCase().includes(f) ||
          r.closest_master_sku?.toLowerCase().includes(f),
      );
    }
    return list;
  }, [rows, statusFilter, search]);

  const addAlias = async (d: Diag) => {
    if (!d.closest_master_sku || !d.normalized) {
      return toast.error("Need a closest match and a normalized scan");
    }
    setAliasBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("barcode_aliases").insert({
      sku: d.closest_master_sku,
      barcode: d.normalized,
      created_by: u.user?.id,
    });
    setAliasBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Alias added: ${d.normalized} → ${d.closest_master_sku}`);
  };

  if (!isAdmin) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Scanner Diagnostics</h2>
          <p className="text-sm text-muted-foreground">
            Last 500 failed/odd scans. Use to debug unexpected-flag false positives.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
        >
          Refresh
        </button>
      </div>

      <div className="card-elevated p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by raw, normalized, badge, closest match…"
            className="min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No diagnostics yet.</div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Raw</th>
                  <th className="px-3 py-2">Normalized</th>
                  <th className="px-3 py-2">Closest</th>
                  <th className="px-3 py-2">Badge</th>
                  <th className="px-3 py-2">Cycle</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelected(d)}
                    className="cursor-pointer border-t border-border hover:bg-accent"
                  >
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={d.result_status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{JSON.stringify(d.raw)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.normalized ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.closest_master_sku ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{d.badge_id ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.cycle_id ? (
                        <Link
                          to="/app/cycles/$id"
                          params={{ id: d.cycle_id }}
                          className="text-primary hover:underline"
                        >
                          open
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 sm:items-center sm:justify-center"
          onClick={() => setSelected(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-t-lg bg-card p-5 shadow-xl sm:rounded-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Scan detail</h3>
                <p className="text-xs text-muted-foreground">
                  {new Date(selected.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded-md p-1 hover:bg-accent"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-3 text-sm">
              <Field label="Status" value={<StatusChip status={selected.result_status} />} />
              <Field label="Raw" value={<code className="break-all">{JSON.stringify(selected.raw)}</code>} />
              <Field label="Normalized" value={<code>{selected.normalized ?? "—"}</code>} />
              <Field label="Lookup key" value={<code>{selected.lookup_key ?? "—"}</code>} />
              <Field
                label="Candidates"
                value={
                  <div className="font-mono text-xs">
                    {selected.candidate_keys?.join(", ") || "—"}
                  </div>
                }
              />
              <Field
                label="Char codes"
                value={
                  <div className="flex flex-wrap gap-1 font-mono text-xs">
                    {(selected.char_codes ?? []).map((c, i) => (
                      <span
                        key={i}
                        className="rounded bg-muted px-1.5 py-0.5"
                        title={`char ${i}`}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                }
              />
              <Field
                label="Closest master SKU"
                value={
                  selected.closest_master_sku ? (
                    <div className="flex items-center gap-2">
                      <code>{selected.closest_master_sku}</code>
                      <button
                        disabled={aliasBusy}
                        onClick={() => addAlias(selected)}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        Add alias
                      </button>
                    </div>
                  ) : (
                    "—"
                  )
                }
              />
              {selected.notes && (
                <Field
                  label="Notes"
                  value={
                    <pre className="overflow-auto rounded bg-muted/40 p-2 text-xs">
                      {JSON.stringify(selected.notes, null, 2)}
                    </pre>
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone: Record<string, string> = {
    matched: "bg-success/15 text-success",
    mislocated: "bg-warning/15 text-warning-foreground",
    missing_baseline: "bg-primary/15 text-primary",
    sku_not_found: "bg-destructive/15 text-destructive",
    invalid_scan: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${tone[status] ?? "bg-muted"}`}>
      {status}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
