import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/app/cycles/$id/")({
  component: CycleDetail,
});

interface Cycle {
  id: string;
  name: string;
  status: string;
  baseline_filename: string | null;
  baseline_source: string | null;
  created_at: string;
  due_date: string | null;
  count_started_at: string | null;
  count_ended_at: string | null;
  verify_started_at: string | null;
  verify_ended_at: string | null;
  finalized_at: string | null;
}

interface Item {
  id: string;
  sku: string | null;
  barcode: string | null;
  location: string | null;
  description: string | null;
  uom: string | null;
  expected_qty: number;
  counted_qty: number | null;
  status: string;
}

function CycleDetail() {
  const { id } = useParams({ from: "/app/cycles/$id/" });
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showZero, setShowZero] = useState(false);

  const handleDelete = async () => {
    if (!cycle) return;
    if (!confirm(`Delete cycle "${cycle.name}"? This removes all counts, events, and assignments. This cannot be undone.`)) {
      return;
    }
    const { error } = await supabase.rpc("delete_cycle", { _cycle_id: id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Deleted "${cycle.name}".`);
    navigate({ to: "/app/cycles" });
  };

  const load = async () => {
    const [{ data: c }, { data: it }] = await Promise.all([
      supabase.from("cycle_counts").select("*").eq("id", id).single(),
      supabase
        .from("count_items")
        .select("id,sku,barcode,location,description,uom,expected_qty,counted_qty,status")
        .eq("cycle_id", id)
        .order("location", { ascending: true })
        .limit(1000),
    ]);
    setCycle(c as Cycle | null);
    setItems(((it ?? []) as Item[]));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div className="text-muted-foreground">Loading…</div>;
  if (!cycle) return <div className="text-destructive">Cycle not found.</div>;

  // Visible items: by default hide zero-qty bins unless they've been counted.
  const visible = items.filter(
    (i) =>
      showZero ||
      Number(i.expected_qty) > 0 ||
      (i.counted_qty != null && Number(i.counted_qty) > 0),
  );
  const counted = visible.filter((i) => i.status !== "uncounted").length;
  const pct = visible.length ? Math.round((counted / visible.length) * 100) : 0;
  const filtered = visible.filter((i) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      i.sku?.toLowerCase().includes(f) ||
      i.barcode?.toLowerCase().includes(f) ||
      i.location?.toLowerCase().includes(f) ||
      i.description?.toLowerCase().includes(f)
    );
  });

  const startCount = async () => {
    if (cycle.status !== "draft") return;
    const { error } = await supabase
      .from("cycle_counts")
      .update({ status: "in_progress", count_started_at: cycle.count_started_at ?? new Date().toISOString() })
      .eq("id", cycle.id);
    if (error) return toast.error(error.message);
    toast.success("Cycle started");
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/cycles" className="text-xs text-muted-foreground hover:underline">
            ← All cycles
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">{cycle.name}</h2>
          <p className="text-sm text-muted-foreground">
            {cycle.baseline_filename ?? "—"} · {visible.length} of {items.length} items
            {showZero ? "" : " (zero-qty hidden)"} · status{" "}
            <span className="font-medium text-foreground">{cycle.status}</span>
          </p>
          <Timestamps cycle={cycle} />
        </div>
        <div className="flex gap-2">
          {isAdmin && cycle.status === "draft" && (
            <button
              onClick={startCount}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Start counting
            </button>
          )}
          <Link
            to="/m/count/$id"
            params={{ id: cycle.id }}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Open count UI →
          </Link>
          <Link
            to="/print/count-sheet/$id"
            params={{ id: cycle.id }}
            target="_blank"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Print count sheet
          </Link>
          <Link
            to="/print/count-sheet/$id"
            params={{ id: cycle.id }}
            search={{ all: 1 }}
            target="_blank"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Print full bin sheet
          </Link>
          <Link
            to="/print/variance-sheet/$id"
            params={{ id: cycle.id }}
            target="_blank"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Print variance — full
          </Link>
          <Link
            to="/print/variance-sheet/$id"
            params={{ id: cycle.id }}
            search={{ status: "short,over,unexpected,mislocated,uncounted" }}
            target="_blank"
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Print variance — issues only
          </Link>

          <Link
            to="/app/verify/$id"
            params={{ id: cycle.id }}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
          >
            Verify counts →
          </Link>
          {isAdmin && (
            <button
              onClick={handleDelete}
              className="rounded-md border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              Delete
            </button>
          )}
          {cycle.status === "finalized" ? (
            <Link
              to="/app/cycles/$id/finalize"
              params={{ id: cycle.id }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download CSV
            </Link>
          ) : (
            (isAdmin || cycle.status === "verifying" || cycle.status === "verified") && (
              <Link
                to="/app/cycles/$id/finalize"
                params={{ id: cycle.id }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Finalize
              </Link>
            )
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Items" value={visible.length} />
        <Stat label="Counted" value={`${counted} (${pct}%)`} />
        <Stat label="Remaining" value={visible.length - counted} />
      </div>

      <div className="card-elevated p-0 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border p-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by SKU, barcode, location, description…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showZero}
              onChange={(e) => setShowZero(e.target.checked)}
              className="h-4 w-4"
            />
            Show zero-qty bins
          </label>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{i.sku}</td>
                  <td className="px-3 py-2 text-muted-foreground">{i.barcode ?? "—"}</td>
                  <td className="px-3 py-2">{i.location ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-xs">
                    {i.description ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{i.expected_qty}</td>
                  <td className="px-3 py-2 text-right">{i.counted_qty ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        i.status === "uncounted"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200"
                          : i.status === "counted"
                          ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200"
                          : "bg-muted"
                      }`}
                    >
                      {i.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No matching items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Counting progress</span>
          <span className="tabular-nums">{counted} / {visible.length} items ({pct}%)</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-elevated">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function Timestamps({ cycle }: { cycle: Cycle }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
      <div>Count started: <span className="text-foreground">{fmt(cycle.count_started_at)}</span></div>
      <div>Count ended: <span className="text-foreground">{fmt(cycle.count_ended_at)}</span></div>
      <div>Verify started: <span className="text-foreground">{fmt(cycle.verify_started_at)}</span></div>
      <div>Verify ended: <span className="text-foreground">{fmt(cycle.verify_ended_at ?? cycle.finalized_at)}</span></div>
    </div>
  );
}
