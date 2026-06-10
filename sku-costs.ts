import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const InputSchema = z.object({
  cycleName: z.string().min(1).max(255),
  recipients: z.array(z.string().email()).min(1).max(50),
  pdfBase64: z.string().min(1),
  summary: z.object({
    match: z.number().int().min(0),
    short: z.number().int().min(0),
    over: z.number().int().min(0),
    unexpected: z.number().int().min(0),
    uncounted: z.number().int().min(0),
  }),
});

export const sendCycleReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    const { cycleName, recipients, pdfBase64, summary } = data;
    const subject = `Cycle Count Finalized — ${cycleName}`;
    const html = `
      <div style="font-family:Arial,sans-serif;color:#111">
        <h2 style="margin:0 0 12px">Cycle Count Finalized</h2>
        <p style="margin:0 0 16px"><strong>${cycleName}</strong> has been finalized. The count summary report is attached as a PDF.</p>
        <table style="border-collapse:collapse;font-size:14px">
          <tbody>
            <tr><td style="padding:4px 12px 4px 0">Matches</td><td><strong>${summary.match}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Shorts</td><td><strong>${summary.short}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Overs</td><td><strong>${summary.over}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Unexpected</td><td><strong>${summary.unexpected}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0">Uncounted</td><td><strong>${summary.uncounted}</strong></td></tr>
          </tbody>
        </table>
      </div>
    `;

    const filename = `${cycleName.replace(/\s+/g, "_")}_count_summary.pdf`;

    const response = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "CountRight <reports@ioiacc.com>",
        to: recipients,
        subject,
        html,
        attachments: [{ filename, content: pdfBase64, content_type: "application/pdf" }],

      }),
    });

    const body = await response.json().catch(() => ({}));
    console.log("[sendCycleReport] resend response", {
      status: response.status,
      ok: response.ok,
      to: recipients,
      from: "CountRight <reports@ioiacc.com>",
      cycleName,
      body,
    });
    if (!response.ok) {
      throw new Error(
        `Resend send failed [${response.status}]: ${JSON.stringify(body)}`,
      );
    }
    return { ok: true, id: (body as any)?.id ?? null };
  });
