import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { classify, downloadCsv, toCsv, type VarianceRow } from "@/lib/variance";
import { compareSkuLex } from "@/lib/sku-sequence";

import { toast } from "sonner";

export const Route = createFileRoute("/app/verify/$id")({
  component: VerificationDashboard,
});

type Tab = "mismatches" | "unexpected" | "mislocated" | "uncounted" | "verified";

interface Row extends VarianceRow {
  verified_at: string | null;
  verified_by: string | null;
  master_location: string | null;
  in_master: boolean;
}

function VerificationDashboard() {
  const { id: cycleId } = useParams({ from: "/app/verify/$id" });
  const { user, isAdmin, isVerifier } = useAuth();
  const canVerify = isAdmin || isVerifier;

  const [rows, setRows] = useState<Row[]>([]);
  const [cycleName, setCycleName] = useState("");
  const [cycleStatus, setCycleStatus] = useState("");
  const [cycleTimes, setCycleTimes] = useState<{
    count_started_at: string | null;
    count_ended_at: string | null;
    verify_started_at: string | null;
    verify_ended_at: string | null;
    finalized_at: string | null;
  } | null>(null);
  const [tab, setTab] = useState<Tab>("mismatches");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [sortAlpha, setSortAlpha] = useState(false);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [moveTargetId, setMoveTargetId] = useState<string>("");


  const load = async () => {
    const [{ data: c }, { data: items }] = await Promise.all([
      supabase.from("cycle_counts").select("name,status,baseline_source,count_started_at,count_ended_at,verify_started_at,verify_ended_at,finalized_at").eq("id", cycleId).single(),
      supabase
        .from("count_items")
        .select(
          "id,sku,barcode,location,description,uom,expected_qty,counted_qty,is_unexpected,mislocated,status,verified_at,verified_by",
        )

        .eq("cycle_id", cycleId)
        .limit(5000),
    ]);
    setCycleName(c?.name ?? "");
    setCycleStatus(c?.status ?? "");
    setCycleTimes(c ? {
      count_started_at: (c as any).count_started_at ?? null,
      count_ended_at: (c as any).count_ended_at ?? null,
      verify_started_at: (c as any).verify_started_at ?? null,
      verify_ended_at: (c as any).verify_ended_at ?? null,
      finalized_at: (c as any).finalized_at ?? null,
    } : null);
    const skus = Array.from(
      new Set((items ?? []).map((i) => i.sku).filter((s): s is string => !!s)),
    );
    const masterMap = new Map<string, string | null>();
    if (skus.length) {
      const { data: master } = await supabase
        .from("sku_master")
        .select("sku,location")
        .in("sku", skus);
      for (const m of master ?? []) masterMap.set(m.sku, m.location);
    }

    const out: Row[] = (items ?? [])
      .filter(
        (i) =>
          // Hide merged-into-home-bin ghost rows (mislocated rows folded into
          // their home counterpart leave a verified row with counted_qty=0).
          !((i as any).mislocated && i.verified_at && Number(i.counted_qty ?? 0) === 0),
      )
      .filter(
        (i) =>
          i.is_unexpected ||
          Number(i.expected_qty ?? 0) > 0 ||
          (i.counted_qty != null && Number(i.counted_qty) > 0),
      )
      .map((i) => ({
        id: i.id,
        sku: i.sku,
        barcode: i.barcode,
        location: i.location,
        description: i.description,
        uom: i.uom,
        expected_qty: Number(i.expected_qty ?? 0),
        counted_qty: i.counted_qty == null ? null : Number(i.counted_qty),
        is_unexpected: i.is_unexpected,
        mislocated: (i as any).mislocated ?? false,
        verified_at: i.verified_at,
        verified_by: i.verified_by,
        variance: Number(i.counted_qty ?? 0) - Number(i.expected_qty ?? 0),
        status: classify(i as any),
        master_location: i.sku ? masterMap.get(i.sku) ?? null : null,
        in_master: i.sku ? masterMap.has(i.sku) : false,
      }));

    setRows(out);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  const groups = useMemo(() => {
    const mismatches = rows.filter(
      (r) => !r.is_unexpected && !r.mislocated && (r.status === "short" || r.status === "over") && !r.verified_at && (r.counted_qty ?? 0) !== 0,
    );
    const mislocated = rows.filter((r) => r.mislocated && !r.verified_at);
    const unexpected = rows.filter((r) => r.is_unexpected && !r.mislocated && !r.verified_at);
    const uncounted = rows.filter(
      (r) =>
        !r.is_unexpected &&
        !r.mislocated &&
        !r.verified_at &&
        r.expected_qty > 0 &&
        (r.counted_qty == null || r.counted_qty === 0),
    );
    const verified = rows.filter((r) => r.verified_at);
    return { mismatches, unexpected, mislocated, uncounted, verified };
  }, [rows]);

  const totalNeedsReview = groups.mismatches.length + groups.unexpected.length + groups.mislocated.length + groups.uncounted.length;


  const visible = useMemo(() => {
    let list =
      tab === "mismatches"
        ? groups.mismatches
        : tab === "unexpected"
          ? groups.unexpected
          : tab === "mislocated"
            ? groups.mislocated
            : tab === "uncounted"
              ? groups.uncounted
              : groups.verified;
    if (varianceOnly) list = list.filter((r) => r.variance !== 0);

    if (search.trim()) {
      const f = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.sku?.toLowerCase().includes(f) ||
          r.barcode?.toLowerCase().includes(f) ||
          r.location?.toLowerCase().includes(f) ||
          r.description?.toLowerCase().includes(f),
      );
    }
    if (sortAlpha) {
      list = [...list].sort((a, b) => compareSkuLex(a.sku, b.sku));
    }
    return list;
  }, [tab, groups, search, varianceOnly, sortAlpha]);


  if (loading) return <div className="text-muted-foreground">Loading verification…</div>;

  const findHomeRow = (r: Row): Row | null => {
    const sku = (r.sku ?? "").trim().toLowerCase();
    if (!sku) return null;
    const candidates = rows.filter(
      (h) =>
        h.id !== r.id &&
        !h.mislocated &&
        (h.sku ?? "").trim().toLowerCase() === sku,
    );
    return candidates.find((h) => !h.is_unexpected) ?? candidates[0] ?? null;
  };

  const mergeMislocatedIntoHome = async (r: Row): Promise<boolean> => {
    if (!user) return false;
    const home = findHomeRow(r);
    if (!home) return false;
    const moveQty = r.counted_qty ?? 0;
    const newHomeQty = (home.counted_qty ?? 0) + moveQty;
    const { error: e1 } = await supabase
      .from("count_items")
      .update({ counted_qty: newHomeQty, status: "counted" })
      .eq("id", home.id);
    if (e1) {
      toast.error(e1.message);
      return false;
    }
    const { error: e2 } = await supabase
      .from("count_items")
      .update({
        counted_qty: 0,
        verified_at: new Date().toISOString(),
        verified_by: user.id,
      })
      .eq("id", r.id);
    if (e2) {
      toast.error(e2.message);
      return false;
    }
    return true;
  };

  const moveToHomeBin = async (r: Row) => {
    if (!canVerify) return;
    setBusyId(r.id);
    const ok = await mergeMislocatedIntoHome(r);
    setBusyId(null);
    if (ok) {
      toast.success(`Moved ${r.counted_qty ?? 0} into home bin`);
      load();
    } else {
      toast.error("No home-bin row found for this SKU in this cycle");
    }
  };

  const verifyRow = async (r: Row, opts?: { newQty?: number }) => {
    if (!canVerify || !user) return;
    setBusyId(r.id);
    // Auto-merge mislocated rows into their home-bin counterpart when one exists.
    if (r.mislocated && opts?.newQty == null) {
      const merged = await mergeMislocatedIntoHome(r);
      if (merged) {
        toast.success(`Moved ${r.counted_qty ?? 0} into home bin`);
        setEdits((e) => {
          const n = { ...e };
          delete n[r.id];
          return n;
        });
        setBusyId(null);
        load();
        return;
      }
    }
    const patch: {
      verified_at: string;
      verified_by: string;
      counted_qty?: number;
      status?: "counted";
    } = {
      verified_at: new Date().toISOString(),
      verified_by: user.id,
    };
    if (opts?.newQty != null) {
      patch.counted_qty = opts.newQty;
      patch.status = "counted";
    }
    const { error } = await supabase.from("count_items").update(patch).eq("id", r.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Item verified");
    setEdits((e) => {
      const n = { ...e };
      delete n[r.id];
      return n;
    });
    load();
  };


  const unverify = async (r: Row) => {
    if (!canVerify) return;
    setBusyId(r.id);
    const { error } = await supabase
      .from("count_items")
      .update({ verified_at: null, verified_by: null })
      .eq("id", r.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    load();
  };

  const removeUnexpected = async (r: Row) => {
    if (!isAdmin) return;
    if (!confirm(`Remove unexpected SKU ${r.sku ?? r.barcode}? This deletes the count entry.`)) return;
    setBusyId(r.id);
    const { error } = await supabase.from("count_items").delete().eq("id", r.id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    load();
  };

  const visibleIds = visible.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));
  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const bulkAcceptAsIs = async () => {
    if (!canVerify || !user) return;
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    if (!confirm(`Accept ${ids.length} item(s) as-is and mark them verified?`)) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("count_items")
      .update({ verified_at: new Date().toISOString(), verified_by: user.id })
      .in("id", ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Verified ${ids.length} item(s)`);
    clearSelection();
    load();
  };

  const bulkUnverify = async () => {
    if (!canVerify) return;
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    if (!confirm(`Unverify ${ids.length} item(s)?`)) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("count_items")
      .update({ verified_at: null, verified_by: null })
      .in("id", ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Unverified ${ids.length} item(s)`);
    clearSelection();
    load();
  };

  const bulkDelete = async () => {
    if (!isAdmin) return;
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} count entry(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    const { error } = await supabase.from("count_items").delete().in("id", ids);
    setBulkBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${ids.length} item(s)`);
    clearSelection();
    load();
  };

  const openMoveDialog = async () => {
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    const { data, error } = await supabase
      .from("cycle_counts")
      .select("id,name,status")
      .neq("id", cycleId)
      .in("status", ["draft", "in_progress", "verifying"])
      .order("name", { ascending: true });
    if (error) return toast.error(error.message);
    setMoveTargets((data ?? []) as Array<{ id: string; name: string; status: string }>);
    setMoveTargetId("");
    setMoveOpen(true);
  };

  const bulkMove = async () => {
    if (!isAdmin) return;
    if (!moveTargetId) return toast.error("Pick a destination cycle");
    const ids = visibleIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const { error } = await supabase
        .from("count_items")
        .update({ cycle_id: moveTargetId, verified_at: null, verified_by: null })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Moved ${ids.length} item(s) to selected cycle`);
      setMoveOpen(false);
      clearSelection();
      load();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBulkBusy(false);
    }
  };


  const selectedVisibleCount = visibleIds.filter((id) => selected.has(id)).length;


  const moveTo = async (status: "verifying" | "finalized") => {
    const nowIso = new Date().toISOString();
    const patch =
      status === "finalized"
        ? { status, finalized_at: nowIso, verify_ended_at: nowIso }
        : { status, count_ended_at: nowIso, verify_started_at: nowIso };
    const { error } = await supabase.from("cycle_counts").update(patch).eq("id", cycleId);
    if (error) return toast.error(error.message);
    toast.success(`Cycle moved to ${status}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/verify" className="text-xs text-muted-foreground hover:underline">
            ← All verifications
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Verify — {cycleName}</h2>
          <p className="text-sm text-muted-foreground">
            Status: {cycleStatus} · {totalNeedsReview} item(s) need review · {groups.verified.length} verified
          </p>
          {cycleTimes && (
            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <div>Count started: <span className="text-foreground">{cycleTimes.count_started_at ? new Date(cycleTimes.count_started_at).toLocaleString() : "—"}</span></div>
              <div>Count ended: <span className="text-foreground">{cycleTimes.count_ended_at ? new Date(cycleTimes.count_ended_at).toLocaleString() : "—"}</span></div>
              <div>Verify started: <span className="text-foreground">{cycleTimes.verify_started_at ? new Date(cycleTimes.verify_started_at).toLocaleString() : "—"}</span></div>
              <div>Verify ended: <span className="text-foreground">{(cycleTimes.verify_ended_at ?? cycleTimes.finalized_at) ? new Date((cycleTimes.verify_ended_at ?? cycleTimes.finalized_at)!).toLocaleString() : "—"}</span></div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/app/cycles/$id"
            params={{ id: cycleId }}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            View cycle
          </Link>
          <Link
            to="/print/variance-sheet/$id"
            params={{ id: cycleId }}
            target="_blank"
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Print full sheet
          </Link>
          <Link
            to="/print/variance-sheet/$id"
            params={{ id: cycleId }}
            search={{ status: "short,over,unexpected,mislocated,uncounted" }}
            target="_blank"
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Print issues only
          </Link>

          <button
            onClick={() => downloadCsv(`${cycleName.replace(/\s+/g, "_")}_variance.csv`, toCsv(rows))}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Download CSV
          </button>
          {isAdmin && cycleStatus === "in_progress" && (
            <button
              onClick={() => moveTo("verifying")}
              className="rounded-md bg-warning px-3 py-2 text-sm font-medium text-warning-foreground hover:opacity-90"
            >
              Send to verifier
            </button>
          )}
          {(isAdmin || isVerifier) && (cycleStatus === "verifying" || cycleStatus === "in_progress") && (
            <Link
              to="/app/cycles/$id/finalize"
              params={{ id: cycleId }}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Finalize →
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard
          label="Quantity mismatches"
          value={groups.mismatches.length}
          tone="text-destructive"
          active={tab === "mismatches"}
          onClick={() => setTab("mismatches")}
        />
        <SummaryCard
          label="Unexpected SKUs"
          value={groups.unexpected.length}
          tone="text-primary"
          active={tab === "unexpected"}
          onClick={() => setTab("unexpected")}
        />
        <SummaryCard
          label="Mislocated"
          value={groups.mislocated.length}
          tone="text-warning-foreground"
          active={tab === "mislocated"}
          onClick={() => setTab("mislocated")}
        />

        <SummaryCard
          label="Uncounted / zero"
          value={groups.uncounted.length}
          tone="text-warning-foreground"
          active={tab === "uncounted"}
          onClick={() => setTab("uncounted")}
        />
        <SummaryCard
          label="Verified"
          value={groups.verified.length}
          tone="text-success"
          active={tab === "verified"}
          onClick={() => setTab("verified")}
        />
      </div>

      {canVerify && (
        <AddVerifyEntry cycleId={cycleId} userId={user?.id ?? null} onAdded={load} />
      )}

      <div className="card-elevated p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by SKU, barcode, location, description…"
            className="min-w-[200px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              varianceOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <input
              type="checkbox"
              checked={varianceOnly}
              onChange={(e) => setVarianceOnly(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Variance only
          </label>
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              sortAlpha
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            <input
              type="checkbox"
              checked={sortAlpha}
              onChange={(e) => setSortAlpha(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Sort A–Z
          </label>

        </div>
        {selectedVisibleCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 p-3 text-sm">
            <span className="font-medium">
              {selectedVisibleCount} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-xs text-muted-foreground hover:underline"
            >
              Clear
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {tab === "verified"
                ? canVerify && (
                    <button
                      onClick={bulkUnverify}
                      disabled={bulkBusy}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      Unverify selected
                    </button>
                  )
                : canVerify && (
                    <button
                      onClick={bulkAcceptAsIs}
                      disabled={bulkBusy}
                      className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-success-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      Accept selected as-is
                    </button>
                  )}
              {isAdmin && (
                <button
                  onClick={openMoveDialog}
                  disabled={bulkBusy}
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  Move to cycle…
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={bulkDelete}
                  disabled={bulkBusy}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  Delete selected
                </button>
              )}

            </div>
          </div>
        )}
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                    className="h-4 w-4 accent-primary"
                  />
                </th>
                <th className="px-3 py-2">SKU / Barcode</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const editVal = edits[r.id] ?? "";
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.sku ?? r.barcode ?? r.id}`}
                        checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="h-4 w-4 accent-primary"
                      />
                    </td>
                    <td className="px-3 py-2">

                      <div className="font-medium">{r.sku ?? "—"}</div>
                      {r.barcode && <div className="text-xs text-muted-foreground">{r.barcode}</div>}
                      {r.mislocated && (
                        <span className="mt-1 inline-block rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase text-warning-foreground">
                          Mislocated
                        </span>
                      )}
                      {r.is_unexpected && !r.mislocated && (
                        <span className="mt-1 inline-block rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                          Unexpected
                        </span>
                      )}

                    </td>
                    <td className="px-3 py-2">
                      <div>{r.location ?? "—"}</div>
                      {r.is_unexpected && r.in_master && r.master_location && r.master_location !== r.location && (
                        <div className="mt-1 text-[11px] text-primary">
                          Assigned to: <span className="font-medium">{r.master_location}</span>
                        </div>
                      )}
                      {r.is_unexpected && !r.in_master && (
                        <div className="mt-1 text-[11px] text-destructive">Not in SKU master</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground truncate max-w-xs">{r.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{r.expected_qty}</td>
                    <td className="px-3 py-2 text-right">{r.counted_qty ?? "—"}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        r.variance < 0 ? "text-destructive" : r.variance > 0 ? "text-warning-foreground" : ""
                      }`}
                    >
                      {r.variance > 0 ? `+${r.variance}` : r.variance}
                    </td>
                    <td className="px-3 py-2">
                      {tab === "verified" ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                            Verified
                          </span>
                          {canVerify && (
                            <button
                              onClick={() => unverify(r)}
                              disabled={busyId === r.id}
                              className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      ) : canVerify ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={editVal}
                            onChange={(e) => setEdits((s) => ({ ...s, [r.id]: e.target.value }))}
                            placeholder="Adjust qty"
                            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() => {
                              const n = Number(editVal);
                              if (editVal === "" || Number.isNaN(n))
                                return toast.error("Enter a number to adjust");
                              verifyRow(r, { newQty: n });
                            }}
                            disabled={busyId === r.id || editVal === ""}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                          >
                            Adjust & verify
                          </button>
                          <button
                            onClick={() => verifyRow(r)}
                            disabled={busyId === r.id}
                            className="rounded-md bg-success px-2 py-1 text-xs font-medium text-success-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            Accept as-is
                          </button>
                          {r.mislocated && findHomeRow(r) && (
                            <button
                              onClick={() => moveToHomeBin(r)}
                              disabled={busyId === r.id}
                              className="rounded-md border border-warning/40 px-2 py-1 text-xs text-warning-foreground hover:bg-warning/10 disabled:opacity-50"
                              title={`Add ${r.counted_qty ?? 0} into home-bin row for ${r.sku}`}
                            >
                              Move to home bin
                            </button>
                          )}
                          {r.is_unexpected && isAdmin && (
                            <button
                              onClick={() => removeUnexpected(r)}
                              disabled={busyId === r.id}
                              className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Verifier role required</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    {tab === "verified"
                      ? "Nothing verified yet."
                      : "Nothing to review here. 🎉"}
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </div>

    <VerifyProgressBars rows={rows} />

    {moveOpen && (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
          <div className="text-sm font-semibold">Move {selectedVisibleCount} item(s) to another cycle</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick an open cycle. Selected items will be reassigned as-is (no merging) so duplicates in the
            destination remain visible for review. Moved items will be reset to unverified.
          </p>

          <div className="mt-3">
            <label className="block text-xs font-medium text-muted-foreground">Destination cycle</label>
            <select
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— select cycle —</option>
              {moveTargets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
            {moveTargets.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">No other open cycles available.</p>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setMoveOpen(false)}
              disabled={bulkBusy}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={bulkMove}
              disabled={bulkBusy || !moveTargetId}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {bulkBusy ? "Moving…" : "Move items"}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>

  );
}

function VerifyProgressBars({ rows }: { rows: Row[] }) {
  const counted = rows.filter((r) => r.counted_qty != null).length;
  const verified = rows.filter((r) => !!r.verified_at).length;
  const verifyPct = counted ? Math.round((verified / counted) * 100) : 0;
  return (
    <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">Verification progress</span>
          <span className="tabular-nums">{verified} / {counted} ({verifyPct}%)</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-success transition-all" style={{ width: `${verifyPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function AddVerifyEntry({
  cycleId,
  userId,
  onAdded,
}: {
  cycleId: string;
  userId: string | null;
  onAdded: () => void;
}) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const c = code.trim();
    const n = Number(qty);
    if (!c) return toast.error("Enter a SKU or barcode");
    if (!Number.isFinite(n) || n < 0) return toast.error("Enter a valid quantity");
    setBusy(true);
    try {
      const { data: matches } = await supabase.rpc("find_count_item_by_code", {
        p_cycle_id: cycleId,
        p_code: c,
      });
      let item: any = (matches as any[] | null)?.[0] ?? null;

      if (!item) {
        const { data: masterMatches } = await supabase.rpc("find_master_sku_by_code", {
          p_code: c,
        });
        const master = (masterMatches as any[] | null)?.[0] ?? null;
        if (master) {
          const { data: ins, error: insErr } = await supabase
            .from("count_items")
            .insert({
              cycle_id: cycleId,
              sku: master.sku,
              barcode: master.barcode,
              location: master.location,
              location2: master.location2,
              description: master.description,
              uom: master.uom,
              unit_cost: master.unit_cost,
              expected_qty: 0,
              is_unexpected: true,
            })
            .select()
            .single();
          if (insErr) throw insErr;
          item = ins;
          if (userId) {
            await supabase
              .from("barcode_aliases")
              .insert({ sku: master.sku, barcode: c, created_by: userId })
              .then(() => {}, () => {});
          }
        }
      }

      if (!item) {
        const { data: ins, error: insErr } = await supabase
          .from("count_items")
          .insert({
            cycle_id: cycleId,
            sku: c,
            barcode: c,
            expected_qty: 0,
            is_unexpected: true,
          })
          .select()
          .single();
        if (insErr) throw insErr;
        item = ins;
      }

      const nowIso = new Date().toISOString();
      const newQty = Number(item.counted_qty ?? 0) + n;
      const { error: upErr } = await supabase
        .from("count_items")
        .update({
          counted_qty: newQty,
          counted_by: userId,
          counted_at: nowIso,
          status: "counted",
          verified_at: nowIso,
          verified_by: userId,
        })
        .eq("id", item.id);
      if (upErr) throw upErr;

      if (userId) {
        await supabase.from("count_events").insert({
          cycle_id: cycleId,
          item_id: item.id,
          user_id: userId,
          action: "verify_add",
          qty_before: Number(item.counted_qty ?? 0),
          qty_after: newQty,
          source: "web-verify",
        });
      }

      toast.success(`Added ${n} to ${item.sku ?? c}`);
      setCode("");
      setQty("1");
      onAdded();
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card-elevated">
      <div className="mb-2 text-sm font-semibold">Add verifier entry</div>
      <p className="mb-3 text-xs text-muted-foreground">
        Scan or type a SKU/barcode and quantity. Resolves to the canonical master SKU when possible, then marks the entry verified.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="SKU or barcode"
          className="min-w-[220px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <input
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add & verify"}
        </button>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`card-elevated text-left transition ${active ? "ring-2 ring-primary" : ""}`}
    >
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${tone}`}>{value}</div>
    </button>
  );
}
