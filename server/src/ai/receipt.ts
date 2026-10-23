import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { assertNotRefused, baseRequest, claude } from "./client.js";
import { RECEIPT_SYSTEM } from "./prompts.js";

export const ReceiptSchema = z.object({
  is_receipt: z.boolean(),
  merchant: z.string().nullable(),
  total: z.number().nullable().describe("Grand total as a number, e.g. 186.4"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR"),
  date: z.string().nullable().describe("YYYY-MM-DD or null"),
  items: z.array(z.object({ name: z.string(), quantity: z.number().nullable(), price: z.number().nullable() })),
  notes: z.string().nullable().describe("Anything worth flagging: tip included, illegible total, service charge..."),
});
export type ReceiptData = z.infer<typeof ReceiptSchema>;

type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Claude vision -> structured receipt data. */
export async function extractReceipt(image: Buffer, mediaType: MediaType): Promise<ReceiptData> {
  const response = await claude().beta.messages.parse({
    ...baseRequest,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(ReceiptSchema) },
    system: RECEIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          { type: "text", text: "Extract this receipt." },
        ],
      },
    ],
  });
  assertNotRefused(response);
  if (!response.parsed_output) throw new Error("Could not read the receipt (no structured output returned).");
  return response.parsed_output;
}
