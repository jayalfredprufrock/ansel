import { describe, expect, it } from "vite-plus/test";
import {
  buildImageUrl,
  outputSize,
  parseImageUrl,
  snapWidth,
  type ImageVariant,
} from "../src/url.ts";

const variant: ImageVariant = {
  hash: "3f9a2c1b7e04",
  name: "dr-patel",
  width: 1280,
  ratio: "4:3",
  quality: "standard",
  format: "avif",
};

describe("snapWidth", () => {
  it("snaps up to the next step", () => {
    expect(snapWidth(1)).toBe(320);
    expect(snapWidth(320)).toBe(320);
    expect(snapWidth(321)).toBe(480);
    expect(snapWidth(1200)).toBe(1280);
  });
  it("caps at the largest step", () => {
    expect(snapWidth(5000)).toBe(2560);
  });
});

describe("buildImageUrl", () => {
  it("builds a cropped URL", () => {
    expect(buildImageUrl(variant)).toBe("/_img/3f9a2c1b7e04/w1280-r4x3-q75/dr-patel.avif");
  });
  it("omits the ratio to keep the original's", () => {
    expect(buildImageUrl({ ...variant, ratio: undefined, quality: "low", format: "webp" })).toBe(
      "/_img/3f9a2c1b7e04/w1280-q55/dr-patel.webp",
    );
  });
  it("rejects values outside the fixed lists", () => {
    expect(() => buildImageUrl({ ...variant, width: 1200 as never })).toThrow("width");
    expect(() => buildImageUrl({ ...variant, hash: "XYZ" })).toThrow("hash");
    expect(() => buildImageUrl({ ...variant, name: "Dr Patel" })).toThrow("name");
  });
});

describe("parseImageUrl", () => {
  it("round-trips", () => {
    expect(parseImageUrl(buildImageUrl(variant))).toEqual(variant);
    const original = { ...variant, ratio: undefined };
    expect(parseImageUrl(buildImageUrl(original))).toEqual(original);
  });
  it.each([
    "/_img/3f9a2c1b7e04/w1200-r4x3-q75/dr-patel.avif", // width not a step
    "/_img/3f9a2c1b7e04/w1280-r5x4-q75/dr-patel.avif", // unknown ratio
    "/_img/3f9a2c1b7e04/w1280-r4x3-q80/dr-patel.avif", // unknown quality
    "/_img/3f9a2c1b7e04/w1280-r4x3-q75/dr-patel.png", // unknown format
    "/_img/3F9A2C1B7E04/w1280-r4x3-q75/dr-patel.avif", // uppercase hash
    "/_img/3f9a2c1b7e04/w1280-r4x3-q75/Dr_Patel.avif", // bad name
    "/_img/3f9a2c1b7e04/w1280-r4x3-q75/dr-patel.avif?x=1", // query string
    "/_img/3f9a2c1b7e04/w01280-r4x3-q75/dr-patel.avif", // padded number
    "/_img/3f9a2c1b7e04/w1280-r4x3-q75/team/dr-patel.avif", // extra segment
  ])("rejects %s", (path) => {
    expect(parseImageUrl(path)).toBeUndefined();
  });
});

describe("outputSize", () => {
  const original = { width: 3000, height: 2000 };
  it("keeps the original's ratio", () => {
    expect(outputSize({ width: 1280 }, original)).toEqual({ width: 1280, height: 853 });
  });
  it("crops to the ratio", () => {
    expect(outputSize({ width: 1280, ratio: "1:1" }, original)).toEqual({
      width: 1280,
      height: 1280,
    });
  });
  it("never upscales", () => {
    expect(outputSize({ width: 2560, ratio: "1:1" }, original)).toEqual({
      width: 2000,
      height: 2000,
    });
    expect(outputSize({ width: 2560 }, { width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    });
  });
});
