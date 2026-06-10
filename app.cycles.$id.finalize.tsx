import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { CameraScanner } from "@/components/camera-scanner";
import { dequeue, enqueue, getQueued, type QueuedCount } from "@/lib/offline-queue";
import { outOfSequenceIndices } from "@/lib/sku-sequence";
import { parseSkuScan } from "@/lib/sku-normalize";

export const Route = createFileRoute("/app/cycles/$id/count")({
  component: CountUI,
});

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
  is_unexpected: boolean;
}

function CountUI() {
  const { id: cycleId } = useParams({ from: "/app/cycles/$id/count" });
  const { user } = useAuth();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [active, setActive] = useState<Item | null>(null);
  const [qty, setQty] = useState<string>("1");
  const [unmatched, setUnmatched] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<Item[]>([]);
  const [progress, setProgress] = useState({ counted: 0, total: 0 });
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queueSize, setQueueSize] = useState(0);
  const [recent, setRecent] = useState<Array<{ sku: string; qty: number; at: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshProgress = useCallback(async () => {
    const [{ count: total }, { count: counted }] = await Promise.all([
      supabase.from("count_items").select("*", { count: "exact", head: true }).eq("cycle_id", cycleId),
      supabase
        .from("count_items")
        .select("*", { count: "exact", head: true })
        .eq("cycle_id", cycleId)
        .neq("status", "uncounted"),
    ]);
    setProgress({ counted: counted ?? 0, total: total ?? 0 });
  }, [cycleId]);

  const refreshQueue = useCallback(async () => {
    setQueueSize((await getQueued()).length);
  }, []);

  useEffect(() => {
    refreshProgress();
    refreshQueue();
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    inputRef.current?.focus();
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, [refreshProgress, refreshQueue]);

  // Auto-sync queue when online
  useEffect(() => {
    if (!online) return;
    syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const lookup = useCallback(
    async (raw: string) => {
      if (!raw) return;
      // Centralized canonical parsing. Send the canonical body (no hyphens)
      // when valid, so backend resolution is deterministic across scanner
      // formats. Preserve raw for debug only.
      const parsed = parseSkuScan(raw);
      if (!parsed.valid) {
        console.warn("[scan] unparseable", {
          raw,
          rawLength: raw.length,
          pattern: parsed.pattern,
        });
      }
      const code = parsed.canonical ?? raw.trim();
      if (!code) return;
      // 1. Try resolving against this cycle (covers SKU/barcode + learned aliases + 10/12-char candidates)
      const { data: matches, error } = await supabase.rpc("find_count_item_by_code", {
        p_cycle_id: cycleId,
        p_code: code,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      const found = (matches as Item[] | null)?.[0];
      if (found) {
        setActive(found);
        setQty("1");
        setScanInput("");
        inputRef.current?.focus();
        return;
      }
      // 2. Fall back to master SKU — promote to canonical unexpected on this cycle
      const { data: masterMatches } = await supabase.rpc("find_master_sku_by_code", {
        p_code: code,
      });
      const master = (masterMatches as Array<{
        sku: string;
        barcode: string | null;
        location: string | null;
        location2: string | null;
        description: string | null;
        uom: string | null;
        unit_cost: number | null;
      }> | null)?.[0];
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
        if (insErr) {
          toast.error(insErr.message);
          return;
        }
        if (user) {
          await supabase
            .from("barcode_aliases")
            .insert({ sku: master.sku, barcode: code, created_by: user.id })
            .then(() => {}, () => {});
        }
        setActive(ins as Item);
        setQty("1");
        setScanInput("");
        inputRef.current?.focus();
        return;
      }
      // 3. Unknown → open resolution modal
      setUnmatched(code);
      setLinkQuery("");
      setLinkResults([]);
      setScanInput("");
    },
    [cycleId, user],
  );

  const searchItems = useCallback(
    async (q: string) => {
      setLinkQuery(q);
      const term = q.trim();
      if (!term) return setLinkResults([]);
      const { data } = await supabase
        .from("count_items")
        .select("*")
        .eq("cycle_id", cycleId)
        .or(`sku.ilike.%${term}%,description.ilike.%${term}%`)
        .limit(15);
      setLinkResults((data ?? []) as Item[]);
    },
    [cycleId],
  );

  const linkBarcodeToItem = async (item: Item) => {
    if (!unmatched || !user || !item.sku) return;
    const { error } = await supabase.from("barcode_aliases").insert({
      sku: item.sku,
      barcode: unmatched,
      created_by: user.id,
    });
    if (error && !error.message.includes("duplicate")) {
      toast.error(error.message);
      return;
    }
    toast.success(`Linked ${unmatched} → ${item.sku}`);
    setUnmatched(null);
    setActive(item);
    setQty("1");
    inputRef.current?.focus();
  };

  const addAsUnexpected = async () => {
    if (!unmatched) return;
    const { data: ins, error: insErr } = await supabase
      .from("count_items")
      .insert({
        cycle_id: cycleId,
        sku: unmatched,
        barcode: unmatched,
        expected_qty: 0,
        is_unexpected: true,
      })
      .select()
      .single();
    if (insErr) return toast.error(insErr.message);
    setUnmatched(null);
    setActive(ins as Item);
    setQty("1");
    inputRef.current?.focus();
  };

  const onScanInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      lookup(scanInput);
    }
  };

  const submit = async () => {
    if (!active || !user) return;
    const n = Number(qty);
    if (!Number.isFinite(n) || n < 0) return toast.error("Enter a valid quantity");
    const before = active.counted_qty;
    const after = (before ?? 0) + n;

    const event: QueuedCount = {
      id: crypto.randomUUID(),
      cycle_id: cycleId,
      item_id: active.id,
      sku: active.sku,
      barcode: active.barcode,
      qty_before: before,
      qty_after: after,
      action: active.is_unexpected ? "unexpected" : "count",
      user_id: user.id,
      created_at: new Date().toISOString(),
      is_unexpected: active.is_unexpected,
    };

    if (!navigator.onLine) {
      await enqueue(event);
      toast.success(`Queued offline: ${active.sku} +${n}`);
      pushRecent(active.sku ?? "?", n);
      setActive(null);
      refreshQueue();
      inputRef.current?.focus();
      return;
    }

    const ok = await pushEvent(event);
    if (ok) {
      pushRecent(active.sku ?? "?", n);
      toast.success(`${active.sku}: ${after}`);
      setActive(null);
      refreshProgress();
    } else {
      await enqueue(event);
      toast.warning("Saved offline — will sync when online.");
      refreshQueue();
    }
    inputRef.current?.focus();
  };

  const pushRecent = (sku: string, q: number) => {
    setRecent((r) => [{ sku, qty: q, at: Date.now() }, ...r].slice(0, 8));
  };

  const syncQueue = async () => {
    const items = await getQueued();
    if (items.length === 0) return;
    let n = 0;
    for (const it of items) {
      const ok = await pushEvent(it);
      if (ok) {
        await dequeue(it.id);
        n++;
      } else {
        break;
      }
    }
    if (n > 0) toast.success(`Synced ${n} offline counts`);
    refreshQueue();
    refreshProgress();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/app/cycles/$id" params={{ id: cycleId }} className="text-xs text-muted-foreground hover:underline">
            ← Back to cycle
          </Link>
          <h2 className="mt-1 text-2xl font-semibold">Count</h2>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-flex h-2.5 w-2.5 rounded-full ${online ? "bg-success" : "bg-warning"}`}
          />
          <span className="text-muted-foreground">{online ? "Online" : "Offline"}</span>
          {queueSize > 0 && (
            <button
              onClick={syncQueue}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              {queueSize} queued · sync
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Progress" value={`${progress.counted} / ${progress.total}`} />
        <Stat
          label="Percent"
          value={progress.total ? `${Math.round((progress.counted / progress.total) * 100)}%` : "—"}
        />
        <Stat label="Remaining" value={Math.max(0, progress.total - progress.counted)} />
      </div>

      <div className="card-elevated space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Scan or type barcode / SKU</span>
          <div className="mt-1 flex gap-2">
            <input
              ref={inputRef}
              autoFocus
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={onScanInputKey}
              placeholder="RF scanner wedge focuses here…"
              className="flex-1 rounded-md border border-input bg-background px-3 py-3 text-base"
            />
            <button
              onClick={() => setScannerOpen(true)}
              className="rounded-md border border-border px-3 py-3 text-sm hover:bg-accent"
              title="Camera scan"
            >
              📷 Camera
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            RF scanners type the code and press Enter automatically.
          </p>
        </label>
      </div>

      {active && (
        <div className="card-elevated space-y-4 border-2 border-primary/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Active item</div>
              <div className="text-lg font-semibold">{active.sku}</div>
              <div className="text-sm text-muted-foreground">
                {active.location ?? "—"} · {active.description ?? ""}
              </div>
            </div>
            <button
              onClick={() => setActive(null)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Expected" value={active.expected_qty} />
            <Stat label="Counted so far" value={active.counted_qty ?? 0} />
            <Stat label="UoM" value={active.uom ?? "—"} />
          </div>

          <div>
            <span className="text-sm font-medium">Quantity to add</span>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => setQty((q) => String(Math.max(0, Number(q) - 1)))}
                className="h-12 w-12 rounded-md border border-border text-xl"
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="h-12 flex-1 rounded-md border border-input bg-background px-3 text-center text-2xl font-semibold"
              />
              <button
                onClick={() => setQty((q) => String(Number(q) + 1))}
                className="h-12 w-12 rounded-md border border-border text-xl"
              >
                +
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 5, 10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  onClick={() => setQty(String(n))}
                  className="rounded-md border border-border px-3 py-1 text-sm hover:bg-accent"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={submit}
            className="w-full rounded-md bg-primary py-3 text-base font-semibold text-primary-foreground hover:opacity-90"
          >
            Accept count
          </button>
        </div>
      )}

      {recent.length > 0 && (() => {
        const oos = outOfSequenceIndices(recent.map((r) => ({ sku: r.sku })));
        return (
          <div className="card-elevated">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Recent</div>
              {oos.size > 0 && (
                <div className="text-xs text-warning">⚠ Out-of-sequence highlighted</div>
              )}
            </div>
            <ul className="mt-2 divide-y divide-border text-sm">
              {recent.map((r, i) => {
                const isOos = oos.has(i);
                return (
                  <li
                    key={i}
                    title={isOos ? "Scanned out of alpha-numeric sequence" : undefined}
                    className={
                      "flex justify-between py-2 px-2 rounded-sm " +
                      (isOos ? "bg-warning/20 text-warning-foreground" : "")
                    }
                  >
                    <span className="font-medium">
                      {isOos && <span aria-hidden className="mr-1">⚠</span>}
                      {r.sku}
                    </span>
                    <span className="text-muted-foreground">+{r.qty}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {scannerOpen && (
        <CameraScanner
          onScan={(text) => {
            setScannerOpen(false);
            lookup(text);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {unmatched && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
            <div className="text-xs uppercase text-muted-foreground">Unrecognized scan</div>
            <div className="mt-1 font-mono text-lg font-semibold">{unmatched}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Link this barcode to an existing SKU (the app will remember it for future cycles), or
              add it as an unexpected item.
            </p>
            <div className="mt-4">
              <label className="block text-sm font-medium">Find SKU in this cycle</label>
              <input
                autoFocus
                value={linkQuery}
                onChange={(e) => searchItems(e.target.value)}
                placeholder="Type SKU or description…"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {linkResults.length > 0 && (
                <ul className="mt-2 max-h-60 divide-y divide-border overflow-auto rounded-md border border-border">
                  {linkResults.map((r) => (
                    <li key={r.id}>
                      <button
                        onClick={() => linkBarcodeToItem(r)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span>
                          <span className="font-medium">{r.sku}</span>
                          <span className="ml-2 text-muted-foreground">{r.description ?? ""}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.location ?? ""} · exp {r.expected_qty}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setUnmatched(null)}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={addAsUnexpected}
                className="rounded-md border border-warning px-3 py-2 text-sm text-warning hover:bg-warning/10"
              >
                Add as unexpected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  async function pushEvent(ev: QueuedCount): Promise<boolean> {
    try {
      // Update item
      if (ev.item_id) {
        const { error: uErr } = await supabase
          .from("count_items")
          .update({
            counted_qty: ev.qty_after,
            counted_by: ev.user_id,
            counted_at: ev.created_at,
            status: "counted",
          })
          .eq("id", ev.item_id);
        if (uErr) throw uErr;
      }
      const { error: eErr } = await supabase.from("count_events").insert({
        client_event_id: ev.id,
        cycle_id: ev.cycle_id,
        item_id: ev.item_id,
        user_id: ev.user_id,
        action: ev.action,
        qty_before: ev.qty_before,
        qty_after: ev.qty_after,
        source: "web",
      });
      if (eErr) throw eErr;
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
