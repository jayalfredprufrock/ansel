import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Focal, ImageEntry } from "./index.ts";
import { ENTRIES_FILE, readManifest, urlHash } from "./manifest.ts";

/** A usable image's original, as an optimizer stores it: `<scope>/<hash>/<slug>`. */
export interface Original {
  /** Image name (`team/dr-patel`). */
  name: string;
  /** URL hash: content plus the effective focal point. */
  hash: string;
  /** Last segment of the name, as in URLs (`dr-patel`). */
  slug: string;
  /** Absolute path of the source file. */
  file: string;
  /** Effective focal point (`images.ts` override, else detected). */
  focal: Focal;
}

/**
 * Every image a build can reference (those with an `images.ts` entry), for uploading originals to
 * an optimizer's bucket. Reads the committed `manifest.json` and `images.ts`; run it after a build,
 * which has already checked both. `dir` is the images folder (default `src/images`).
 */
export async function listOriginals(root: string, dir = "src/images"): Promise<Original[]> {
  const folder = resolve(root, dir);
  const manifest = await readManifest(folder);
  if (!manifest) return [];
  let entries: Record<string, ImageEntry>;
  try {
    const module = (await import(pathToFileURL(join(folder, ENTRIES_FILE)).href)) as {
      default?: Record<string, ImageEntry>;
    };
    entries = module.default ?? {};
  } catch {
    return [];
  }
  const originals: Original[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const data = manifest.images[name];
    if (!data) continue;
    const focal = entry.focal ?? data.focal;
    originals.push({
      name,
      hash: urlHash(data.content, focal),
      slug: name.split("/").pop() ?? name,
      file: join(folder, data.file),
      focal,
    });
  }
  return originals;
}
