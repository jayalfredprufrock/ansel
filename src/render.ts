import type { AnselImage } from "./index.ts";
import {
  FORMATS,
  WIDTHS,
  buildImageUrl,
  outputSize,
  type Format,
  type Quality,
  type Ratio,
  type Width,
} from "./url.ts";

export type Placeholder = "blur" | "pixelated" | "color" | "none";

export interface ImgOptions {
  /** Crop to this aspect ratio, centered on the image's focal point. Default: the original's. */
  ratio?: Ratio | undefined;
  /** The `sizes` attribute: how wide the image is shown. Default: `100vw`. */
  sizes?: string | undefined;
  /** Default: `standard`. */
  quality?: Quality | undefined;
  /** Default: `blur`, or `none` for images with transparency. */
  placeholder?: Placeholder | undefined;
  /** Above-the-fold images: load eagerly with high priority instead of lazily. */
  priority?: boolean | undefined;
  /** Overrides the alt text from `images.ts` for this use. */
  alt?: string | undefined;
}

export interface ImgMarkup {
  placeholder: Placeholder;
  /** Data URI shown under the image while it loads. */
  placeholderSrc?: string;
  /** `<source>` elements, best format first. */
  sources: { type: string; srcset: string; sizes: string }[];
  img: {
    src: string;
    srcset: string;
    sizes: string;
    width: number;
    height: number;
    alt: string;
    loading: "eager" | "lazy";
    decoding: "async";
    fetchpriority?: "high";
  };
}

/** Width steps worth offering: every step up to the first that reaches the largest output. */
function usefulWidths(image: AnselImage, ratio: Ratio | undefined): Width[] {
  const largest = outputSize({ width: 2560, ratio }, image).width;
  const widths: Width[] = [];
  for (const width of WIDTHS) {
    widths.push(width);
    if (width >= largest) break;
  }
  return widths;
}

/** Everything `<Img>` renders, shared by the Astro and React components. */
export function imgMarkup(image: AnselImage, options: ImgOptions = {}): ImgMarkup {
  const { ratio, quality = "standard", priority = false } = options;
  const sizes = options.sizes ?? "100vw";
  const widths = usefulWidths(image, ratio);

  const srcset = (format: Format) =>
    widths
      .map((width) => {
        const url = buildImageUrl({
          hash: image.hash,
          name: image.slug,
          width,
          ratio,
          quality,
          format,
        });
        return `${url} ${outputSize({ width, ratio }, image).width}w`;
      })
      .join(", ");

  // Fallback `src` for browsers without srcset support: a mid-size WebP.
  const fallbackWidth = widths.find((w) => w >= 960) ?? widths[widths.length - 1] ?? 960;
  const largest = outputSize({ width: widths[widths.length - 1] ?? 2560, ratio }, image);
  const placeholder = options.placeholder ?? (image.alpha ? "none" : "blur");

  return {
    placeholder,
    ...(placeholder !== "none" && {
      placeholderSrc: placeholder === "color" ? colorDataUri(image.color) : image.preview,
    }),
    sources: FORMATS.filter((f) => f !== "webp").map((format) => ({
      type: `image/${format}`,
      srcset: srcset(format),
      sizes,
    })),
    img: {
      src: buildImageUrl({
        hash: image.hash,
        name: image.slug,
        width: fallbackWidth,
        ratio,
        quality,
        format: "webp",
      }),
      srcset: srcset("webp"),
      sizes,
      width: largest.width,
      height: largest.height,
      alt: options.alt ?? image.alt ?? "",
      loading: priority ? "eager" : "lazy",
      decoding: "async",
      ...(priority && { fetchpriority: "high" as const }),
    },
  };
}

/** A 1×1 SVG in the image's dominant color. */
function colorDataUri(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="${color}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
