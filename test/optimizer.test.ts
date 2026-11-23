import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vite-plus/test";
import { analyzeImage, serializeManifest, urlHash } from "../src/manifest.ts";
import { optimize, originalKey, parseFocal, parseOptimizerPath } from "../src/optimizer.ts";
import { listOriginals } from "../src/originals.ts";

const HASH = "3f9a2c1b7e04";
const PATH = `/_img/demo/${HASH}/w640-r4x3-q75/dr-patel.avif`;

const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: "#777" } })
    .jpeg()
    .toBuffer();

describe("optimizer paths", () => {
  it("parses scoped and unscoped paths and builds the original's key", () => {
    const scoped = parseOptimizerPath(PATH);
    expect(scoped?.scope).toEqual(["demo"]);
    expect(originalKey("images/", scoped!)).toBe(`images/demo/${HASH}/dr-patel`);
    expect(parseOptimizerPath(`/_img/${HASH}/w640-q75/dr-patel.webp`)?.scope).toEqual([]);
  });

  it("refuses anything a build couldn't produce", () => {
    for (const path of [
      `/_img/demo/${HASH}/w641-q75/dr-patel.avif`, // not a width step
      `/_img/Demo/${HASH}/w640-q75/dr-patel.avif`, // bad scope
      `/_img/../${HASH}/w640-q75/dr-patel.avif`,
      `/_img/a/b/c/d/${HASH}/w640-q75/dr-patel.avif`, // too deep
      `/_img/demo/${HASH}/w640-q75/dr-patel.png`,
      `/other/${HASH}/w640-q75/dr-patel.avif`,
    ]) {
      expect(parseOptimizerPath(path), path).toBeUndefined();
    }
  });

  it("reads focal metadata, falling back to the center", () => {
    expect(parseFocal("34,47")).toEqual([34, 47]);
    expect(parseFocal(undefined)).toEqual([50, 50]);
    expect(parseFocal("150,2")).toEqual([50, 50]);
    expect(parseFocal("a,b")).toEqual([50, 50]);
  });
});

describe("optimize", () => {
  it("encodes a variant and caches it for a year", async () => {
    const bytes = await photo();
    const keys: string[] = [];
    const response = await optimize(PATH, {
      prefix: "images/",
      load: async (key) => {
        keys.push(key);
        return { bytes, focal: [50, 50] };
      },
    });
    expect(keys).toEqual([`images/demo/${HASH}/dr-patel`]);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/avif");
    expect(response.headers["cache-control"]).toContain("immutable");
    const meta = await sharp(Buffer.from(response.body, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([640, 480]);
  });

  it("404s invented URLs and missing originals without loading anything for bad paths", async () => {
    let loads = 0;
    const load = async () => {
      loads++;
      return undefined;
    };
    expect((await optimize("/_img/nope", { prefix: "", load })).statusCode).toBe(404);
    expect(loads).toBe(0);
    expect((await optimize(PATH, { prefix: "", load })).statusCode).toBe(404);
    expect(loads).toBe(1);
  });

  it("refuses originals over the pixel limit", async () => {
    const bytes = await photo();
    await expect(
      optimize(PATH, {
        prefix: "",
        load: async () => ({ bytes, focal: [50, 50] }),
        maxPixels: 1000,
      }),
    ).rejects.toThrow();
  });
});

describe("listOriginals", () => {
  it("lists images with an images.ts entry, with the effective focal point", async () => {
    const root = await mkdtemp(join(tmpdir(), "ansel-originals-"));
    const dir = join(root, "src/images");
    await mkdir(join(dir, "team"), { recursive: true });
    const file = join(dir, "team/dr-patel.jpg");
    const bytes = await photo();
    await writeFile(file, bytes);
    await writeFile(join(dir, "unused.jpg"), bytes);
    const entry = await analyzeImage("team/dr-patel.jpg", bytes);
    await writeFile(
      join(dir, "manifest.json"),
      serializeManifest({
        version: 1,
        images: { "team/dr-patel": entry, unused: { ...entry, file: "unused.jpg" } },
      }),
    );
    await writeFile(
      join(dir, "images.ts"),
      'export default { "team/dr-patel": { alt: "Dr. Patel", focal: [30, 40] } };\n',
    );
    expect(await listOriginals(root)).toEqual([
      {
        name: "team/dr-patel",
        hash: urlHash(entry.content, [30, 40]),
        slug: "dr-patel",
        file,
        focal: [30, 40],
      },
    ]);
  });
});
