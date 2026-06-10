import Papa from "papaparse";
import * as XLSX from "xlsx";
import { normalizeSku, normalizeBin } from "@/lib/sku-normalize";


export type BaselineRow = Record<string, string | number | null | undefined>;

export interface ParsedBaseline {
  headers: string[];
  rows: BaselineRow[];
  filename: string;
}

export const TARGET_COLUMNS = [
  { key: "sku", label: "SKU", required: true },
  { key: "barcode", label: "Barcode", required: false },
  { key: "location", label: "Location", required: false },
  { key: "location2", label: "Location 2", required: false },
  { key: "description", label: "Description", required: false },
  { key: "expected_qty", label: "Expected Qty", required: true },
  { key: "on_hand_qty", label: "On Hand Qty", required: false },
  { key: "uom", label: "UoM", required: false },
  { key: "unit_cost", label: "Unit Cost", required: false },
] as const;

export type TargetKey = (typeof TARGET_COLUMNS)[number]["key"];

export async function parseBaselineFile(
  file: File,
  opts: { allSheets?: boolean } = {},
): Promise<ParsedBaseline> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv" || ext === "txt") {
    return new Promise((resolve, reject) => {
      Papa.parse<BaselineRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const headers = res.meta.fields ?? [];
          resolve({ headers, rows: res.data as BaselineRow[], filename: file.name });
        },
        error: reject,
      });
    });
  }
  if (ext === "xlsx" || ext === "xls") {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetNames = opts.allSheets ? wb.SheetNames : [wb.SheetNames[0]];
    const allRows: BaselineRow[] = [];
    const headerSet = new Set<string>();
    for (const name of sheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const json = XLSX.utils.sheet_to_json<BaselineRow>(ws, { defval: "" });
      for (const r of json) {
        Object.keys(r).forEach((k) => headerSet.add(k));
        allRows.push(opts.allSheets ? { __sheet: name, ...r } : r);
      }
    }
    if (opts.allSheets) headerSet.add("__sheet");
    return { headers: Array.from(headerSet), rows: allRows, filename: file.name };
  }
  throw new Error(`Unsupported file type: .${ext}`);
}

export function autoMap(headers: string[]): Partial<Record<TargetKey, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Partial<Record<TargetKey, string>> = {};
  const candidates: Record<TargetKey, string[]> = {
    sku: ["sku", "part", "partnumber", "item", "itemnumber", "itemcode"],
    barcode: ["barcode", "upc", "ean", "gtin", "scan"],
    location: ["location", "bin", "bin1", "loc", "slot", "location1"],
    location2: ["location2", "bin2", "loc2", "slot2", "area", "subarea", "zone"],
    description: ["description", "desc", "name", "productname"],
    expected_qty: ["expectedqty", "qty", "quantity", "expected"],
    on_hand_qty: ["onhandqty", "onhand", "oh", "currentqty", "stock", "stockqty"],
    uom: ["uom", "unit", "units", "measure"],
    unit_cost: ["unitcost", "cost", "price", "unitprice", "itemcost", "standardcost"],
  };
  for (const t of TARGET_COLUMNS) {
    const found = headers.find((h) => candidates[t.key].includes(norm(h)));
    if (found) map[t.key] = found;
  }
  return map;
}

export function mapRows(
  rows: BaselineRow[],
  mapping: Partial<Record<TargetKey, string>>,
) {
  return rows
    .map((r) => {
      const get = (k: TargetKey) => {
        const src = mapping[k];
        return src ? r[src] : undefined;
      };
      const sku = normalizeSku(get("sku"));
      const expectedRaw = get("expected_qty");
      const expected_qty = Number(expectedRaw ?? 0) || 0;
      const onHandRaw = get("on_hand_qty");
      const on_hand_qty =
        onHandRaw === undefined || onHandRaw === null || onHandRaw === ""
          ? null
          : Number(onHandRaw) || 0;
      const costRaw = get("unit_cost");
      const unit_cost =
        costRaw === undefined || costRaw === null || costRaw === ""
          ? null
          : Number(String(costRaw).replace(/[^0-9.\-]/g, "")) || 0;
      return {
        sku: sku || null,
        barcode: normalizeSku(get("barcode")) || null,
        location: normalizeBin(get("location")) || null,
        location2: normalizeBin(get("location2")) || null,
        description: String(get("description") ?? "").trim() || null,
        uom: String(get("uom") ?? "").trim() || null,
        expected_qty,
        on_hand_qty,
        unit_cost,
      };
    })
    .filter((r) => r.sku);
}

