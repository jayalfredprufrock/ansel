// Types for `?ansel` imports. Referenced by the generated `types.d.ts`.
declare module "*?ansel" {
  const image: import("@jayalfredprufrock/ansel").AnselImage;
  export default image;
}

declare module "virtual:ansel" {
  export const images: Record<string, import("@jayalfredprufrock/ansel").AnselImage>;
}
