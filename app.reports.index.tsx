import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classify, downloadCsv, type VarianceStatus } from "@/lib/variance";
import { fetchSkuCostsFor } from "@/lib/sku-costs";

export const Route = createFileRoute("/app/reports/$id/summary")({
  component: CountSummaryReport,
});

interface Row {
  id: string;
  sku: string | null;
  barcode: string | null;
  location: string | null;
  description: string | null;
  uom: string | null;
  expected_qty: number;
  counted_qty: number | null;
  is_unexpected: boolean;
  variance: number;
  status: VarianceStatus;
  unit_cost: number | null;
  counted_value: number;
  expected_value: number;
  variance_value: number;
}

const STATUS_LABEL: Record<VarianceStatus, string> = {
  match: "Match",
  short: "Short",
  over: "Over",
  unexpected: "Unexpected",
  uncounted: "Uncounted",
  mislocated: "Mislocated",
};

const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });
const fmtQty = (n: number | null) =>
  n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });

function CountSummaryReport() {
  const { id: cycleId } = useParams({ from: "/app/reports/$id/summary" });
  const [cycleName, setCycleName] = useState("");
  const [cycleStatus, setCycleStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | VarianceStatus>("all");

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: items }] = await Promise.all([
        supabase.from("cycle_counts").select("name,status").eq("id", cycleId).single(),
        supabase
          .from("count_items")
          .select("id,sku,barcode,location,description,uom,expected_qty,counted_qty,is_unexpected,status")
          .eq("cycle_id", cycleId)
          .limit(5000),
      ]);
      const costMap = await fetchSkuCostsFor((items ?? []).map((i: any) => i.sku));
      setCycleName(c?.name ?? "");
      setCycleStatus(c?.status ?? "");
      const out: Row[] = (items ?? []).map((i: any) => {
        const variance = (i.counted_qty ?? 0) - (i.expected_qty ?? 0);
        const status = classify(i);
        const unit_cost = i.sku ? costMap.get(i.sku) ?? null : null;
        const c = unit_cost ?? 0;
        return {
          ...i,
          variance,
          status,
          unit_cost,
          counted_value: (i.counted_qty ?? 0) * c,
          expected_value: (i.expected_qty ?? 0) * c,
          variance_value: variance * c,
        };
      });
      setRows(out);
      setLoading(false);
    })();
  }, [cycleId]);

  const summary = useMemo(() => {
    const s = {
      totalItems: rows.length,
      match: 0,
      short: 0,
      over: 0,
      unexpected: 0,
      uncounted: 0,
      mislocated: 0,
      countedValue: 0,
      expectedValue: 0,
      varianceValue: 0,
      missingCost: 0,
    };
    for (const r of rows) {
      s[r.status]++;
      s.countedValue += r.counted_value;
      s.expectedValue += r.expected_value;
      s.varianceValue += r.variance_value;
      if (r.unit_cost == null) s.missingCost++;
    }
    return s;
  }, [rows]);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const downloadReport = () => {
    const head = [
      "SKU",
      "Barcode",
      "Location",
      "Description",
      "UoM",
      "Expected",
      "Counted",
      "Variance",
      "Status",
      "Unit Cost",
      "Counted Value",
      "Expected Value",
      "Variance Value",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.sku,
          r.barcode,
          r.location,
          r.description,
          r.uom,
          r.expected_qty,
          r.counted_qty,
          r.variance,
          r.status,
          r.unit_cost ?? "",
          r.counted_value.toFixed(2),
          r.expected_value.toFixed(2),
          r.variance_value.toFixed(2),
        ]
          .map(escape)
          .join(","),
      );
    }
    downloadCsv(
      `${cycleName.replace(/\s+/g, "_") || "cycle"}_count_summary.csv`,
      lines.join("\n"),
    );
  };

  if (loading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/app/reports" className="text-xs text-muted-foreground hover:underline">
            ← Back to reports
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Count Summary — {cycleName}</h2>
          <p className="text-sm text-muted-foreground">
            Status: <span className="font-medium text-foreground">{cycleStatus}</span> ·{" "}
            {summary.totalItems} items
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/print/count-summary/${cycleId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Print summary
          </a>
          <a
            href={`/print/variance-sheet/${cycleId}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Print full sheet
          </a>
          <a
            href={`/print/variance-sheet/${cycleId}?status=short,over,unexpected,mislocated,uncounted`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Print issues only
          </a>
          <button
            onClick={downloadReport}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Download CSV
          </button>
        </div>

      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card-elevated">
          <div className="text-xs uppercase text-muted-foreground">Counted value</div>
          <div className="mt-1 text-2xl font-semibold">{fmtMoney(summary.countedValue)}</div>
        </div>
        <div className="card-elevated">
          <div className="text-xs uppercase text-muted-foreground">Expected value</div>
          <div className="mt-1 text-2xl font-semibold">{fmtMoney(summary.expectedValue)}</div>
        </div>
        <div className="card-elevated">
          <div className="text-xs uppercase text-muted-foreground">Variance value</div>
          <div
            className={`mt-1 text-2xl font-semibold ${
              summary.varianceValue < 0
                ? "text-destructive"
                : summary.varianceValue > 0
                  ? "text-warning-foreground"
                  : "text-success"
            }`}
          >
            {fmtMoney(summary.varianceValue)}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {(
          [
            ["match", "Matches", "text-success"],
            ["short", "Shorts", "text-destructive"],
            ["over", "Overs", "text-warning-foreground"],
            ["unexpected", "Unexpected", "text-primary"],
            ["uncounted", "Uncounted", "text-muted-foreground"],
          ] as const
        ).map(([k, label, cls]) => (
          <button
            key={k}
            onClick={() => setFilter((f) => (f === k ? "all" : k))}
            className={`card-elevated text-left transition ${
              filter === k ? "ring-2 ring-primary" : ""
            }`}
          >
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className={`mt-1 text-2xl font-semibold ${cls}`}>{summary[k]}</div>
          </button>
        ))}
      </div>

      {summary.missingCost > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          {summary.missingCost} item(s) have no <span className="font-mono text-xs">unit_cost</span> in
          SKU master and contribute $0 to totals. Update SKU master to include dollar values.
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Filter:</span>
        <button
          onClick={() => setFilter("all")}
          className={`rounded-md border border-border px-3 py-1 ${
            filter === "all" ? "bg-accent" : ""
          }`}
        >
          All ({summary.totalItems})
        </button>
      </div>

      <div className="card-elevated p-0 overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Loc</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Unit $</th>
                <th className="px-3 py-2 text-right">Variance $</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No items.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs">{r.sku ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.description ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.location ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtQty(r.expected_qty)}</td>
                    <td className="px-3 py-2 text-right">{fmtQty(r.counted_qty)}</td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        r.variance < 0
                          ? "text-destructive"
                          : r.variance > 0
                            ? "text-warning-foreground"
                            : ""
                      }`}
                    >
                      {r.variance > 0 ? `+${fmtQty(r.variance)}` : fmtQty(r.variance)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {r.unit_cost == null ? "—" : fmtMoney(r.unit_cost)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium ${
                        r.variance_value < 0
                          ? "text-destructive"
                          : r.variance_value > 0
                            ? "text-warning-foreground"
                            : ""
                      }`}
                    >
                      {fmtMoney(r.variance_value)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
