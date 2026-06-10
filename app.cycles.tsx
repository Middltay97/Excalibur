import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/auth-context";
import {
  parseBaselineFile,
  autoMap,
  mapRows,
  TARGET_COLUMNS,
  type ParsedBaseline,
  type TargetKey,
} from "@/lib/baseline-parser";
import { distributeCyclesByAllocation } from "@/lib/cycle-allocation";


export const Route = createFileRoute("/app/cycles/new")({
  component: NewCycle,
});

type Mode = "upload" | "bin";

interface MasterRow {
  sku: string;
  barcode: string | null;
  location: string | null;
  location2: string | null;
  description: string | null;
  uom: string | null;
  on_hand_qty: number | null;
  unit_cost: number | null;
}

interface BinGroup {
  bin: string;
  rows: MasterRow[];
}

// Strip zero-width / BOM / non-breaking space and fold Unicode dashes to "-".
function cleanBinInput(s: string): string {
  return s
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .trim();
}

function rangeFromEndpoints(start: string, end: string): string[] | null {
  // Find the longest common prefix; the differing tails are the range bounds.
  const a = start.toUpperCase();
  const b = end.toUpperCase();
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  const prefix = a.slice(0, i);
  const s = a.slice(i);
  const e = b.slice(i);
  if (!s || !e) return null;

  if (/^\d+$/.test(s) && /^\d+$/.test(e)) {
    const ai = parseInt(s, 10), bi = parseInt(e, 10);
    if (ai <= bi && bi - ai < 500) {
      const pad = Math.max(s.length, e.length);
      const out: string[] = [];
      for (let n = ai; n <= bi; n++) out.push(prefix + String(n).padStart(pad, "0"));
      return out;
    }
  }
  if (/^[A-Z]$/.test(s) && /^[A-Z]$/.test(e)) {
    const ac = s.charCodeAt(0), bc = e.charCodeAt(0);
    if (ac <= bc) {
      const out: string[] = [];
      for (let c = ac; c <= bc; c++) out.push(prefix + String.fromCharCode(c));
      return out;
    }
  }
  return null;
}

function expandBinToken(token: string): string[] {
  const t = cleanBinInput(token);
  if (!t) return [];
  // Wildcards (e.g. "A-12-%") must be passed through untouched.
  if (t.includes("%") || t.includes("_")) return [t];

  // Try splitting on the LAST hyphen so "265A-265O" and "A-12-03-A-12-10"
  // both work. If the right side starts with a prefix that overlaps the
  // left side (e.g. "265O"), rangeFromEndpoints strips the common prefix.
  const lastDash = t.lastIndexOf("-");
  if (lastDash > 0 && lastDash < t.length - 1) {
    const left = t.slice(0, lastDash).trim();
    const right = t.slice(lastDash + 1).trim();
    // Case 1: right side repeats the left's prefix (e.g. "265A-265O").
    const r1 = rangeFromEndpoints(left, right);
    if (r1) return r1;
    // Case 2: right side is only the differing tail (e.g. "265A-O").
    // Reconstruct an implied left-prefix for the right endpoint.
    const m = left.match(/^(.*?)([A-Za-z]+|\d+)$/);
    if (m && /^([A-Za-z]+|\d+)$/.test(right)) {
      const r2 = rangeFromEndpoints(left, m[1] + right);
      if (r2) return r2;
    }
  }
  return [t];
}

function expandBins(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of cleanBinInput(input).split(/[,\n]+/)) {
    for (const b of expandBinToken(tok)) {
      const key = b.toUpperCase();
      if (!seen.has(key)) { seen.add(key); out.push(b); }
    }
  }
  return out;
}

