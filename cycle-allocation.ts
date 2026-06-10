import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { classify, type VarianceRow } from "./variance";
import { compareSkuLex } from "./sku-sequence";

export interface SummaryPdfInput {
  cycleName: string;
  cycleStatus: string;
  rows: (VarianceRow & {
    mislocated?: boolean | null;
    verified_at?: string | null;
    counted_by?: string | null;
    verified_by?: string | null;
  })[];
  costs: Map<string, number>;
  countStartedAt?: string | null;
  countEndedAt?: string | null;
  userNames?: Map<string, string>;
}

export function buildCountSummaryPdf(input: SummaryPdfInput): jsPDF {
  const { cycleName, cycleStatus, rows, costs, countStartedAt, countEndedAt, userNames } = input;

  const nameOf = (id?: string | null) => {
    if (!id) return null;
    return userNames?.get(id) ?? null;
  };
  const uniqueNames = (ids: (string | null | undefined)[]) => {
    const set = new Set<string>();
    for (const id of ids) {
      const n = nameOf(id);
      if (n) set.add(n);
    }
    return Array.from(set).sort();
  };
  const counters = uniqueNames(rows.map((r) => r.counted_by));
  const verifiers = uniqueNames(rows.map((r) => r.verified_by));
  const fmtTs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  // Same filters used in the print Count Summary route
  const filtered = rows
    .filter((i) => !(i.mislocated && i.verified_at && (i.counted_qty ?? 0) === 0))
    .filter(
      (i) =>
        i.is_unexpected ||
        Number(i.expected_qty ?? 0) > 0 ||
        (i.counted_qty != null && Number(i.counted_qty) > 0),
    )
    .map((i) => {
      const variance = (i.counted_qty ?? 0) - i.expected_qty;
      const status = classify(i);
      const unit = i.sku ? costs.get(i.sku) ?? 0 : 0;
      const newQty = i.counted_qty ?? i.expected_qty;
      return {
        ...i,
        variance,
        status,
        unit_cost: unit,
        variance_value: variance * unit,
        new_qty: newQty,
      };
    })
    .sort((a, b) => compareSkuLex(a.sku, b.sku));

  const totals = {
    match: 0,
    short: 0,
    over: 0,
    unexpected: 0,
    uncounted: 0,
    mislocated: 0,
    varianceValue: 0,
  };
  for (const r of filtered) {
    totals[r.status as keyof typeof totals]++;
    totals.varianceValue += r.variance_value;
  }

  const LABEL: Record<string, string> = {
    match: "Match",
    short: "Short",
    over: "Over",
    unexpected: "Unexpected",
    uncounted: "Uncounted",
    mislocated: "Mislocated",
  };

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 28;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("COUNT SUMMARY REPORT", margin, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Cycle: ${cycleName}  ·  Status: ${cycleStatus}  ·  Printed ${new Date().toLocaleString()}  ·  ${filtered.length} line items`,
    margin,
    56,
  );
  doc.text(
    `Count started: ${fmtTs(countStartedAt)}  ·  Count ended: ${fmtTs(countEndedAt)}`,
    margin,
    70,
  );
  doc.text(
    `Counted by: ${counters.length ? counters.join(", ") : "—"}`,
    margin,
    84,
  );
  doc.text(
    `Verified by: ${verifiers.length ? verifiers.join(", ") : "—"}`,
    margin,
    98,
  );
  // Header line
  doc.setLineWidth(1);
  doc.line(margin, 104, pageW - margin, 104);

  // Summary stats row
  const stats: [string, string][] = [
    ["Match", String(totals.match)],
    ["Short", String(totals.short)],
    ["Over", String(totals.over)],
    ["Unexpected", String(totals.unexpected)],
    ["Uncounted", String(totals.uncounted)],
    ["Variance $", `$${totals.varianceValue.toFixed(2)}`],
  ];
  autoTable(doc, {
    startY: 112,
    margin: { left: margin, right: margin },
    head: [stats.map(([l]) => l)],
    body: [stats.map(([, v]) => v)],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 3, halign: "center" },
    headStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: "bold" },
  });

  const afterStatsY = (doc as any).lastAutoTable.finalY + 8;

  // Data table
  autoTable(doc, {
    startY: afterStatsY,
    margin: { left: margin, right: margin },
    head: [
      [
        "Bin",
        "Part Number",
        "Description",
        "U/M",
        "O.H.",
        "Counted",
        "Var",
        "Status",
        "Unit $",
        "Var $",
        "New Qty",
      ],
    ],
    body: filtered.map((r) => [
      r.location ?? "—",
      r.sku ?? "—",
      r.description ?? "—",
      r.uom ?? "—",
      String(r.expected_qty),
      r.counted_qty != null ? String(r.counted_qty) : "—",
      r.variance > 0 ? `+${r.variance}` : String(r.variance),
      LABEL[r.status] ?? r.status,
      r.unit_cost ? `$${r.unit_cost.toFixed(2)}` : "—",
      r.variance_value ? `$${r.variance_value.toFixed(2)}` : "—",
      String(r.new_qty),
    ]),
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: {
      fillColor: [20, 20, 20],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 90 },
      2: { cellWidth: "auto" },
      3: { cellWidth: 28, halign: "center" },
      4: { cellWidth: 36, halign: "right" },
      5: { cellWidth: 44, halign: "right" },
      6: { cellWidth: 32, halign: "right", fontStyle: "bold" },
      7: { cellWidth: 50 },
      8: { cellWidth: 46, halign: "right" },
      9: { cellWidth: 46, halign: "right" },
      10: { cellWidth: 44, halign: "right", fontStyle: "bold" },
    },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(
        `*** Total Line Items: ${filtered.length} ***`,
        pageW / 2,
        pageH - 16,
        { align: "center" },
      );
    },
  });

  return doc;
}

export function pdfToBase64(doc: jsPDF): string {
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

