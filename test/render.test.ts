import { describe, expect, it } from "vite-plus/test";
import type { AnselImage } from "../src/index.ts";
import { imgMarkup } from "../src/render.ts";

const image: AnselImage = {
  name: "team/dr-patel",
  hash: "1ae466d311d9",
  slug: "dr-patel",
  width: 1000,
  height: 800,
  focal: [50, 50],
  preview: "data:image/webp;base64,AAAA",
  color: "#48a868",
  alpha: false,
  alt: "Dr. Patel",
  decorative: false,
};

describe("imgMarkup", () => {
  it("offers steps up to the first that reaches the original, with real widths", () => {
    const { img, sources } = imgMarkup(image);
    expect(img.srcset.split(", ").map((s) => s.split(" ")[1])).toEqual([
      "320w",
      "480w",
      "640w",
      "800w",
      "960w",
      "1000w",
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe("image/avif");
    expect(img).toMatchObject({ width: 1000, height: 800, alt: "Dr. Patel", loading: "lazy" });
    expect(img.src).toBe("/_img/1ae466d311d9/w960-q75/dr-patel.webp");
  });
  it("crops to a ratio and limits widths to what the crop allows", () => {
    const { img } = imgMarkup(image, { ratio: "16:9" });
    expect(img).toMatchObject({ width: 1000, height: 563 });
    expect(img.srcset).toContain("-r16x9-q75/dr-patel.webp 1000w");
  });
  it("loads priority images eagerly", () => {
    expect(imgMarkup(image, { priority: true }).img).toMatchObject({
      loading: "eager",
      fetchpriority: "high",
    });
  });
  it("picks placeholders", () => {
    expect(imgMarkup(image).placeholderSrc).toBe(image.preview);
    expect(imgMarkup(image, { placeholder: "color" }).placeholderSrc).toMatch(/^data:image\/svg/);
    expect(imgMarkup({ ...image, alpha: true }).placeholder).toBe("none");
    expect(imgMarkup(image, { placeholder: "none" }).placeholderSrc).toBeUndefined();
  });
  it("uses empty alt for decorative images and allows overrides", () => {
    const decorative = { ...image, alt: undefined, decorative: true };
    expect(imgMarkup(decorative).img.alt).toBe("");
    expect(imgMarkup(image, { alt: "Our dentist" }).img.alt).toBe("Our dentist");
  });
});
