import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { AnselImage, Focal, ImageEntry } from "./index.ts";
import {
  ENTRIES_FILE,
  MANIFEST_FILE,
  TYPES_FILE,
  isPoorName,
  readManifest,
  serializeManifest,
  syncManifest,
  urlHash,
  writeIfChanged,
  type Manifest,
  type ManifestEntry,
} from "./manifest.ts";
import { transformImage } from "./transform.ts";
import { IMAGE_PATH_PREFIX, parseImageUrl, type ImageVariant } from "./url.ts";

const PACKAGE_NAME = "@jayalfredprufrock/ansel";
const VIRTUAL_ALL = "virtual:ansel";
const RESOLVED_ALL = `\0${VIRTUAL_ALL}`;
const QUERY = "?ansel";
const RESOLVED_ONE = "\0ansel:";

export interface AnselOptions {
  /** Folder of source images, relative to the Vite root. Default: `src/images`. */
  dir?: string;
  /**
   * `write` keeps `manifest.json` and `types.d.ts` up to date. `check` never writes and fails
   * the build if they are out of date. Default: `check` when the `CI` environment variable is
   * set, `write` otherwise.
   */
  manifest?: "write" | "check";
  /** Reject camera and stock-site file names (`IMG_4821`, `DSC01234`, `pexels-photo-…`). */
  rejectPoorNames?: boolean;
  /** Reject images that still carry GPS location data. */
  rejectGps?: boolean;
  /** Reject source files larger than this many bytes. */
  maxFileSize?: number;
  /** Reject source images with more than this many pixels (width × height). */
  maxPixels?: number;
}

const POOR_NAME_PROBLEM =
  'the name doesn\'t say what the image shows; rename it in lowercase letters, digits and dashes, e.g. "team/dr-patel.jpg"';

interface State {
  manifest: Manifest;
  images: Record<string, AnselImage>;
  /** Absolute file path → image name, for `?ansel` imports. */
  byFile: Map<string, string>;
  /** URL hash → image name, for the dev server. */
  byHash: Map<string, string>;
  /** Problems found: fail a build, warn in dev. */
  problems: string[];
}

/**
 * Keeps the image manifest and types up to date, provides image data to `<Img>`, and serves
 * `/_img/*` locally in dev with the same output as the optimizer.
 */
