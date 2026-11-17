import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import sharp from "sharp";
import type { Focal } from "./index.ts";

export const MANIFEST_FILE = "manifest.json";
export const TYPES_FILE = "types.d.ts";
export const ENTRIES_FILE = "images.ts";
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

/** Longest side of the inline preview used by the blur and pixelated placeholders. */
const PREVIEW_SIZE = 16;
/** Size of the copy the focal point is detected on. */
const FOCAL_SIZE = 256;
/** Name segments: lowercase letters and digits joined by single dashes. */
const NAME_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Embedded {
  alt?: string;
  creator?: string;
  copyright?: string;
}

export interface ManifestEntry {
  /** Path inside the images folder, with extension. */
  file: string;
  /** 12-hex SHA-256 of the file's bytes. */
  content: string;
  /** Size after applying EXIF orientation. */
  width: number;
  height: number;
  bytes: number;
  /** Detected focal point. `images.ts` can override it. */
  focal: Focal;
  /** ~16 px WebP as a data URI. */
  preview: string;
  /** Dominant color as `#rrggbb`. */
  color: string;
  /** Whether the image has transparent areas (placeholders would show through). */
  alpha: boolean;
  /** Whether the file carries GPS location data. */
  gps: boolean;
  /** Description, creator and copyright found inside the file. */
  embedded: Embedded;
}

export interface Manifest {
  version: 1;
  images: Record<string, ManifestEntry>;
}

export interface ImageFile {
  name: string;
  file: string;
}

export interface FolderScan {
  images: ImageFile[];
  /** Files that look like images but can't be used, with the reason and a valid name if any. */
  invalid: { file: string; reason: string; suggestion?: string }[];
}

/** Finds the image files in `dir` (recursively) and derives their names. */
export async function scanImages(dir: string): Promise<FolderScan> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const images: ImageFile[] = [];
  const invalid: FolderScan["invalid"] = [];
  const seen = new Map<string, string>();

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
  for (const file of files) {
    const dot = file.lastIndexOf(".");
    const extension = dot === -1 ? "" : file.slice(dot).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(extension)) continue;

    const name = file.slice(0, dot);
    if (!name.split("/").every((segment) => NAME_SEGMENT.test(segment))) {
      const suggestion = suggestName(name);
      invalid.push({
        file,
        reason: `use lowercase letters, digits and dashes, e.g. "${suggestion}${extension}"`,
        suggestion,
      });
      continue;
    }
    const other = seen.get(name);
    if (other) {
      invalid.push({ file, reason: `same name as ${other}; rename one of them` });
      continue;
    }
    seen.set(name, file);
    images.push({ name, file });
  }
  images.sort((a, b) => a.name.localeCompare(b.name));
  return { images, invalid };
}

/** Camera, phone and stock-site default names, and names that are mostly a long number. */
const POOR_NAME =
  /^(img|dsc[nf]?|pxl|mvimg|gopr|dji|screenshot|screen-shot|untitled|image|photo|pexels-photo|pexels|unsplash|shutterstock|adobestock|istock|istockphoto|gettyimages|depositphotos)(-|$)|\d{5,}|^\d+$/;

/** Whether a valid image name's last segment is a camera or stock default (`team/img-4821`). */
export function isPoorName(name: string): boolean {
  return POOR_NAME.test(name.split("/").pop() ?? name);
}

