import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/reports/")({
  component: ReportsIndex,
});

interface Cycle {
  id: string;
  name: string;
  status: string;
  created_at: string;
  finalized_at: string | null;
}

function ReportsIndex() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("cycle_counts")
      .select("id,name,status,created_at,finalized_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCycles((data ?? []) as Cycle[]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Reports</h2>
        <p className="text-sm text-muted-foreground">
          Generate reports per cycle count. More report types coming soon.
        </p>
      </div>

      <div className="card-elevated">
        <h3 className="text-lg font-semibold">Available reports</h3>
        <ul className="mt-2 text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>
            <span className="text-foreground font-medium">Count Summary Report</span> — itemized
            counted quantities, variances, unexpected SKUs, and dollar value (pulled from SKU
            master <span className="font-mono text-xs">unit_cost</span>).
          </li>
          <li>
            <span className="text-foreground font-medium">Out-of-Sequence Scan Report</span> —
            scans flagged as out of alpha-numeric order on the scanner/mobile interface, with
            counter, bin, and the previous scan for reference.
          </li>
        </ul>
      </div>

      <div className="card-elevated p-0 overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Choose a cycle</h3>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : cycles.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No cycles yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Cycle</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Finalized</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-accent/40">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.finalized_at ? new Date(c.finalized_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    <a
                      href={`/print/variance-sheet/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Print full
                    </a>
                    <a
                      href={`/print/variance-sheet/${c.id}?status=short,over,unexpected,mislocated,uncounted`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Print issues
                    </a>
                    <a
                      href={`/print/out-of-sequence/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Out-of-sequence
                    </a>
                    <Link
                      to="/app/reports/$id/summary"
                      params={{ id: c.id }}
                      className="text-primary hover:underline"
                    >
                      Summary →
                    </Link>
                  </td>
                </tr>
              ))}

            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
