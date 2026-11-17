/**
 * The image URL format shared by `<Img>`, the dev server and the optimizer, so they can't disagree.
 *
 *   /_img/<hash>/w<width>[-r<ratio>]-q<quality>/<name>.<format>
 *   /_img/3f9a2c1b7e04/w1280-r4x3-q75/dr-patel.avif
 *
 * Everything is in the path (no query string). Every part comes from a fixed list or must match
 * an uploaded original, so a URL is valid only if a build could have produced it.
 */

/** Path prefix the optimizer is served under, on the site's own domain. */
export const IMAGE_PATH_PREFIX = "/_img/";

/** Output widths. Requested widths snap up to the next step. */
export const WIDTHS = [320, 480, 640, 800, 960, 1280, 1600, 1920, 2560] as const;
export type Width = (typeof WIDTHS)[number];

/** Crop aspect ratios as `width:height`. Omit the ratio to keep the original's. */
export const RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "21:9"] as const;
export type Ratio = (typeof RATIOS)[number];

export const QUALITIES = { low: 55, standard: 75, high: 88 } as const;
export type Quality = keyof typeof QUALITIES;

/** Output formats, best first: `<Img>` offers AVIF with a WebP fallback. */
export const FORMATS = ["avif", "webp"] as const;
export type Format = (typeof FORMATS)[number];

export interface ImageVariant {
  /** Hash of the original's content and focal point (12 lowercase hex characters). */
  hash: string;
  /** Last segment of the image name, for readable URLs: `team/dr-patel` → `dr-patel`. */
  name: string;
  width: Width;
  /** Crop ratio; `undefined` keeps the original's. */
  ratio?: Ratio | undefined;
  quality: Quality;
  format: Format;
}

const HASH = /^[0-9a-f]{12}$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PATTERN = /^\/_img\/([^/]+)\/w(\d+)(?:-r(\d+)x(\d+))?-q(\d+)\/([^/]+)\.([a-z]+)$/;

const isWidth = (n: number): n is Width => (WIDTHS as readonly number[]).includes(n);
const isRatio = (s: string): s is Ratio => (RATIOS as readonly string[]).includes(s);
const isFormat = (s: string): s is Format => (FORMATS as readonly string[]).includes(s);
const isQuality = (s: string): s is Quality => Object.hasOwn(QUALITIES, s);

/** The smallest width step at least `width` wide (the largest step if none is). */
export function snapWidth(width: number): Width {
  return WIDTHS.find((step) => step >= width) ?? 2560;
}

export function buildImageUrl(variant: ImageVariant): string {
  const { hash, name, width, ratio, quality, format } = variant;
  if (!HASH.test(hash)) throw new Error(`Invalid image hash "${hash}"`);
  if (!NAME.test(name)) throw new Error(`Invalid image name "${name}"`);
  if (!isWidth(width)) throw new Error(`Invalid width ${String(width)}`);
  if (ratio !== undefined && !isRatio(ratio)) throw new Error(`Invalid ratio "${String(ratio)}"`);
  if (!isQuality(quality)) throw new Error(`Invalid quality "${String(quality)}"`);
  if (!isFormat(format)) throw new Error(`Invalid format "${String(format)}"`);

  const r = ratio ? `-r${ratio.replace(":", "x")}` : "";
  return `${IMAGE_PATH_PREFIX}${hash}/w${width}${r}-q${QUALITIES[quality]}/${name}.${format}`;
}

/** Parses a URL path; `undefined` for anything a build could not have produced. */
export function parseImageUrl(path: string): ImageVariant | undefined {
  const match = URL_PATTERN.exec(path);
  if (!match) return undefined;
  const [, hash = "", w = "", rw, rh, q = "", name = "", format = ""] = match;

  const width = Number(w);
  const ratio = rw === undefined ? undefined : `${rw}:${rh}`;
  const quality = (Object.keys(QUALITIES) as Quality[]).find((k) => String(QUALITIES[k]) === q);
  if (
    !HASH.test(hash) ||
    !NAME.test(name) ||
    String(width) !== w ||
    !isWidth(width) ||
    (ratio !== undefined && !isRatio(ratio)) ||
    quality === undefined ||
    !isFormat(format)
  ) {
    return undefined;
  }
  return { hash, name, width, ratio, quality, format };
}

/**
 * The pixel size a variant actually comes out at, given the original's size. Never upscales:
 * a crop is limited by the largest region of that ratio the original contains.
 */
export function outputSize(
  variant: Pick<ImageVariant, "width" | "ratio">,
  original: { width: number; height: number },
): { width: number; height: number } {
  if (!variant.ratio) {
    const width = Math.min(variant.width, original.width);
    return { width, height: Math.round((width * original.height) / original.width) };
  }
  const [rw = 1, rh = 1] = variant.ratio.split(":").map(Number);
  const maxWidth = Math.min(original.width, Math.floor((original.height * rw) / rh));
  const width = Math.min(variant.width, maxWidth);
  return { width, height: Math.round((width * rh) / rw) };
}

/**
 * The region of the original that a cropped variant shows: the largest area of that ratio,
 * centered on the focal point (given in whole percentages) and kept inside the image.
 */
export function cropRegion(
  original: { width: number; height: number },
  ratio: Ratio,
  focal: readonly [x: number, y: number],
): { left: number; top: number; width: number; height: number } {
  const [rw = 1, rh = 1] = ratio.split(":").map(Number);
  const width = Math.min(original.width, Math.floor((original.height * rw) / rh));
  const height = Math.min(original.height, Math.round((width * rh) / rw));
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);
  const left = clamp(
    Math.round((focal[0] / 100) * original.width - width / 2),
    original.width - width,
  );
  const top = clamp(
    Math.round((focal[1] / 100) * original.height - height / 2),
    original.height - height,
  );
  return { left, top, width, height };
}
