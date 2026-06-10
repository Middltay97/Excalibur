import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { classify, type VarianceRow } from "@/lib/variance";
import { buildCountSummaryPdf, pdfToBase64 } from "@/lib/count-summary-pdf";
import { sendCycleReport } from "@/lib/send-cycle-report.functions";
import { fetchSkuCostsFor } from "@/lib/sku-costs";
import { fetchUserNames } from "@/lib/user-names";

const FINALIZABLE = new Set(["draft", "in_progress", "verifying", "verified"]);

type BulkMode = "none" | "pdf" | "email";

export const Route = createFileRoute("/app/cycles/")({
  component: CyclesList,
});

interface Cycle {
  id: string;
  name: string;
  status: string;
  created_at: string;
  baseline_filename: string | null;
  due_date: string | null;
  archived_at: string | null;
}

function CyclesList() {
  const { user, isAdmin, isVerifier } = useAuth();
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"active" | "archive">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const canFinalize = isAdmin || isVerifier;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const load = () => {
    supabase
      .from("cycle_counts")
      .select("id,name,status,created_at,baseline_filename,due_date,archived_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCycles((data ?? []) as Cycle[]);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete cycle "${name}"? This cannot be undone.`)) return;
    const { error } = await supabase.rpc("delete_cycle", { _cycle_id: id });
    if (error) return toast.error(error.message);
    setCycles((prev) => prev.filter((c) => c.id !== id));
    toast.success(`Deleted "${name}".`);
  };

  const handleArchive = async (id: string, archive: boolean) => {
    const { error } = await supabase
      .from("cycle_counts")
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(archive ? "Archived" : "Restored");
    load();
  };

  const handleBulkFinalize = async (mode: BulkMode) => {
    if (!user) return;
    const targets = cycles.filter(
      (c) => selected.has(c.id) && FINALIZABLE.has(c.status) && !c.archived_at,
    );
    if (targets.length === 0) return toast.error("No finalizable cycles selected.");
    const label =
      mode === "email"
        ? `Finalize & email ${targets.length} cycle(s)?`
        : mode === "pdf"
          ? `Finalize & download PDFs for ${targets.length} cycle(s)?`
          : `Finalize ${targets.length} cycle(s)?`;
    if (!confirm(`${label} This locks them and cannot be undone.`)) return;

    setBulkBusy(true);

    let recipients: string[] = [];
    if (mode === "email") {
      const { data: recs } = await supabase.from("email_recipients").select("email");
      recipients = (recs ?? []).map((r: any) => r.email).filter(Boolean);
      if (recipients.length === 0) {
        setBulkBusy(false);
        return toast.error("No saved email recipients. Add some in a cycle's finalize page.");
      }
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("cycle_counts")
      .update({
        status: "finalized",
        finalized_at: nowIso,
        verify_ended_at: nowIso,
        finalized_by: user.id,
        archived_at: nowIso,
        archived_by: user.id,
      })
      .in("id", targets.map((c) => c.id));
    if (updErr) {
      setBulkBusy(false);
      return toast.error(updErr.message);
    }

    let pdfOk = 0;
    let emailOk = 0;
    const failures: string[] = [];

    if (mode !== "none") {
      for (const c of targets) {
        try {
          const [{ data: items }, { data: cycleMeta }] = await Promise.all([
            supabase
              .from("count_items")
              .select(
                "id,sku,barcode,location,description,uom,expected_qty,counted_qty,is_unexpected,mislocated,verified_at,counted_by,verified_by,status",
              )
              .eq("cycle_id", c.id)
              .limit(5000),
            supabase
              .from("cycle_counts")
              .select("count_started_at,count_ended_at")
              .eq("id", c.id)
              .single(),
          ]);
          const rows: VarianceRow[] = (items ?? []).map((i: any) => ({
            ...i,
            variance: (i.counted_qty ?? 0) - (i.expected_qty ?? 0),
            status: classify(i),
          }));
          const [costs, userNames] = await Promise.all([
            fetchSkuCostsFor((items ?? []).map((i: any) => i.sku)),
            fetchUserNames((items ?? []).flatMap((i: any) => [i.counted_by, i.verified_by])),
          ]);
          const doc = buildCountSummaryPdf({
            cycleName: c.name,
            cycleStatus: "finalized",
            rows,
            costs,
            countStartedAt: (cycleMeta as any)?.count_started_at ?? null,
            countEndedAt: (cycleMeta as any)?.count_ended_at ?? null,
            userNames,
          });
          const filename = `${c.name.replace(/\s+/g, "_")}_count_summary.pdf`;

          if (mode === "pdf") {
            doc.save(filename);
            pdfOk++;
          } else {
            const pdfBase64 = pdfToBase64(doc);
            const counts = rows.reduce(
              (acc, r) => {
                acc[r.status] = (acc[r.status] ?? 0) + 1;
                return acc;
              },
              {} as Record<string, number>,
            );
            await sendCycleReport({
              data: {
                cycleName: c.name,
                recipients,
                pdfBase64,
                summary: {
                  match: counts.match ?? 0,
                  short: counts.short ?? 0,
                  over: counts.over ?? 0,
                  unexpected: counts.unexpected ?? 0,
                  uncounted: counts.uncounted ?? 0,
                },
              },
            });
            emailOk++;
          }
        } catch (e: any) {
          failures.push(`${c.name}: ${e?.message ?? e}`);
        }
      }
    }

    setBulkBusy(false);
    setSelected(new Set());
    load();

    if (mode === "none") {
      toast.success(`Finalized ${targets.length} cycle(s).`);
    } else if (mode === "pdf") {
      toast.success(`Finalized ${targets.length}. Downloaded ${pdfOk} PDF(s).`);
    } else {
      toast.success(
        `Finalized ${targets.length}. Emailed ${emailOk} report(s) to ${recipients.length} recipient(s).`,
      );
    }
    if (failures.length) {
      toast.error(`${failures.length} failed: ${failures.slice(0, 3).join("; ")}`);
    }
  };

  const filtered = useMemo(
    () => cycles.filter((c) => (view === "active" ? !c.archived_at : !!c.archived_at)),
    [cycles, view],
  );

  const selectableIds = useMemo(
    () => filtered.filter((c) => FINALIZABLE.has(c.status)).map((c) => c.id),
    [filtered],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const statusColor: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    in_progress: "bg-primary/15 text-primary",
    verifying: "bg-warning/20 text-warning-foreground",
    finalized: "bg-success/20 text-success-foreground",
  };

  const activeCount = cycles.filter((c) => !c.archived_at).length;
  const archiveCount = cycles.length - activeCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Cycle Counts</h2>
          <p className="text-sm text-muted-foreground">All counts you can access.</p>
        </div>
        {isAdmin && (
          <Link to="/app/cycles/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            + New cycle count
          </Link>
        )}
      </div>

      <div className="inline-flex rounded-md border border-border p-0.5">
        <button
          onClick={() => setView("active")}
          className={`rounded px-3 py-1.5 text-sm ${view === "active" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setView("archive")}
          className={`rounded px-3 py-1.5 text-sm ${view === "archive" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Archive ({archiveCount})
        </button>
      </div>

      {canFinalize && view === "active" && selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-border bg-accent/30 px-4 py-2 text-sm">
          <span>{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
            >
              Clear
            </button>
            <button
              onClick={() => handleBulkFinalize("none")}
              disabled={bulkBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {bulkBusy ? "Working…" : `Finalize ${selected.size}`}
            </button>
            <button
              onClick={() => handleBulkFinalize("pdf")}
              disabled={bulkBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              Finalize + download PDFs
            </button>
            <button
              onClick={() => handleBulkFinalize("email")}
              disabled={bulkBusy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Finalize + email reports
            </button>
          </div>
        </div>
      )}

      <div className="card-elevated p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {view === "active" ? "No active cycle counts." : "Archive is empty."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {canFinalize && view === "active" && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        if (e.target.checked) setSelected(new Set(selectableIds));
                        else setSelected(new Set());
                      }}
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                )}
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Baseline</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-accent/40">
                  {canFinalize && view === "active" && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        disabled={!FINALIZABLE.has(c.status)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor[c.status] ?? ""}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.baseline_filename ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link to="/app/cycles/$id" params={{ id: c.id }} className="text-primary hover:underline">
                        Open →
                      </Link>
                      {isAdmin && (
                        <button
                          onClick={() => handleArchive(c.id, !c.archived_at)}
                          className="text-muted-foreground hover:underline"
                        >
                          {c.archived_at ? "Restore" : "Archive"}
                        </button>
                      )}
                      {isAdmin && c.status !== "finalized" && (
                        <button onClick={() => handleDelete(c.id, c.name)} className="text-destructive hover:underline">
                          Delete
                        </button>
                      )}
                    </div>
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
