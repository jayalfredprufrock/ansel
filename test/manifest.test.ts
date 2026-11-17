import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  analyzeImage,
  isPoorName,
  scanImages,
  suggestName,
  syncManifest,
} from "../src/manifest.ts";

let dir: string;

/** A grey 1200×800 JPEG with a red square centered at (980, 180), optionally with metadata. */
async function photo(withMetadata = false): Promise<Buffer> {
  const square = await sharp({
    create: { width: 160, height: 160, channels: 3, background: "#f00" },
  })
    .png()
    .toBuffer();
  let image = sharp({ create: { width: 1200, height: 800, channels: 3, background: "#777" } })
    .composite([{ input: square, left: 900, top: 100 }])
    .jpeg();
  if (withMetadata) {
    image = image.withExif({
      IFD0: { ImageDescription: "A red square", Artist: "Jane Doe", Copyright: "(c) Jane Doe" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1" },
    });
  }
  return image.toBuffer();
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ansel-test-"));
  await mkdir(join(dir, "team"));
  await writeFile(join(dir, "team/dr-patel.jpg"), await photo(true));
  await writeFile(
    join(dir, "office.png"),
    await sharp(await photo())
      .png()
      .toBuffer(),
  );
  await writeFile(join(dir, "IMG 4821.JPG"), await photo());
  await writeFile(join(dir, "office.webp"), await photo());
  await writeFile(join(dir, "notes.txt"), "not an image");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scanImages", () => {
  it("finds images, derives names and reports unusable files", async () => {
    const { images, invalid } = await scanImages(dir);
    expect(images.map((i) => i.name)).toEqual(["office", "team/dr-patel"]);
    expect(invalid.map((i) => i.file).sort()).toEqual(["IMG 4821.JPG", "office.webp"]);
    const camera = invalid.find((i) => i.file === "IMG 4821.JPG");
    expect(camera?.reason).toContain('"img-4821.jpg"');
    expect(camera?.suggestion).toBe("img-4821");
  });
  it("treats a missing folder as empty", async () => {
    expect(await scanImages(join(dir, "missing"))).toEqual({ images: [], invalid: [] });
  });
});

describe("suggestName", () => {
  it("normalizes to lowercase, digits and dashes", () => {
    expect(suggestName("Team/Dr. Zoë Patel (Portrait)")).toBe("team/dr-zoe-patel-portrait");
  });
});

describe("isPoorName", () => {
  it("flags camera, stock and number-only names in the last segment", () => {
    for (const name of [
      "team/img-4821",
      "dsc01234",
      "pexels-photo-1234",
      "team/20240512",
      "x/unsplash",
    ])
      expect(isPoorName(name), name).toBe(true);
    for (const name of ["team/dr-patel", "img/waiting-room", "office/front-desk-2"])
      expect(isPoorName(name), name).toBe(false);
  });
});

describe("analyzeImage", () => {
  it("measures the image and finds the focal point, preview and metadata", async () => {
    const entry = await analyzeImage("x.jpg", await photo(true));
    expect(entry).toMatchObject({ width: 1200, height: 800, gps: true, color: "#787878" });
    expect(entry.embedded).toEqual({
      alt: "A red square",
      creator: "Jane Doe",
      copyright: "(c) Jane Doe",
    });
    expect(entry.focal[0]).toBeGreaterThanOrEqual(78);
    expect(entry.focal[0]).toBeLessThanOrEqual(85);
    expect(entry.focal[1]).toBeGreaterThanOrEqual(18);
    expect(entry.focal[1]).toBeLessThanOrEqual(26);
    expect(entry.preview).toMatch(/^data:image\/webp;base64,/);
    expect(entry.preview.length).toBeLessThan(600);
  });
  it("reports no GPS or metadata when there is none", async () => {
    const entry = await analyzeImage("x.jpg", await photo());
    expect(entry.gps).toBe(false);
    expect(entry.embedded).toEqual({});
  });
});

describe("syncManifest", () => {
  it("analyzes new files, reuses unchanged ones and follows renames", async () => {
    const first = await syncManifest(dir, undefined);
    expect(first.updated).toEqual(["office", "team/dr-patel"]);
    expect(Object.keys(first.manifest.images)).toEqual(["office", "team/dr-patel"]);

    const again = await syncManifest(dir, first.manifest);
    expect(again.updated).toEqual([]);
    expect(again.manifest).toEqual(first.manifest);

    await rename(join(dir, "team/dr-patel.jpg"), join(dir, "team/dr-lee.jpg"));
    const renamed = await syncManifest(dir, again.manifest);
    expect(renamed.updated).toEqual(["team/dr-lee"]);
    expect(renamed.removed).toEqual(["team/dr-patel"]);
    expect(renamed.manifest.images["team/dr-lee"]).toEqual({
      ...first.manifest.images["team/dr-patel"],
      file: "team/dr-lee.jpg",
    });
  });
});