function NewCycle() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const [mode, setMode] = useState<Mode>("upload");
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [parsedFiles, setParsedFiles] = useState<ParsedBaseline[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetKey, string>>>({});
  const [busy, setBusy] = useState(false);

  // Bin mode state
  const [binInput, setBinInput] = useState("");
  const [binGroups, setBinGroups] = useState<BinGroup[] | null>(null);
  const [binLoading, setBinLoading] = useState(false);

  if (!isAdmin) {
    return (
      <div className="card-elevated">
        <h2 className="text-xl font-semibold">Admins only</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You need an admin role to create new cycle counts.
        </p>
        <Link to="/app/cycles" className="mt-4 inline-block text-primary hover:underline">
          ← Back to cycles
        </Link>
      </div>
    );
  }

  const onFiles = async (files: FileList) => {
    const out: ParsedBaseline[] = [];
    for (const file of Array.from(files)) {
      try {
        out.push(await parseBaselineFile(file));
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (out.length === 0) return;
    const hadNone = parsedFiles.length === 0;
    setParsedFiles((prev) => [...prev, ...out]);
    if (hadNone) {
      setMapping(autoMap(out[0].headers));
      if (!name && out.length === 1) {
        setName(out[0].filename.replace(/\.[^.]+$/, ""));
      }
    }
  };

  const removeFile = (idx: number) =>
    setParsedFiles((prev) => prev.filter((_, i) => i !== idx));

  const parsed = parsedFiles[0] ?? null;
  const preview = parsed ? mapRows(parsed.rows.slice(0, 5), mapping) : [];
  const fileCounts = parsedFiles.map((p) => mapRows(p.rows, mapping).length);
  const totalMapped = fileCounts.reduce((a, b) => a + b, 0);
  const missingRequired = TARGET_COLUMNS.filter((t) => t.required && !mapping[t.key]);

  const submitUpload = async () => {
    if (parsedFiles.length === 0 || !user) return;
    if (missingRequired.length) {
      toast.error(`Map required columns: ${missingRequired.map((m) => m.label).join(", ")}`);
      return;
    }
    setBusy(true);

    const singleFile = parsedFiles.length === 1;
    const createdIds: string[] = [];

    for (let fi = 0; fi < parsedFiles.length; fi++) {
      const pf = parsedFiles[fi];
      const items = mapRows(pf.rows, mapping);
      if (items.length === 0) {
        toast.error(`${pf.filename}: no valid rows after mapping — skipped.`);
        continue;
      }

      const cycleName = singleFile && name.trim()
        ? name.trim()
        : pf.filename.replace(/\.[^.]+$/, "");

      const { data: cycle, error: cErr } = await supabase
        .from("cycle_counts")
        .insert({
          name: cycleName,
          created_by: user.id,
          baseline_source: "upload",
          baseline_filename: pf.filename,
          due_date: dueDate || null,
          status: "draft",
        })
        .select()
        .single();

      if (cErr || !cycle) {
        setBusy(false);
        toast.error(`${pf.filename}: ${cErr?.message ?? "failed to create cycle"}`);
        return;
      }

      const chunk = 500;
      for (let i = 0; i < items.length; i += chunk) {
        const slice = items.slice(i, i + chunk).map(({ on_hand_qty: _omit, ...r }) => ({
          ...r,
          cycle_id: cycle.id,
        }));
        const { error } = await supabase.from("count_items").insert(slice);
        if (error) {
          setBusy(false);
          toast.error(`${pf.filename}: item insert failed — ${error.message}`);
          return;
        }
      }
      createdIds.push(cycle.id);
    }

    if (createdIds.length === 0) {
      setBusy(false);
      return;
    }

    let assignedCount = 0;
    try {
      assignedCount = await distributeCyclesByAllocation(createdIds);
    } catch (e) {
      toast.error(`Cycles created, but auto-assignment failed: ${(e as Error).message}`);
    }

    toast.success(
      createdIds.length === 1
        ? `Cycle created with ${fileCounts[0]} items.${assignedCount ? " Auto-assigned." : ""}`
        : `Created ${createdIds.length} cycles from ${parsedFiles.length} files.${assignedCount ? ` Auto-assigned ${assignedCount}.` : ""}`,
    );
    if (createdIds.length === 1) {
      router.navigate({ to: "/app/cycles/$id", params: { id: createdIds[0] } });
    } else {
      router.navigate({ to: "/app/cycles" });
    }

  };

  const fetchAllMasterRows = async (): Promise<MasterRow[]> => {
    const all: MasterRow[] = [];
    const pageSize = 1000;
    let from = 0;
    for (let i = 0; i < 1000; i++) {
      const { data, error } = await supabase
        .from("sku_master")
        .select("sku,barcode,location,location2,description,uom,on_hand_qty,unit_cost")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as MasterRow[];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const searchAllLocations = async () => {
    if (
      !confirm(
        "This will create one cycle count per distinct location in the SKU master. " +
          "This can be a large number of cycles. Continue?",
      )
    )
      return;
    setBinLoading(true);
    try {
      const rows = await fetchAllMasterRows();
      const byLoc = new Map<string, MasterRow[]>();
      for (const r of rows) {
        const locs = [r.location, r.location2]
          .map((l) => (l ?? "").trim())
          .filter(Boolean);
        for (const loc of locs) {
          const key = loc.toUpperCase();
          if (!byLoc.has(key)) byLoc.set(key, []);
          byLoc.get(key)!.push(r);
        }
      }
      const groups: BinGroup[] = Array.from(byLoc.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bin, rs]) => ({
          bin,
          rows: rs.sort((a, b) => a.sku.localeCompare(b.sku)),
        }));
      setBinGroups(groups);
      if (!name) setName("All locations");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBinLoading(false);
    }
  };

  const searchBin = async () => {
    const raw = binInput.trim();
    if (!raw) {
      toast.error("Enter a bin/location.");
      return;
    }
    if (raw.toUpperCase() === "ALL") {
      await searchAllLocations();
      return;
    }
    const bins = expandBins(raw);
    if (bins.length === 0) {
      toast.error("No valid bins parsed.");
      return;
    }
    setBinLoading(true);
    const groups: BinGroup[] = [];
    for (const b of bins) {
      const { data, error } = await supabase
        .from("sku_master")
        .select("sku,barcode,location,location2,description,uom,on_hand_qty,unit_cost")
        .or(`location.ilike.${b},location2.ilike.${b}`)
        .order("sku", { ascending: true })
        .limit(5000);
      if (error) {
        setBinLoading(false);
        toast.error(`${b}: ${error.message}`);
        return;
      }
      groups.push({ bin: b, rows: (data ?? []) as MasterRow[] });
    }
    setBinLoading(false);
    setBinGroups(groups);
    if (!name && bins.length === 1) setName(`Bin ${bins[0]}`);
  };


  const submitBin = async () => {
    if (!user || !binGroups) return;
    const nonEmpty = binGroups.filter((g) => g.rows.length > 0);
    if (nonEmpty.length === 0) return;
    setBusy(true);

    const createdIds: string[] = [];
    for (const g of nonEmpty) {
      const cycleName =
        nonEmpty.length === 1 && name.trim()
          ? name.trim()
          : `Bin ${g.bin}`;
      const { data: cycle, error: cErr } = await supabase
        .from("cycle_counts")
        .insert({
          name: cycleName,
          created_by: user.id,
          baseline_source: "bin",
          baseline_filename: `Bin: ${g.bin}`,
          due_date: dueDate || null,
          status: "draft",
        })
        .select()
        .single();

      if (cErr || !cycle) {
        setBusy(false);
        toast.error(cErr?.message ?? `Failed to create cycle for ${g.bin}`);
        return;
      }

      const items = g.rows.map((m) => ({
        cycle_id: cycle.id,
        sku: m.sku,
        barcode: m.barcode,
        location: m.location,
        location2: m.location2,
        description: m.description,
        uom: m.uom,
        expected_qty: Number(m.on_hand_qty ?? 0) || 0,
        unit_cost: m.unit_cost,
      }));

      const chunk = 500;
      for (let i = 0; i < items.length; i += chunk) {
        const slice = items.slice(i, i + chunk);
        const { error } = await supabase.from("count_items").insert(slice);
        if (error) {
          setBusy(false);
          toast.error(`Item insert failed for ${g.bin}: ${error.message}`);
          return;
        }
      }
      createdIds.push(cycle.id);
    }

    let assignedCount = 0;
    try {
      assignedCount = await distributeCyclesByAllocation(createdIds);
    } catch (e) {
      toast.error(`Cycles created, but auto-assignment failed: ${(e as Error).message}`);
    }

    toast.success(
      createdIds.length === 1
        ? `Cycle created with ${nonEmpty[0].rows.length} SKUs from ${nonEmpty[0].bin}.${assignedCount ? " Auto-assigned." : ""}`
        : `Created ${createdIds.length} cycles.${assignedCount ? ` Auto-assigned ${assignedCount}.` : ""}`,
    );
    if (createdIds.length === 1) {
      router.navigate({ to: "/app/cycles/$id", params: { id: createdIds[0] } });
    } else {
      router.navigate({ to: "/app/cycles" });
    }

  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">New cycle count</h2>
        <p className="text-sm text-muted-foreground">
          Upload a baseline file, or generate a count from a bin in the SKU master.
        </p>
      </div>

      <div className="card-elevated space-y-4">
        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => setMode("upload")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === "upload"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Upload file
          </button>
          <button
            onClick={() => setMode("bin")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === "bin"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            From bin location
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Cycle name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === "bin" ? "Bin A-12-03" : "Q2 East warehouse"}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Due date (optional)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>

        {mode === "upload" ? (
          <div className="space-y-3">
            <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
              <input
                id="file"
                type="file"
                multiple
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <label htmlFor="file" className="cursor-pointer">
                <div className="text-3xl">📥</div>
                <div className="mt-2 text-sm font-medium">
                  {parsedFiles.length === 0
                    ? "Click to choose one or more CSV / XLSX files"
                    : `Add more files (${parsedFiles.length} loaded)`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {parsedFiles.length === 0
                    ? "Each file becomes its own cycle count. Cycle name = file name."
                    : "Click to add additional files"}
                </div>
              </label>
            </div>

            {parsedFiles.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="px-3 py-2">File</th>
                      <th className="px-3 py-2">Rows</th>
                      <th className="px-3 py-2">Valid after mapping</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedFiles.map((pf, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{pf.filename}</td>
                        <td className="px-3 py-2">{pf.rows.length}</td>
                        <td className="px-3 py-2">
                          {fileCounts[i] === 0 ? (
                            <span className="text-destructive">0 — will skip</span>
                          ) : (
                            fileCounts[i]
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeFile(i)}
                            className="text-muted-foreground hover:text-destructive"
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
            {parsedFiles.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Multiple files detected — each will create its own cycle count using the
                file name. The cycle name field above is ignored.
              </p>
            )}
          </div>

        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Bin / location</span>
              <p className="text-xs text-muted-foreground">
                Pulls every SKU assigned to a bin in the SKU master. Use % as a wildcard
                (e.g. <code>A-12-%</code>). Enter a range like <code>265A-265G</code> or
                a comma-separated list to create one cycle per bin. Type <code>ALL</code>{" "}
                (or click the button) to create one cycle for every location in the SKU master.
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  value={binInput}
                  onChange={(e) => setBinInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchBin()}
                  placeholder="265A-265G  or  A-12-03, A-12-04  or  ALL"
                  className="min-w-[200px] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <button
                  onClick={searchBin}
                  disabled={binLoading || !binInput.trim()}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {binLoading ? "Searching…" : "Search master"}
                </button>
                <button
                  onClick={searchAllLocations}
                  disabled={binLoading}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                  title="Create one cycle for every distinct location in the SKU master"
                >
                  All locations
                </button>
              </div>
            </label>


            {binGroups && (() => {
              const nonEmpty = binGroups.filter((g) => g.rows.length > 0);
              const totalSkus = nonEmpty.reduce((s, g) => s + g.rows.length, 0);
              return (
                <div>
                  <h4 className="text-sm font-semibold">
                    {nonEmpty.length === 0
                      ? `No SKUs found in ${binGroups.length} bin${binGroups.length === 1 ? "" : "s"}`
                      : `${nonEmpty.length} bin${nonEmpty.length === 1 ? "" : "s"} with SKUs · ${totalSkus} total`}
                  </h4>
                  <div className="mt-2 overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="px-3 py-2">Bin</th>
                          <th className="px-3 py-2">SKUs found</th>
                          <th className="px-3 py-2">Sample SKUs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {binGroups.map((g) => (
                          <tr key={g.bin} className="border-t border-border">
                            <td className="px-3 py-2 font-medium">{g.bin}</td>
                            <td className="px-3 py-2">
                              {g.rows.length === 0 ? (
                                <span className="text-muted-foreground">none — skipped</span>
                              ) : (
                                g.rows.length
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {g.rows.slice(0, 3).map((r) => r.sku).join(", ")}
                              {g.rows.length > 3 ? ", …" : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {nonEmpty.length > 1 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Each bin will create its own cycle count. The cycle name field is
                      ignored when more than one bin has results.
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center justify-end gap-3">
              <Link to="/app/cycles" className="text-sm text-muted-foreground hover:underline">
                Cancel
              </Link>
              <button
                disabled={busy || !binGroups || binGroups.every((g) => g.rows.length === 0)}
                onClick={submitBin}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {(() => {
                  if (busy) return "Creating…";
                  if (!binGroups) return "Create cycle";
                  const nonEmpty = binGroups.filter((g) => g.rows.length > 0);
                  if (nonEmpty.length === 0) return "Create cycle";
                  if (nonEmpty.length === 1)
                    return `Create cycle with ${nonEmpty[0].rows.length} SKUs`;
                  return `Create ${nonEmpty.length} cycles`;
                })()}
              </button>
            </div>
          </div>
        )}
      </div>

      {mode === "upload" && parsed && (
        <div className="card-elevated space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Map columns</h3>
            <p className="text-sm text-muted-foreground">
              Match each system field to a column in your file.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {TARGET_COLUMNS.map((t) => (
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

          <div>
            <h4 className="text-sm font-semibold">
              Preview of {parsed.filename} ({totalMapped} valid rows across {parsedFiles.length} file{parsedFiles.length === 1 ? "" : "s"})
            </h4>
            <div className="mt-2 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    {TARGET_COLUMNS.map((t) => (
                      <th key={t.key} className="px-3 py-2">{t.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">{r.sku}</td>
                      <td className="px-3 py-2">{r.barcode ?? "—"}</td>
                      <td className="px-3 py-2">{r.location ?? "—"}</td>
                      <td className="px-3 py-2">{r.location2 ?? "—"}</td>
                      <td className="px-3 py-2">{r.description ?? "—"}</td>
                      <td className="px-3 py-2">{r.expected_qty}</td>
                      <td className="px-3 py-2">{r.uom ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link to="/app/cycles" className="text-sm text-muted-foreground hover:underline">
              Cancel
            </Link>
            <button
              disabled={busy || missingRequired.length > 0 || totalMapped === 0}
              onClick={submitUpload}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Creating…"
                : parsedFiles.length > 1
                  ? `Create ${parsedFiles.length} cycles · ${totalMapped} items total`
                  : `Create cycle with ${totalMapped} items`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
