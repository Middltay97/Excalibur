import { createFileRoute, Link, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { classify, type VarianceRow } from "@/lib/variance";
import { buildCountSummaryPdf, pdfToBase64 } from "@/lib/count-summary-pdf";
import { toast } from "sonner";
import { sendCycleReport } from "@/lib/send-cycle-report.functions";
import { fetchSkuCostsFor } from "@/lib/sku-costs";
import { fetchUserNames } from "@/lib/user-names";

export const Route = createFileRoute("/app/cycles/$id/finalize")({
  component: FinalizePage,
});

interface Recipient {
  id: string;
  email: string;
  label: string | null;
}

function FinalizePage() {
  const router = useRouter();
  const { id: cycleId } = useParams({ from: "/app/cycles/$id/finalize" });
  const { user, isAdmin, isVerifier } = useAuth();
  const [cycleName, setCycleName] = useState("");
  const [cycleStatus, setCycleStatus] = useState("");
  const [countStartedAt, setCountStartedAt] = useState<string | null>(null);
  const [countEndedAt, setCountEndedAt] = useState<string | null>(null);
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [costs, setCosts] = useState<Map<string, number>>(new Map());
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adhoc, setAdhoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [{ data: c }, { data: items }, { data: recs }] = await Promise.all([
      supabase.from("cycle_counts").select("name,status,count_started_at,count_ended_at").eq("id", cycleId).single(),
      supabase
        .from("count_items")
        .select("id,sku,barcode,location,description,uom,expected_qty,counted_qty,is_unexpected,mislocated,verified_at,counted_by,verified_by,status")
        .eq("cycle_id", cycleId)
        .limit(5000),
      supabase.from("email_recipients").select("id,email,label").order("email"),
    ]);
    const [costMap, names] = await Promise.all([
      fetchSkuCostsFor((items ?? []).map((i: any) => i.sku)),
      fetchUserNames((items ?? []).flatMap((i: any) => [i.counted_by, i.verified_by])),
    ]);
    setCycleName(c?.name ?? "");
    setCycleStatus(c?.status ?? "");
    setCountStartedAt((c as any)?.count_started_at ?? null);
    setCountEndedAt((c as any)?.count_ended_at ?? null);
    const out: VarianceRow[] = (items ?? []).map((i: any) => ({
      ...i,
      variance: (i.counted_qty ?? 0) - (i.expected_qty ?? 0),
      status: classify(i),
    }));
    setRows(out);
    setCosts(costMap);
    setUserNames(names);
    const r = (recs ?? []) as Recipient[];
    setRecipients(r);
    setSelected(new Set(r.map((x) => x.email)));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  if (loading) return <div className="text-muted-foreground">Loading…</div>;
  if (!isAdmin && !isVerifier) {
    return <div className="card-elevated">Only admins or verifiers can finalize cycles.</div>;
  }
  if (cycleStatus === "finalized") {
    return (
      <div className="space-y-4">
        <div>
          <Link to="/app/cycles/$id" params={{ id: cycleId }} className="text-xs text-muted-foreground hover:underline">
            ← Back to cycle
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">{cycleName}</h2>
          <p className="text-sm text-muted-foreground">
            This cycle has already been finalized and cannot be finalized again.
          </p>
        </div>
        <div className="card-elevated flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">Download the count summary as a PDF.</div>
          <button
            onClick={() => {
              const doc = buildCountSummaryPdf({ cycleName, cycleStatus, rows, costs, countStartedAt, countEndedAt, userNames });
              doc.save(`${cycleName.replace(/\s+/g, "_")}_count_summary.pdf`);
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Download PDF
          </button>
        </div>
      </div>
    );
  }

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const finalize = async (sendEmail: boolean) => {
    if (!user) return;
    setBusy(true);
    const pdfDoc = buildCountSummaryPdf({ cycleName, cycleStatus, rows, costs, countStartedAt, countEndedAt, userNames });
    const pdfBase64 = pdfToBase64(pdfDoc);
    pdfDoc.save(`${cycleName.replace(/\s+/g, "_")}_count_summary.pdf`);

    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from("cycle_counts")
      .update({ status: "finalized", finalized_at: nowIso, verify_ended_at: nowIso, finalized_by: user.id, archived_at: nowIso, archived_by: user.id })
      .eq("id", cycleId);
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }

    if (sendEmail) {
      const all = new Set(selected);
      adhoc
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter((e) => /.+@.+\..+/.test(e))
        .forEach((e) => all.add(e));
      if (all.size === 0) {
        toast.warning("Cycle finalized, but no email recipients selected.");
      } else {
        try {
          const counts = rows.reduce(
            (acc, r) => {
              acc[r.status] = (acc[r.status] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          );
          await sendCycleReport({
            data: {
              cycleName,
              recipients: Array.from(all),
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
          toast.success(`Cycle finalized. Report emailed to ${all.size} recipient(s).`);
        } catch (e: any) {
          toast.error(`Cycle finalized, but email failed: ${e?.message ?? e}`);
        }
      }
    } else {
      toast.success("Cycle finalized. PDF downloaded.");
    }
    setBusy(false);
    router.navigate({ to: "/app/cycles/$id", params: { id: cycleId } });
  };

  const addRecipient = async (email: string, label: string) => {
    const { data, error } = await supabase
      .from("email_recipients")
      .insert({ email: email.trim(), label: label.trim() || null })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setRecipients((r) => [...r, data as Recipient]);
    setSelected((s) => new Set(s).add(data!.email));
  };

  return (
    <div className="space-y-4">
      <div>
        <Link to="/app/verify/$id" params={{ id: cycleId }} className="text-xs text-muted-foreground hover:underline">
          ← Back to verification
        </Link>
        <h2 className="mt-1 text-2xl font-semibold">Finalize — {cycleName}</h2>
        <p className="text-sm text-muted-foreground">
          Current status: <span className="font-medium text-foreground">{cycleStatus}</span>
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ["match", "Matches", "text-success"],
          ["short", "Shorts", "text-destructive"],
          ["over", "Overs", "text-warning-foreground"],
          ["unexpected", "Unexpected", "text-primary"],
          ["uncounted", "Uncounted", "text-muted-foreground"],
        ].map(([k, label, cls]) => (
          <div key={k} className="card-elevated">
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className={`mt-1 text-2xl font-semibold ${cls}`}>{counts[k] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="card-elevated space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Email recipients</h3>
          <p className="text-sm text-muted-foreground">
            Choose who receives the final report. You can also add ad-hoc emails below.
          </p>
        </div>
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved recipients yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(r.email)}
                  onChange={(e) => {
                    setSelected((s) => {
                      const next = new Set(s);
                      e.target.checked ? next.add(r.email) : next.delete(r.email);
                      return next;
                    });
                  }}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.email}</div>
                  {r.label && <div className="text-xs text-muted-foreground">{r.label}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isAdmin && <AddRecipientForm onAdd={addRecipient} />}
        <div>
          <label className="block text-sm font-medium">Ad-hoc emails (comma or space separated)</label>
          <input
            value={adhoc}
            onChange={(e) => setAdhoc(e.target.value)}
            placeholder="ops@example.com, manager@example.com"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="card-elevated flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          Finalizing locks the cycle and downloads the count summary PDF.
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => finalize(false)}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            Finalize + download PDF
          </button>

          <button
            onClick={() => finalize(true)}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Finalize + email report
          </button>
        </div>
      </div>
    </div>
  );
}

function AddRecipientForm({ onAdd }: { onAdd: (email: string, label: string) => void }) {
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!/.+@.+\..+/.test(email)) return toast.error("Invalid email");
        onAdd(email, label);
        setEmail("");
        setLabel("");
      }}
      className="flex flex-wrap gap-2"
    >
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@company.com"
        className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label (optional)"
        className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
        + Add recipient
      </button>
    </form>
  );
}