export function ansel(options: AnselOptions = {}): Plugin {
  const mode = options.manifest ?? (process.env.CI ? "check" : "write");
  let config: ResolvedConfig;
  let dir: string;
  let syncing: Promise<State> | undefined;
  let entriesVersion = 0;

  const isBuild = () => config.command === "build";
  const rel = (path: string) => relative(config.root, path);

  async function sync(): Promise<State> {
    const problems: string[] = [];
    const result = await syncManifest(dir, await readManifest(dir));
    const { manifest } = result;
    for (const { file, reason, suggestion } of result.invalid) {
      // Don't suggest a fixed-up camera name that `rejectPoorNames` would reject next.
      const poor = options.rejectPoorNames && suggestion !== undefined && isPoorName(suggestion);
      problems.push(`${file}: ${poor ? POOR_NAME_PROBLEM : reason}`);
    }

    const entries = await loadEntries();
    const manifestPath = join(dir, MANIFEST_FILE);
    const typesPath = join(dir, TYPES_FILE);
    const manifestText = serializeManifest(manifest);
    const typesText = generateTypes(manifest, entries !== undefined);

    if (mode === "write") {
      const wrote = await writeIfChanged(manifestPath, manifestText);
      await writeIfChanged(typesPath, typesText);
      const changes = [
        ...result.updated.map((n) => `+ ${n}`),
        ...result.removed.map((n) => `- ${n}`),
      ];
      if (wrote && changes.length)
        config.logger.info(`ansel: updated ${MANIFEST_FILE}\n  ${changes.join("\n  ")}`);
    } else if (
      (await readText(manifestPath)) !== manifestText ||
      (await readText(typesPath)) !== typesText
    ) {
      const changed = [...result.updated, ...result.removed];
      problems.push(
        `${rel(manifestPath)} is out of date${changed.length ? ` (${changed.join(", ")})` : ""}. ` +
          `Run the dev server or a local build, then commit ${MANIFEST_FILE} and ${TYPES_FILE}.`,
      );
    }

    const images: Record<string, AnselImage> = {};
    for (const [name, entry] of Object.entries(entries ?? {})) {
      const data = manifest.images[name];
      if (!data) {
        problems.push(`${ENTRIES_FILE}: "${name}" has no image file in ${rel(dir)}`);
      } else if (entry.decorative !== true && !entry.alt?.trim()) {
        problems.push(`${ENTRIES_FILE}: "${name}" needs alt text, or \`decorative: true\``);
      } else {
        images[name] = toImage(name, data, entry);
      }
    }
    for (const [name, data] of Object.entries(manifest.images)) {
      problems.push(...checkImage(name, data));
      if (!entries?.[name] && !isBuild()) {
        const hint = data.embedded.alt ? ` (embedded description: "${data.embedded.alt}")` : "";
        config.logger.warn(
          `ansel: ${data.file} isn't in ${ENTRIES_FILE}, so it can't be used yet${hint}`,
        );
      }
    }
    if (problems.length && !isBuild()) {
      config.logger.warn(`ansel:\n  ${problems.join("\n  ")}`);
    }

    return {
      problems,
      manifest,
      images,
      byFile: new Map(
        Object.keys(images).map((name) => [join(dir, manifest.images[name]!.file), name]),
      ),
      byHash: new Map(Object.values(images).map((image) => [image.hash, image.name])),
    };
  }

  function checkImage(name: string, data: ManifestEntry): string[] {
    const problems: string[] = [];
    if (options.rejectPoorNames && isPoorName(name)) {
      problems.push(`${data.file}: ${POOR_NAME_PROBLEM}`);
    }
    if (options.rejectGps && data.gps) {
      problems.push(`${data.file}: contains GPS location data; strip it before adding the image`);
    }
    if (options.maxFileSize && data.bytes > options.maxFileSize) {
      problems.push(
        `${data.file}: ${formatBytes(data.bytes)} is over the ${formatBytes(options.maxFileSize)} limit`,
      );
    }
    if (options.maxPixels && data.width * data.height > options.maxPixels) {
      problems.push(
        `${data.file}: ${data.width}×${data.height} is over the ${options.maxPixels.toLocaleString("en")} pixel limit`,
      );
    }
    return problems;
  }

  /** Loads `images.ts` with Node's type stripping. `undefined` if there is none (check mode). */
  async function loadEntries(): Promise<Record<string, ImageEntry> | undefined> {
    const file = join(dir, ENTRIES_FILE);
    if ((await readText(file)) === undefined) {
      if (mode !== "write") return undefined;
      await mkdir(dir, { recursive: true });
      await writeFile(file, STARTER_ENTRIES);
      config.logger.info(`ansel: created ${rel(file)}`);
    }
    const module = (await nativeImport(`${pathToFileURL(file).href}?v=${entriesVersion}`)) as {
      default?: Record<string, ImageEntry>;
    };
    return module.default ?? {};
  }

  function current(): Promise<State> {
    syncing ??= sync();
    return syncing;
  }

  function refresh(server: ViteDevServer) {
    const before = syncing;
    syncing = undefined;
    void Promise.all([before, current()]).then(
      ([old, next]) => {
        const ids = new Set([RESOLVED_ALL]);
        for (const state of [old, next])
          for (const file of state?.byFile.keys() ?? []) ids.add(RESOLVED_ONE + file);
        for (const environment of Object.values(server.environments)) {
          for (const id of ids) {
            const module = environment.moduleGraph.getModuleById(id);
            if (module) environment.moduleGraph.invalidateModule(module);
          }
        }
        server.ws.send({ type: "full-reload" });
      },
      (error: unknown) => config.logger.error(String(error)),
    );
  }

  /** Transforms with a disk cache next to Vite's own, keyed by URL. */
  async function cachedTransform(
    state: State,
    image: AnselImage,
    variant: ImageVariant,
  ): Promise<Buffer> {
    const cacheDir = join(config.cacheDir, "ansel");
    const key = `${variant.hash}-w${variant.width}-${variant.ratio?.replace(":", "x") ?? "o"}-${variant.quality}.${variant.format}`;
    const cached = await readFile(join(cacheDir, key)).catch(() => undefined);
    if (cached) return cached;
    const original = await readFile(join(dir, state.manifest.images[image.name]!.file));
    const output = await transformImage(original, variant, image.focal);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, key), output);
    return output;
  }

  return {
    name: "ansel",
    enforce: "pre",

    configResolved(resolved) {
      config = resolved;
      dir = resolve(config.root, options.dir ?? "src/images");
    },

    async buildStart() {
      const { problems } = await current();
      if (isBuild() && problems.length) this.error(`ansel:\n  ${problems.join("\n  ")}`);
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_ALL) return RESOLVED_ALL;
      if (!id.endsWith(QUERY)) return undefined;
      const path = id.slice(0, -QUERY.length);
      return RESOLVED_ONE + resolve(importer ? join(importer, "..") : config.root, path);
    },

    async load(id) {
      if (id === RESOLVED_ALL) {
        return `export const images = ${JSON.stringify((await current()).images)};`;
      }
      if (!id.startsWith(RESOLVED_ONE)) return undefined;
      const file = id.slice(RESOLVED_ONE.length);
      const state = await current();
      const name = state.byFile.get(file);
      if (!name) {
        throw new Error(
          `ansel: ${rel(file)} isn't a usable image: it must be in ${rel(dir)} and listed in ${ENTRIES_FILE}`,
        );
      }
      return `export default ${JSON.stringify(state.images[name])};`;
    },

    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file: string) => {
        if (!file.startsWith(dir)) return;
        if (file.endsWith(MANIFEST_FILE) || file.endsWith(TYPES_FILE)) return;
        if (file.endsWith(ENTRIES_FILE)) entriesVersion++;
        refresh(server);
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(IMAGE_PATH_PREFIX)) return next();
        void (async () => {
          const variant = parseImageUrl(req.url ?? "");
          const state = await current();
          const name = variant && state.byHash.get(variant.hash);
          const image = name ? state.images[name] : undefined;
          if (!variant || !image || image.slug !== variant.name) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          const output = await cachedTransform(state, image, variant);
          res.setHeader("Content-Type", `image/${variant.format}`);
          res.setHeader("Cache-Control", "no-cache");
          res.end(output);
        })().catch(next);
      });
    },
  };
}

