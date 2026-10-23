/**
 * Receipt image preparation: HEIC/HEIF (iPhone) -> JPEG, and downscaling of big photos so
 * they stay under Claude's per-image size limit. Any failure is a clear ImageError, never a
 * silent pass-through.
 */
import heicConvert from "heic-convert";
import sharp from "sharp";

export type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export class ImageError extends Error {}

export interface PreparedImage {
  buffer: Buffer;
  mediaType: MediaType;
  ext: "jpg" | "png" | "gif" | "webp";
  convertedFromHeic: boolean;
  resized: boolean;
}

const MAX_EDGE = 2000; // px, long edge
const MAX_BYTES = 3.5 * 1024 * 1024; // keep well under Claude's 5 MB image limit
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const EXT: Record<MediaType, PreparedImage["ext"]> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
const SHARP_TO_MIME: Record<string, MediaType> = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

/** HEIC/HEIF by MIME, extension, or the ISO-BMFF "ftyp" brand (browsers often send .heic as octet-stream). */
export function isHeic(buf: Buffer, mime: string, filename = ""): boolean {
  if (/^image\/hei[cf](-sequence)?$/i.test(mime)) return true;
  if (/\.(heic|heif)$/i.test(filename)) return true;
  return buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp" && HEIC_BRANDS.has(buf.toString("latin1", 8, 12));
}

export async function prepareReceiptImage(input: Buffer, mime: string, filename = ""): Promise<PreparedImage> {
  let buffer = input;
  let mediaType: MediaType;
  let convertedFromHeic = false;

  if (isHeic(input, mime, filename)) {
    try {
      const out = await heicConvert({ buffer: new Uint8Array(input), format: "JPEG", quality: 0.9 });
      buffer = Buffer.from(out);
      mediaType = "image/jpeg";
      convertedFromHeic = true;
    } catch (err) {
      throw new ImageError(`Couldn't convert the HEIC/HEIF photo to JPEG: ${(err as Error).message || String(err)}`);
    }
  } else {
    // Trust the bytes, not the browser's MIME label.
    let format: string | undefined;
    try {
      format = (await sharp(input).metadata()).format;
    } catch (err) {
      throw new ImageError(`That file isn't a readable image (${mime || "unknown type"}): ${(err as Error).message}`);
    }
    const detected = format ? SHARP_TO_MIME[format] : undefined;
    if (!detected) throw new ImageError(`Unsupported image format "${format ?? mime}". Use JPEG, PNG, WebP, GIF or HEIC.`);
    mediaType = detected;
  }

  // Downscale big photos (and apply EXIF rotation) so Claude gets an upright image under its size limit.
  let resized = false;
  try {
    const meta = await sharp(buffer).metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longEdge > MAX_EDGE || buffer.length > MAX_BYTES || (meta.orientation ?? 1) !== 1) {
      buffer = await sharp(buffer)
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      mediaType = "image/jpeg";
      resized = longEdge > MAX_EDGE || input.length > MAX_BYTES;
    }
  } catch (err) {
    throw new ImageError(`Couldn't process the photo: ${(err as Error).message}`);
  }
  if (buffer.length > 5 * 1024 * 1024) throw new ImageError("The photo is still over 5 MB after resizing. Try a smaller image.");

  return { buffer, mediaType, ext: EXT[mediaType], convertedFromHeic, resized };
}
