import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import { parseBaselineFile, autoMap, type ParsedBaseline, type TargetKey } from "@/lib/baseline-parser";
import { normalizeSku, normalizeBin } from "@/lib/sku-normalize";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});



const MASTER_FIELDS: { key: TargetKey; label: string; required?: boolean }[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "barcode", label: "Barcode" },
  { key: "location", label: "Assigned Location/Bin" },
  { key: "description", label: "Description" },
  { key: "on_hand_qty", label: "On Hand Qty" },
  { key: "unit_cost", label: "Unit Cost ($)" },
];

function SettingsPage() {
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage the SKU master, email recipients, and warehouses.
        </p>
      </div>

      <MasterUploadCard
        isAdmin={isAdmin}
        tier="active"
        title="SKU master (active)"
        description="The canonical list of active SKUs. Used to flag unexpected SKUs and show the assigned bin/location when a SKU is counted elsewhere. Re-upload monthly to keep it fresh."
        statLabel="Active SKUs on file"
        inputId="master-file-active"
      />

      <MasterUploadCard
        isAdmin={isAdmin}
        tier="ancillary"
        title="Ancillary SKU master (old / non-moving)"
        description="Old or non-moving inventory still sitting in the warehouse. Searched in tandem with the active master during counts, so SKUs in this list won't be flagged as unexpected. Kept separate just for easier visual management."
        statLabel="Ancillary SKUs on file"
        inputId="master-file-ancillary"
      />

      <MasterUploadCard
        isAdmin={isAdmin}
        tier="tertiary"
        title="Tertiary SKU master (phased out / deleted / manual order)"
        description="Multi-sheet workbook covering phased-out items (dealer & automatic), deleted items, and manual-order items. All sheets are merged on upload. Treated as known SKUs during counts so they aren't flagged as unexpected."
        statLabel="Tertiary SKUs on file"
        inputId="master-file-tertiary"
        allSheets
      />


      <AllocationRulesCard isAdmin={isAdmin} />

      <div className="card-elevated">
        <h3 className="text-lg font-semibold">Coming soon</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Email recipients, warehouses, and scanner preferences will live here.
        </p>
      </div>
    </div>
  );
}


type MasterTier = "active" | "ancillary" | "tertiary";

function normalizeMasterKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00A0\r\n\t]/g, "-")
    .replace(/\.\d+$/, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

interface MasterUploadCardProps {
  isAdmin: boolean;
  tier: MasterTier;
  title: string;
  description: string;
  statLabel: string;
  inputId: string;
  allSheets?: boolean;
}

function MasterUploadCard({ isAdmin, tier, title, description, statLabel, inputId, allSheets }: MasterUploadCardProps) {
  const { user } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBaseline | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<TargetKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ackCollisions, setAckCollisions] = useState(false);

  const applyTierFilter = <T,>(q: T): T => {
    const qq = q as any;
    if (tier === "active") return qq.eq("is_ancillary", false).eq("is_tertiary", false);
    if (tier === "ancillary") return qq.eq("is_ancillary", true).eq("is_tertiary", false);
    return qq.eq("is_tertiary", true);
  };

  const loadStats = async () => {
    const { count: c } = await applyTierFilter(
      supabase.from("sku_master").select("sku", { count: "exact", head: true }),
    );
    setCount(c ?? 0);
    const { data } = await applyTierFilter(
      supabase.from("sku_master").select("updated_at"),
    )
      .order("updated_at", { ascending: false })
      .limit(1);
    setLastUpdated(data?.[0]?.updated_at ?? null);
  };

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  const onFile = async (file: File) => {
    try {
      const p = await parseBaselineFile(file, { allSheets: !!allSheets });
      setParsed(p);
      setMapping(autoMap(p.headers));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };


  const { normalized, collisions, skipped, totalMapped } = useMemo(() => {
    if (!parsed || !mapping.sku) {
      return { normalized: [] as any[], collisions: [] as { key: string; raws: string[] }[], skipped: 0, totalMapped: 0 };
    }
    const get = (r: Record<string, any>, k: TargetKey) => {
      const src = mapping[k];
      return src ? r[src] : undefined;
    };
    const seen = new Map<string, { raws: Set<string>; row: any }>();
    let skipped = 0;
    let mapped = 0;
    for (const r of parsed.rows) {
      const rawSku = String(get(r, "sku") ?? "").trim();
      if (!rawSku) {
        skipped++;
        continue;
      }
      mapped++;
      const sku = normalizeSku(rawSku);
      const key = normalizeMasterKey(rawSku);
      if (!key) {
        skipped++;
        continue;
      }
      const onHandRaw = get(r, "on_hand_qty");
      const on_hand_qty =
        onHandRaw === undefined || onHandRaw === null || onHandRaw === ""
          ? null
          : Number(onHandRaw) || 0;
      const costRaw = get(r, "unit_cost");
      const unit_cost =
        costRaw === undefined || costRaw === null || costRaw === ""
          ? null
          : Number(String(costRaw).replace(/[^0-9.\-]/g, "")) || 0;
      const row = {
        sku,
        master_key: key,
        barcode: normalizeSku(get(r, "barcode")) || null,
        location: normalizeBin(get(r, "location")) || null,
        description: String(get(r, "description") ?? "").trim() || null,
        uom: String(get(r, "uom") ?? "").trim() || null,
        on_hand_qty,
        unit_cost,
        is_ancillary: tier === "ancillary",
        is_tertiary: tier === "tertiary",
      };
      const existing = seen.get(key);
      if (existing) {
        existing.raws.add(rawSku);
        existing.row = row;
      } else {
        seen.set(key, { raws: new Set([rawSku]), row });
      }
    }
    const collisions: { key: string; raws: string[] }[] = [];
    const normalized: any[] = [];
    for (const [key, v] of seen) {
      normalized.push(v.row);
      if (v.raws.size > 1) collisions.push({ key, raws: Array.from(v.raws) });
    }
    return { normalized, collisions, skipped, totalMapped: mapped };
  }, [parsed, mapping, tier]);

  const submit = async () => {
    if (!parsed || !user) return;
    if (!mapping.sku) {
      toast.error("You must map the SKU column.");
      return;
    }
    if (collisions.length && !ackCollisions) {
      toast.error("Resolve duplicate SKUs (or check the acknowledge box) before uploading.");
      return;
    }
    setBusy(true);
    setProgress(0);

    const unique = normalized.map((r) => ({ ...r, updated_by: user.id }));

    const chunk = 500;
    for (let i = 0; i < unique.length; i += chunk) {
      const slice = unique.slice(i, i + chunk);
      const { error } = await supabase
        .from("sku_master")
        .upsert(slice, { onConflict: "master_key" });
      if (error) {
        setBusy(false);
        toast.error(`Upload failed: ${error.message}`);
        return;
      }
      setProgress(Math.min(unique.length, i + chunk));
    }

    const label = tier === "tertiary" ? "Tertiary" : tier === "ancillary" ? "Ancillary" : "Active";
    toast.success(`${label} SKU master updated with ${unique.length} SKUs.`);

    const { data: refreshed, error: refreshErr } = await supabase.rpc("refresh_open_cycle_expected_qty");
    if (refreshErr) {
      toast.error(`Couldn't refresh open cycle QOH: ${refreshErr.message}`);
    } else if (typeof refreshed === "number" && refreshed > 0) {
      toast.success(`Refreshed expected QOH on ${refreshed} item${refreshed === 1 ? "" : "s"} across open cycles.`);
    }

    setBusy(false);
    setParsed(null);
    setMapping({});
    setAckCollisions(false);
    loadStats();
  };

  return (
    <div className="card-elevated space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-2xl font-semibold">{count ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{statLabel}</div>
          {lastUpdated && (
            <div className="mt-1 text-xs text-muted-foreground">
              Last update {new Date(lastUpdated).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {!isAdmin ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Only admins can upload or replace the SKU master.
        </p>
      ) : (
        <>
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
            <input
              id={inputId}
              type="file"
              accept=".csv,.xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <label htmlFor={inputId} className="cursor-pointer">
              <div className="text-3xl">📥</div>
              <div className="mt-2 text-sm font-medium">
                {parsed ? `Loaded: ${parsed.filename}` : "Click to choose CSV / XLSX"}
              </div>
              <div className="text-xs text-muted-foreground">
                {parsed
                  ? `${parsed.rows.length} rows · ${parsed.headers.length} columns`
                  : "Existing SKUs are updated; new SKUs are added"}
              </div>
            </label>
          </div>

          {parsed && (
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">Map columns</h4>
                <p className="text-xs text-muted-foreground">
                  Match each master field to a column in your file.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {MASTER_FIELDS.map((t) => (
                  <label key={t.key} className="block">
                    <span className="text-sm font-medium">
                      {t.label} {t.required && <span className="text-destructive">*</span>}
                    </span>
                    <select
                      value={mapping[t.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [t.key]: e.target.value || undefined }))
                      }
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">— none —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              {mapping.sku && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <div className="font-medium text-foreground">Pre-upload check</div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-4">
                    <div>Rows in: <span className="text-foreground">{parsed.rows.length}</span></div>
                    <div>Mapped: <span className="text-foreground">{totalMapped}</span></div>
                    <div>Normalized: <span className="text-foreground">{normalized.length}</span></div>
                    <div>Skipped: <span className="text-foreground">{skipped}</span></div>
                  </div>
                </div>
              )}

              {collisions.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                  <div className="font-semibold text-destructive">
                    {collisions.length} duplicate SKU{collisions.length === 1 ? "" : "s"} after normalization
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Different raw values collapsed to the same canonical SKU (hidden chars / unicode dashes / case). Last-wins will be uploaded.
                  </div>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono">
                    {collisions.slice(0, 50).map((c) => (
                      <li key={c.key}>
                        <span className="font-semibold">{c.key}</span>
                        {" ← "}
                        {c.raws.map((r) => JSON.stringify(r)).join(", ")}
                      </li>
                    ))}
                    {collisions.length > 50 && <li>…and {collisions.length - 50} more</li>}
                  </ul>
                  <label className="mt-2 flex items-center gap-2 text-foreground">
                    <input
                      type="checkbox"
                      checked={ackCollisions}
                      onChange={(e) => setAckCollisions(e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    I acknowledge the duplicates and want to upload anyway.
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => {
                    setParsed(null);
                    setMapping({});
                    setAckCollisions(false);
                  }}
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
                <button
                  disabled={busy || !mapping.sku || normalized.length === 0 || (collisions.length > 0 && !ackCollisions)}
                  onClick={submit}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {busy
                    ? `Uploading ${progress} / ${normalized.length}…`
                    : `Upload ${normalized.length} SKUs`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  badge_id: string | null;
}

interface RuleRow {
  id: string;
  user_id: string;
  percentage: number;
}

function AllocationRulesCard({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const [newPct, setNewPct] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const [pr, rr] = await Promise.all([
      supabase.rpc("admin_list_profiles_with_badges"),
      supabase.from("count_allocation_rules").select("id, user_id, percentage"),
    ]);
    if (pr.error) toast.error(`Profiles: ${pr.error.message}`);
    if (rr.error) toast.error(`Allocation rules: ${rr.error.message}`);
    setProfiles((pr.data ?? []) as ProfileRow[]);
    setRules((rr.data ?? []).map((r) => ({ ...r, percentage: Number(r.percentage) })) as RuleRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const profileLabel = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return id.slice(0, 8);
    const bits = [p.badge_id, p.full_name].filter(Boolean);
    return bits.length ? bits.join(" — ") : id.slice(0, 8);
  };

  const totalPct = useMemo(
    () => rules.reduce((s, r) => s + (Number(r.percentage) || 0), 0),
    [rules],
  );

  const availableProfiles = useMemo(
    () => profiles.filter((p) => !rules.some((r) => r.user_id === p.id)),
    [profiles, rules],
  );

  const addRule = async () => {
    if (!user) return;
    const pct = Number(newPct);
    if (!newUserId || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("Pick a user and enter a percentage between 0 and 100.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("count_allocation_rules")
      .insert({ user_id: newUserId, percentage: pct, created_by: user.id });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewUserId("");
    setNewPct("");
    load();
  };

  const updatePct = async (id: string, pct: number) => {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error("Percentage must be between 0 and 100.");
      return;
    }
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, percentage: pct } : r)));
    const { error } = await supabase
      .from("count_allocation_rules")
      .update({ percentage: pct })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const deleteRule = async (id: string) => {
    setBusy(true);
    const { error } = await supabase.from("count_allocation_rules").delete().eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    load();
  };

  if (!isAdmin) return null;

  return (
    <div className="card-elevated space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Cycle count auto-assignment</h3>
          <p className="text-sm text-muted-foreground">
            Distribute new cycle counts (one per bin/location, or one per uploaded file)
            randomly between users by percentage. Allocations are applied automatically
            whenever cycles are created.
          </p>
        </div>
        <div className="text-right text-sm">
          <div className={`text-2xl font-semibold ${totalPct > 100 ? "text-destructive" : ""}`}>
            {totalPct.toFixed(0)}%
          </div>
          <div className="text-xs text-muted-foreground">Total allocated</div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {rules.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              No rules yet. New cycles will be created unassigned.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2 w-32">Percentage</th>
                    <th className="px-3 py-2 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{profileLabel(r.user_id)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={r.percentage}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v !== r.percentage) updatePct(r.id, v);
                            }}
                            className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => deleteRule(r.id)}
                          disabled={busy}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="block flex-1 min-w-[200px]">
              <span className="text-xs font-medium">Add user</span>
              <select
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— pick a user —</option>
                {availableProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.badge_id, p.full_name].filter(Boolean).join(" — ") || p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block w-28">
              <span className="text-xs font-medium">Percentage</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={newPct}
                onChange={(e) => setNewPct(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={addRule}
              disabled={busy || !newUserId || !newPct}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {totalPct > 100 && (
            <p className="text-xs text-destructive">
              Total exceeds 100%. Reduce some allocations — extras will be capped during distribution.
            </p>
          )}
          {totalPct > 0 && totalPct < 100 && (
            <p className="text-xs text-muted-foreground">
              Total is {totalPct.toFixed(0)}%. Cycles will be split proportionally between the listed users
              (the remaining {(100 - totalPct).toFixed(0)}% will be ignored — those cycles stay unassigned).
            </p>
          )}
        </>
      )}
    </div>
  );
}

