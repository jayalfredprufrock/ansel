import sharp from "sharp";
import type { Focal } from "./index.ts";
import { cropRegion, outputSize, type ImageVariant } from "./url.ts";

/**
 * Encoder settings per quality level. AVIF reaches the same visual quality at lower numbers
 * than WebP, so each format gets its own scale.
 */
const ENCODER_QUALITY = {
  avif: { low: 40, standard: 55, high: 70 },
  webp: { low: 55, standard: 75, high: 88 },
} as const;

/**
 * Produces one variant from an original. Shared by the dev server and the optimizer, so local
 * output matches production. Metadata (EXIF, GPS, XMP) is never copied to the output.
 */
export async function transformImage(
  original: Uint8Array,
  variant: Pick<ImageVariant, "width" | "ratio" | "quality" | "format">,
  focal: Focal,
  /** Refuse originals with more pixels than this (sharp's default is 268 million). */
  maxPixels?: number,
): Promise<Buffer> {
  const options = maxPixels ? { limitInputPixels: maxPixels } : {};
  const image = sharp(original, options).autoOrient();
  const { autoOrient } = await sharp(original, options).metadata();
  const size = outputSize(variant, autoOrient);
  if (variant.ratio) image.extract(cropRegion(autoOrient, variant.ratio, focal));
  image.resize(size.width, size.height, { fit: "fill" });

  const quality = ENCODER_QUALITY[variant.format][variant.quality];
  return variant.format === "avif"
    ? image.avif({ quality, effort: 4 }).toBuffer()
    : image.webp({ quality }).toBuffer();
}
