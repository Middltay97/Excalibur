import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { callMobile, useBadge } from "@/lib/mobile-api";

import { MobileHeader, MobileIconButton } from "@/components/mobile-header";
import { outOfSequenceIndices, canonicalizeSku } from "@/lib/sku-sequence";
import { recoverFromChunkLoadError } from "@/lib/chunk-recovery";

export const Route = createFileRoute("/m/count/$id")({
  component: CountScreen,
  errorComponent: CountError,
});

function CountError({ error, reset }: { error: Error; reset: () => void }) {
  if (recoverFromChunkLoadError(error)) return null;
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-foreground">Count session couldn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground break-words">{error.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a
            href="/m/sessions"
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground"
          >
            Back to sessions
          </a>
        </div>
      </div>
    </div>
  );
}

interface LogEntry {
  id: string;
  location: string | null;
  sku: string | null;
  barcode: string | null;
  qty: number;
  at: string;
}

interface ScannedItem {
  id: string;
  sku: string | null;
  barcode: string | null;
  location: string | null;
  counted_qty: number;
  is_unexpected: boolean;
}

function CountScreen() {
  const { id: cycleId } = useParams({ from: "/m/count/$id" });
  const navigate = useNavigate();
  const badge = useBadge();

  const [scan, setScan] = useState("");
  const [qty, setQty] = useState("");
  const [pending, setPending] = useState<ScannedItem | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [cycleName, setCycleName] = useState("");
  const [countStartedAt, setCountStartedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [multiQty, setMultiQty] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("countright.mobile.multiQty") === "1";
  });
  // In multi-qty mode, after a SKU is scanned we hold it here and wait
  // for the user to type a quantity and press Enter.
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSku, setManualSku] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const manualSkuRef = useRef<HTMLInputElement>(null);

  const submitManual = useCallback(() => {
    const code = manualSku.trim();
    if (!code) {
      toast.error("Enter a SKU or barcode");
      return;
    }
    const n = parseInt(manualQty, 10);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a quantity greater than 0");
      return;
    }
    commitScan(code, n);
    setManualSku("");
    setManualQty("1");
    setTimeout(() => manualSkuRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSku, manualQty]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("countright.mobile.multiQty", multiQty ? "1" : "0");
    }
  }, [multiQty]);

  useEffect(() => {
    if (badge === undefined) return; // not yet hydrated
    if (!badge) {
      navigate({ to: "/m" });
      return;
    }

    let cancelled = false;
    let hbTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        await callMobile("enter", { badge, cycle_id: cycleId });
      } catch (e) {
        toast.error((e as Error).message);
        navigate({ to: "/m/sessions" });
        return;
      }
      if (cancelled) return;
      try {
        const d = await callMobile<{ cycle: { name: string; count_started_at?: string | null }; log: LogEntry[] }>(
          "items",
          { badge, cycle_id: cycleId },
        );
        if (cancelled) return;
        setCycleName(d.cycle?.name ?? "");
        setCountStartedAt(d.cycle?.count_started_at ?? null);
        setLog(d.log);
      } catch (e) {
        toast.error((e as Error).message);
      }
      hbTimer = setInterval(() => {
        callMobile("heartbeat", { badge, cycle_id: cycleId }).catch((e) => {
          toast.error((e as Error).message);
          navigate({ to: "/m/sessions" });
        });
      }, 60_000);
    })();

    const releaseOnUnload = () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mobile-counter`;
        const blob = new Blob(
          [JSON.stringify({ action: "exit", badge, cycle_id: cycleId })],
          { type: "application/json" },
        );
        navigator.sendBeacon?.(url, blob);
      } catch {
        // best-effort
      }
    };
    window.addEventListener("beforeunload", releaseOnUnload);

    return () => {
      cancelled = true;
      if (hbTimer) clearInterval(hbTimer);
      window.removeEventListener("beforeunload", releaseOnUnload);
      callMobile("exit", { badge, cycle_id: cycleId }).catch(() => {});
    };
  }, [badge, cycleId, navigate]);

  // Fire-and-forget: optimistically update the log immediately, then reconcile
  // with the server response. This keeps the input ready for the next scan
  // without waiting on the network round-trip.
  const commitScan = useCallback(
    (code: string, q: number) => {
      if (!badge) return;
      // Haptic feedback on scan commit (Chainway C6000 / Android Chrome supports navigator.vibrate)
      try {
        navigator.vibrate?.(60);
      } catch {
        // ignore — unsupported browsers
      }
      const optimisticId = crypto.randomUUID();
      // Track whether the optimistic qty was merged into an existing row
      // (vs. inserted as a new row). Reconcile must not double-add in either case.
      let mergedIntoExisting = false;
      const codeKey = canonicalizeSku(code);
      // Optimistic insert/merge by canonical SKU so variants (hyphens, spaces,
      // trailing barcode character) collapse into the same log row immediately.
      setLog((l) => {
        const idx = l.findIndex(
          (e) =>
            canonicalizeSku(e.sku) === codeKey ||
            canonicalizeSku(e.barcode) === codeKey,
        );
        if (idx >= 0) {
          mergedIntoExisting = true;
          const updated = { ...l[idx], qty: l[idx].qty + q, at: new Date().toISOString() };
          return [updated, ...l.slice(0, idx), ...l.slice(idx + 1)].slice(0, 30);
        }
        return [
          {
            id: optimisticId,
            location: null,
            sku: code,
            barcode: code,
            qty: q,
            at: new Date().toISOString(),
          },
          ...l,
        ].slice(0, 30);
      });

      void (async () => {
        try {
          const res = await callMobile<{ item: ScannedItem; added: number }>("scan", {
            badge,
            cycle_id: cycleId,
            code,
            qty: q,
            client_event_id: crypto.randomUUID(),
          });
          // Reconcile: replace optimistic row (or update canonical row metadata) using server data.
          // We must NOT add res.added on top of the optimistic qty — it's already counted.
          setLog((l) => {
            const serverSkuKey = canonicalizeSku(res.item.sku);
            const serverBarcodeKey = canonicalizeSku(res.item.barcode);
            const optimisticIdx = l.findIndex((e) => e.id === optimisticId);
            const canonicalIdx = l.findIndex(
              (e) =>
                e.id !== optimisticId &&
                ((serverSkuKey && canonicalizeSku(e.sku) === serverSkuKey) ||
                  (serverBarcodeKey && canonicalizeSku(e.barcode) === serverBarcodeKey)),
            );

            // Case A: optimistic was merged into an existing row up-front.
            // The canonical row already includes our qty — only refresh metadata.
            if (mergedIntoExisting && canonicalIdx >= 0) {
              const canonical = l[canonicalIdx];
              const refreshed = {
                ...canonical,
                location: res.item.location ?? canonical.location,
                sku: res.item.sku ?? canonical.sku,
                barcode: res.item.barcode ?? canonical.barcode,
              };
              const next = l.filter((_, i) => i !== canonicalIdx);
              return [refreshed, ...next].slice(0, 30);
            }

            // Case B: optimistic was a new row, but server shows it belongs to an
            // existing canonical row. Fold optimistic qty into canonical, drop optimistic.
            if (optimisticIdx >= 0 && canonicalIdx >= 0) {
              const canonical = l[canonicalIdx];
              const optimisticQty = l[optimisticIdx].qty;
              const merged = {
                ...canonical,
                location: res.item.location ?? canonical.location,
                sku: res.item.sku ?? canonical.sku,
                barcode: res.item.barcode ?? canonical.barcode,
                qty: canonical.qty + optimisticQty,
                at: new Date().toISOString(),
              };
              const next = l.filter((_, i) => i !== canonicalIdx && i !== optimisticIdx);
              return [merged, ...next].slice(0, 30);
            }

            // Case C: standalone optimistic row — replace its SKU/barcode with the
            // canonical master SKU so the log always shows the primary form.
            if (optimisticIdx >= 0) {
              const updated = {
                ...l[optimisticIdx],
                location: res.item.location,
                sku: res.item.sku,
                barcode: res.item.barcode,
              };
              return [updated, ...l.slice(0, optimisticIdx), ...l.slice(optimisticIdx + 1)].slice(0, 30);
            }
            return l;
          });
        } catch (e) {
          // Roll back the optimistic entry
          setLog((l) => {
            const idx = l.findIndex((x) => x.id === optimisticId);
            if (idx >= 0) {
              if (l[idx].qty <= q) return l.filter((x) => x.id !== optimisticId);
              return l.map((x) => (x.id === optimisticId ? { ...x, qty: x.qty - q } : x));
            }
            // Optimistic was merged into an existing row — decrement that row by canonical match
            return l.map((x) =>
              canonicalizeSku(x.sku) === codeKey || canonicalizeSku(x.barcode) === codeKey
                ? { ...x, qty: Math.max(0, x.qty - q) }
                : x,
            );
          });
          toast.error((e as Error).message);
        }
      })();
    },
    [badge, cycleId],
  );

  const handleScannedCode = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setScan("");
      setPending(null);

      if (multiQty) {
        // Hold the SKU and move focus to the Qty field so the user can type a quantity.
        setPendingCode(trimmed);
        setQty("");
        setTimeout(() => qtyRef.current?.focus(), 0);
        return;
      }

      setQty("");
      commitScan(trimmed, 1);
      // Keep focus on the SKU field for the next scan.
      setTimeout(() => scanRef.current?.focus(), 0);
    },
    [multiQty, commitScan],
  );

  const onScanEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleScannedCode(scan);
  };

  // Auto-commit fallback: if the scanner does not append an Enter suffix,
  // detect when the burst of input characters has settled and treat it as a
  // completed scan. Manual typing is also auto-committed — this screen is
  // dedicated to the RF scanner workflow.
  useEffect(() => {
    if (!scan) return;
    const code = scan;
    const t = setTimeout(() => {
      // Only fire if value is unchanged after the idle window.
      if (scanRef.current && scanRef.current.value === code) {
        handleScannedCode(code);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [scan, handleScannedCode]);

  const onQtyEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!multiQty || !pendingCode) {
      setTimeout(() => scanRef.current?.focus(), 0);
      return;
    }
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a quantity greater than 0");
      return;
    }
    commitScan(pendingCode, n);
    setPendingCode(null);
    setQty("");
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  // Active item display: show pending preview's location if we've resolved one;
  // otherwise show the last log entry's location.
  const bin = log[0]?.location ?? "";

  return (
    <div
      className="min-h-dvh bg-background pb-6"
      onClick={(e) => {
        // Keep the hidden SKU capture focused so wedge keystrokes always land,
        // unless the user is interacting with the Qty field, manual entry, or the toggle.
        if (manualOpen) return;
        const target = e.target as HTMLElement;
        if (target.closest("input, button, label, a, [role=button]")) return;
        scanRef.current?.focus();
      }}
    >
      <MobileHeader
        title={cycleName || "Count"}
        subtitle={countStartedAt ? `Started ${new Date(countStartedAt).toLocaleString()}` : undefined}
        left={
          <MobileIconButton onClick={() => navigate({ to: "/m/sessions" })} ariaLabel="Back to sessions">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </MobileIconButton>
        }
        right={
          <MobileIconButton
            onClick={async () => {
              if (!badge) return;
              if (!confirm("Send this count to verification? You will be returned to your sessions list.")) return;
              setBusy(true);
              try {
                await callMobile("transmit_count", { badge, cycle_id: cycleId });
                toast.success("Count transmitted to verification");
                navigate({ to: "/m/sessions" });
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            ariaLabel="Transmit count to verification"
            title="Transmit to verification"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
            </svg>
          </MobileIconButton>
        }
      />
      {busy && <div className="px-4 pt-2 text-xs text-muted-foreground">Transmitting…</div>}

      <div className="px-4 pt-4 space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
          <span className="text-sm font-semibold">
            Multi-qty scan
            <span className="ml-2 font-normal text-muted-foreground">
              {multiQty ? "Scan SKU, type qty, Enter" : "1 per scan"}
            </span>
          </span>
          <input
            type="checkbox"
            checked={multiQty}
            onChange={(e) => {
              setMultiQty(e.target.checked);
              setPendingCode(null);
              setQty("");
              setTimeout(() => scanRef.current?.focus(), 0);
            }}
            className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-input transition-colors checked:bg-primary"
          />
        </label>

        <div className="rounded-md border border-border bg-muted/30">
          <button
            type="button"
            onClick={() => {
              const next = !manualOpen;
              setManualOpen(next);
              if (next) {
                setTimeout(() => manualSkuRef.current?.focus(), 0);
              } else {
                setTimeout(() => scanRef.current?.focus(), 0);
              }
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
          >
            <span>
              ⌨️ Manual entry
              <span className="ml-2 font-normal text-muted-foreground">
                {manualOpen ? "type SKU when barcode won't scan" : "tap to enter SKU by hand"}
              </span>
            </span>
            <span className="text-muted-foreground">{manualOpen ? "▲" : "▼"}</span>
          </button>
          {manualOpen && (
            <div className="space-y-2 border-t border-border px-3 py-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground">SKU / Barcode</label>
                <input
                  ref={manualSkuRef}
                  value={manualSku}
                  onChange={(e) => setManualSku(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitManual();
                    }
                  }}
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="Type SKU or barcode"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-3 text-base font-mono"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-muted-foreground">Qty</label>
                  <input
                    value={manualQty}
                    onChange={(e) => setManualQty(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitManual();
                      }
                    }}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-3 text-base"
                  />
                </div>
                <button
                  type="button"
                  onClick={submitManual}
                  className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
                >
                  Add count
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this when a label is damaged or the scanner can't read the barcode.
              </p>
            </div>
          )}
        </div>


        <div>
          <label className="block text-sm font-semibold">Bin</label>
          <input
            value={bin}
            readOnly
            tabIndex={-1}
            className="mt-1 w-full rounded-md border border-input bg-muted/40 px-3 py-3 text-base"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Item SKU/UPC</label>
          <div
            aria-live="polite"
            className="mt-1 w-full rounded-md border border-input bg-muted/40 px-3 py-3 text-base min-h-[2.75rem] font-mono break-all"
            onClick={() => scanRef.current?.focus()}
          >
            {scan ? (
              <span>{scan}</span>
            ) : multiQty && pendingCode ? (
              <span className="text-muted-foreground">Held: {pendingCode} — enter qty below</span>
            ) : pending ? (
              <span className="text-muted-foreground">Pending: {pending.barcode} (qty 1 if next scan)</span>
            ) : (
              <span className="text-muted-foreground">Scan…</span>
            )}
          </div>
          {/* Hidden capture input — receives wedge keystrokes without showing the soft keyboard.
              Kept focusable (no display:none) so the scanner driver can deliver keys. */}
          <input
            ref={scanRef}
            autoFocus
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={onScanEnter}
            onBlur={() => {
              // Re-acquire focus on next tick so wedge keystrokes don't drop,
              // unless the user has moved into the qty or manual entry fields.
              setTimeout(() => {
                const ae = document.activeElement;
                if (ae === qtyRef.current || ae === manualSkuRef.current) return;
                if (manualOpen && ae instanceof HTMLInputElement) return;
                scanRef.current?.focus();
              }, 0);
            }}
            type="search"
            name="cr-scan-capture"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: "absolute",
              opacity: 0,
              height: 1,
              width: 1,
              pointerEvents: "none",
              left: -9999,
              top: "auto",
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold">Qty</label>
          <input
            ref={qtyRef}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={onQtyEnter}
            type="search"
            name="cr-qty"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            readOnly={!multiQty}
            className="mt-1 w-full rounded-md border border-input bg-muted/40 px-3 py-3 text-base disabled:opacity-60"
            placeholder={
              multiQty
                ? pendingCode
                  ? "Type quantity, press Enter"
                  : "Scan a SKU first"
                : pending
                ? "Press Enter to commit (default 1)"
                : "—"
            }
          />
        </div>
      </div>

      <div className="mt-5 px-4">
        <div className="flex items-baseline justify-between gap-6 px-1 pb-1 text-xs font-semibold text-muted-foreground">
          <span>Bin</span>
          <span className="flex-1 pl-4">SKU/UPC</span>
          <span>Qty</span>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-2 font-mono text-sm">
          {log.length === 0 ? (
            <div className="px-2 py-3 text-center text-muted-foreground">No scans yet.</div>
          ) : (
            (() => {
              const oos = outOfSequenceIndices(log);
              return (
                <ul className="divide-y divide-border/60">
                  {log.map((e, i) => {
                    const isOos = oos.has(i);
                    return (
                      <li
                        key={e.id}
                        title={isOos ? "Scanned out of alpha-numeric sequence" : undefined}
                        className={
                          "flex items-baseline justify-between gap-3 py-1 px-1 rounded-sm " +
                          (isOos ? "bg-warning/20 text-warning-foreground" : "")
                        }
                      >
                        <span className="w-12 shrink-0 text-muted-foreground">{e.location ?? "—"}</span>
                        <span className="flex-1 truncate">
                          {isOos && <span aria-hidden className="mr-1">⚠</span>}
                          {e.sku ?? e.barcode ?? "—"}
                        </span>
                        <span className="w-8 text-right">{e.qty}</span>
                      </li>
                    );
                  })}
                </ul>
              );
            })()
          )}
        </div>
      </div>
    </div>
  );
}