function toImage(name: string, data: ManifestEntry, entry: ImageEntry): AnselImage {
  const focal: Focal = entry.focal ?? data.focal;
  return {
    name,
    hash: urlHash(data.content, focal),
    slug: name.split("/").pop() ?? name,
    width: data.width,
    height: data.height,
    focal,
    preview: data.preview,
    color: data.color,
    alpha: data.alpha,
    ...(entry.alt !== undefined && { alt: entry.alt }),
    decorative: entry.decorative === true,
  };
}

function generateTypes(manifest: Manifest, hasEntries: boolean): string {
  const files = Object.keys(manifest.images)
    .map((name) => `    ${JSON.stringify(name)}: true;`)
    .join("\n");
  const entries = hasEntries ? `type Entries = (typeof import("./images"))["default"];\n` : "";
  const registry = hasEntries ? "\n  interface ImageRegistry extends Entries {}" : "";
  return `// Generated by ansel. Do not edit.
/// <reference types="${PACKAGE_NAME}/client" />
${entries}
declare module "${PACKAGE_NAME}" {
  interface ImageFiles {
${files}
  }${registry}
}

export {};
`;
}

const STARTER_ENTRIES = `import { defineImages } from "${PACKAGE_NAME}";

// Every image the site uses, with alt text (or \`decorative: true\`).
export default defineImages({});
`;

/**
 * Node's own `import()`. When a Vite config is loaded through Vite's module runner (as Astro
 * does), a plain `import()` here would be routed through that runner instead of Node.
 */
// oxlint-disable-next-line typescript/no-implied-eval
const nativeImport = new Function("url", "return import(url)") as (url: string) => Promise<unknown>;

const readText = (path: string) => readFile(path, "utf8").catch(() => undefined);

const formatBytes = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} kB`;
export { listOriginals, type Original } from "./originals.ts";
