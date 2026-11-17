/**
 * Image files found in the images folder. Filled in by the generated `types.d.ts`.
 * @internal
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type
export interface ImageFiles {}

/**
 * The project's `images.ts` entries. Filled in by the generated `types.d.ts`, so image names
 * are checked everywhere `<Img>` is used.
 */
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type
export interface ImageRegistry {}

/** An image file's name: its path inside the images folder, without the extension. */
export type ImageFileName = keyof ImageFiles extends never
  ? string
  : Extract<keyof ImageFiles, string>;

/** A usable image's name: one with an entry in `images.ts`. */
export type ImageName = keyof ImageRegistry extends never
  ? string
  : Extract<keyof ImageRegistry, string>;

/** A point in the image as whole percentages from the top-left corner: `[x, y]`. */
export type Focal = readonly [x: number, y: number];

interface EntryBase {
  /** Overrides the automatically detected focal point that crops center on. */
  focal?: Focal;
}

/** One image's hand-written data: alt text, or an explicit `decorative: true`. */
export type ImageEntry =
  | (EntryBase & { alt: string; decorative?: never })
  | (EntryBase & { decorative: true; alt?: never });

/**
 * Lists the images a project can use, each with its alt text (or `decorative: true`).
 * Keys must be image files in the images folder.
 */
export function defineImages<const T extends { [K in ImageFileName]?: ImageEntry }>(
  images: T & Record<Exclude<keyof T, ImageFileName>, never>,
): T {
  return images;
}

/** Everything a component needs to render one image. Built by the Vite plugin. */
export interface AnselImage {
  name: string;
  /** URL hash: covers the content and the effective focal point. */
  hash: string;
  /** Last segment of the name, used in URLs. */
  slug: string;
  /** Original size after EXIF orientation. */
  width: number;
  height: number;
  focal: Focal;
  /** ~16 px WebP data URI for the blur and pixelated placeholders. */
  preview: string;
  /** Dominant color as `#rrggbb` for the color placeholder. */
  color: string;
  /** Has transparent areas: no placeholder by default. */
  alpha: boolean;
  /** Alt text from `images.ts`; absent for decorative images. */
  alt?: string;
  decorative: boolean;
}
