import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageError, isHeic, prepareReceiptImage } from "./images.js";
import { ROOT_DIR } from "./config.js";

const sample = (f: string) => fs.readFileSync(path.join(ROOT_DIR, "samples", f));

describe("receipt images", () => {
  it("detects HEIC by bytes even when the browser sends octet-stream", () => {
    expect(isHeic(sample("receipt-tommy-iphone.heic"), "application/octet-stream", "blob")).toBe(true);
    expect(isHeic(sample("receipt-tommy.jpg"), "image/jpeg", "r.jpg")).toBe(false);
  });

  it("converts a real HEIC photo to an upright JPEG within limits", async () => {
    const out = await prepareReceiptImage(sample("receipt-tommy-iphone.heic"), "image/heic", "IMG_0001.HEIC");
    expect(out.convertedFromHeic).toBe(true);
    expect(out.mediaType).toBe("image/jpeg");
    expect(out.buffer.subarray(0, 3).toString("hex")).toBe("ffd8ff"); // JPEG magic
    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2000);
    expect(out.buffer.length).toBeLessThan(3.5 * 1024 * 1024);
  }, 30000);

  it("passes small JPEGs through untouched", async () => {
    const jpg = sample("receipt-tommy.jpg");
    const out = await prepareReceiptImage(jpg, "image/jpeg", "r.jpg");
    expect(out.convertedFromHeic).toBe(false);
    expect(out.buffer.equals(jpg)).toBe(true);
  });

  it("fails loudly on a corrupt HEIC instead of passing it on", async () => {
    const broken = Buffer.concat([sample("receipt-tommy-iphone.heic").subarray(0, 64), Buffer.alloc(200)]);
    await expect(prepareReceiptImage(broken, "image/heic", "bad.heic")).rejects.toThrow(ImageError);
    await expect(prepareReceiptImage(broken, "image/heic", "bad.heic")).rejects.toThrow(/Couldn't convert the HEIC/);
  });

  it("rejects files that aren't images", async () => {
    await expect(prepareReceiptImage(Buffer.from("hello"), "image/png", "x.png")).rejects.toThrow(/isn't a readable image/);
  });
});