/** A valid name close to `name`: `Dr Patel (Portrait)` → `dr-patel-portrait`. */
export function suggestName(name: string): string {
  return name
    .split("/")
    .map(
      (segment) =>
        segment
          .normalize("NFKD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "image",
    )
    .join("/");
}

export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

/** The hash used in image URLs: covers the content and the focal point crops center on. */
export function urlHash(content: string, focal: Focal): string {
  return createHash("sha256")
    .update(`${content}:${focal[0]},${focal[1]}`)
    .digest("hex")
    .slice(0, 12);
}

/** Measures an image and builds its manifest entry. */
export async function analyzeImage(file: string, bytes: Uint8Array): Promise<ManifestEntry> {
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;

  const [focal, preview, stats] = await Promise.all([
    detectFocal(bytes),
    sharp(bytes)
      .autoOrient()
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: "inside" })
      .webp({ quality: 50 })
      .toBuffer(),
    sharp(bytes).stats(),
  ]);
  const exif = metadata.exif ? readExif(metadata.exif) : { gps: false, embedded: {} };
  const xmp = metadata.xmp ? readXmp(metadata.xmp.toString("utf8")) : { gps: false, embedded: {} };
  const { r, g, b } = stats.dominant;

  return {
    file,
    content: contentHash(bytes),
    width,
    height,
    bytes: bytes.byteLength,
    focal,
    preview: `data:image/webp;base64,${preview.toString("base64")}`,
    color: `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
    alpha: metadata.hasAlpha && !stats.isOpaque,
    gps: exif.gps || xmp.gps,
    embedded: { ...exif.embedded, ...xmp.embedded },
  };
}

/** Finds the most interesting point with sharp's attention strategy, as whole percentages. */
async function detectFocal(bytes: Uint8Array): Promise<Focal> {
  // Run on a small raw copy: attention coordinates are only reliable in the input's own space.
  const { data, info } = await sharp(bytes)
    .autoOrient()
    .resize(FOCAL_SIZE, FOCAL_SIZE, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const side = Math.min(info.width, info.height);
  const { info: result } = await sharp(data, { raw: info })
    .resize(side, side, { fit: "cover", position: "attention" })
    .toBuffer({ resolveWithObject: true });
  const x = ((result.attentionX ?? info.width / 2) / info.width) * 100;
  const y = ((result.attentionY ?? info.height / 2) / info.height) * 100;
  return [clampPercent(x), clampPercent(y)];
}

const clampPercent = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));

interface MetadataFindings {
  gps: boolean;
  embedded: Embedded;
}

/** Reads the GPS pointer and the description, artist and copyright tags from EXIF IFD0. */
export function readExif(exif: Buffer): MetadataFindings {
  const findings: MetadataFindings = { gps: false, embedded: {} };
  // sharp returns the APP1 payload, starting with "Exif\0\0" before the TIFF header.
  const tiff = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? exif.subarray(6) : exif;
  if (tiff.length < 8) return findings;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const at = ifd + 2 + i * 12;
      const tag = u16(at);
      if (tag === 0x8825) findings.gps = true;
      const key = ({ 0x010e: "alt", 0x013b: "creator", 0x8298: "copyright" } as const)[tag];
      if (!key || u16(at + 2) !== 2) continue; // ASCII values only
      const length = u32(at + 4);
      const start = length <= 4 ? at + 8 : u32(at + 8);
      const value = tiff
        .toString("utf8", start, start + length)
        .replace(/\0+$/, "")
        .trim();
      if (value) findings.embedded[key] = value;
    }
  } catch {
    // Malformed EXIF: keep whatever was read.
  }
  return findings;
}

/** Reads GPS presence, alt text/description, creator and rights from an XMP packet. */
export function readXmp(xmp: string): MetadataFindings {
  const first = (tag: string): string | undefined => {
    const block = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xmp)?.[1];
    if (block === undefined) return undefined;
    const li = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(block)?.[1] ?? block;
    return decodeXml(li).trim() || undefined;
  };
  const embedded: Embedded = {};
  const alt = first("Iptc4xmpCore:AltTextAccessibility") ?? first("dc:description");
  const creator = first("dc:creator");
  const copyright = first("dc:rights");
  if (alt) embedded.alt = alt;
  if (creator) embedded.creator = creator;
  if (copyright) embedded.copyright = copyright;
  return { gps: /exif:GPS(Latitude|Longitude)/.test(xmp), embedded };
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export interface SyncResult {
  manifest: Manifest;
  /** Names whose entries were added or recomputed. */
  updated: string[];
  /** Names dropped because their file is gone. */
  removed: string[];
  invalid: FolderScan["invalid"];
}

/**
 * Brings the manifest up to date with the folder. Only new or changed files are analyzed;
 * a renamed file reuses its old entry (matched by content hash).
 */
export async function syncManifest(
  dir: string,
  previous: Manifest | undefined,
): Promise<SyncResult> {
  const { images, invalid } = await scanImages(dir);
  const old = previous?.images ?? {};
  const byContent = new Map(Object.values(old).map((entry) => [entry.content, entry]));
  const next: Manifest = { version: 1, images: {} };
  const updated: string[] = [];

  await Promise.all(
    images.map(async ({ name, file }) => {
      const bytes = await readFile(join(dir, file));
      const content = contentHash(bytes);
      const reused = old[name]?.content === content ? old[name] : byContent.get(content);
      if (reused) {
        next.images[name] = { ...reused, file };
        if (reused.file !== file) updated.push(name);
      } else {
        next.images[name] = await analyzeImage(file, bytes);
        updated.push(name);
      }
    }),
  );
  next.images = Object.fromEntries(
    Object.entries(next.images).sort(([a], [b]) => a.localeCompare(b)),
  );
  const removed = Object.keys(old).filter((name) => !(name in next.images));
  return { manifest: next, updated: updated.sort(), removed, invalid };
}

export async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8")) as Manifest;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function serializeManifest(manifest: Manifest): string {
  // Keep focal points on one line: `"focal": [48, 31]`.
  const json = JSON.stringify(manifest, null, 2).replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, "[$1, $2]");
  return `${json}\n`;
}

export async function writeIfChanged(path: string, content: string): Promise<boolean> {
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === content) return false;
  await writeFile(path, content);
  return true;
}
