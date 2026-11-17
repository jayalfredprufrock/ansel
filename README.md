# ansel

Responsive images for Vite, Astro and React, built around an image optimizer you host yourself.

> **Status:** pre-1.0. The Vite plugin and `<Img>` for Astro and React work. The optimizer (an AWS CDK construct) is not built yet: the dev server serves images locally, but production builds produce `/_img/…` URLs that nothing serves until it ships. Minor versions may include breaking changes until 1.0.

## What it does

- **Typed image names.** Source images live in your repo. Image names are TypeScript types, so a misspelled name fails the type check.
- **Required alt text.** Every image a project uses is listed in `images.ts` with alt text, or with `decorative: true`.
- **`<Img>` for Astro and React.** `srcset` and `sizes` from fixed width steps, AVIF with WebP fallback, aspect ratio presets cropped around the image's focal point, and a placeholder inlined as a data URI. No JavaScript, and it works under a strict Content Security Policy.
- **A committed manifest.** The Vite plugin records each image's size, focal point, tiny preview and dominant color in `manifest.json`, so builds read it instead of decoding images. In CI, a stale manifest fails the build.
- **One URL format** (`/_img/…`) shared by the components, the dev server and the optimizer. Only fixed widths, ratios, formats and quality levels exist, so the number of variants stays small and URLs can't be invented.
- **Optional checks**, all off by default: reject camera or stock file names, GPS data, large files or huge images.

## Setup

```sh
pnpm add @jayalfredprufrock/ansel
```

Add the Vite plugin. In Astro:

```ts
// astro.config.ts
import { ansel } from "@jayalfredprufrock/ansel/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: { plugins: [ansel()] },
});
```

Put images in `src/images/`, in any subfolder. File names use lowercase letters, digits and dashes (`team/dr-patel.jpg`); the name is the path without the extension (`team/dr-patel`). Formats: JPEG, PNG, WebP and AVIF.

List the images you use in `src/images/images.ts` (the plugin creates a starter file):

```ts
import { defineImages } from "@jayalfredprufrock/ansel";

export default defineImages({
  "team/dr-patel": { alt: "Dr. Patel smiling in the exam room" },
  "office/pattern": { decorative: true },
  // Override the detected focal point (percentages from the top left):
  "office/waiting-room": { alt: "The waiting room", focal: [30, 60] },
});
```

The plugin writes `manifest.json` and `types.d.ts` next to it. Commit all three.

## Usage

Astro:

```astro
---
import Img from "@jayalfredprufrock/ansel/Img.astro";
---

<Img name="team/dr-patel" priority />
<Img name="team/dr-patel" ratio="1:1" sizes="20rem" />
```

React:

```tsx
import "@jayalfredprufrock/ansel/styles.css"; // once, in your entry
import { Img } from "@jayalfredprufrock/ansel/react";
import drPatel from "./images/team/dr-patel.jpg?ansel";

<Img image={drPatel} ratio="4:3" sizes="(min-width: 40rem) 40rem, 100vw" />;
```

React bundles include only the images a module imports.

### Props

| Prop          | Default                                | What it does                                                                         |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `sizes`       | `100vw`                                | How wide the image is shown. Set it for anything narrower than the viewport.         |
| `ratio`       | original                               | `1:1`, `4:3`, `3:4`, `3:2`, `2:3`, `16:9` or `21:9`, cropped around the focal point. |
| `priority`    | `false`                                | Load right away with high priority. Use it for the main image above the fold.        |
| `placeholder` | `blur` (`none` for transparent images) | `blur`, `pixelated`, `color` or `none`.                                              |
| `quality`     | `standard`                             | `low`, `standard` or `high`.                                                         |
| `alt`         | from `images.ts`                       | Overrides the alt text for this use.                                                 |

Images load lazily unless `priority` is set. Styles live in `@layer ansel`, so your own CSS wins.

## Plugin options

| Option            | Default                              | What it does                                                                      |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `dir`             | `src/images`                         | Folder of source images, relative to the Vite root.                               |
| `manifest`        | `check` if `CI` is set, else `write` | `write` updates the manifest and types; `check` fails the build if they're stale. |
| `rejectPoorNames` | `false`                              | Reject camera and stock names (`IMG_4821`, `DSC01234`, `pexels-photo-…`).         |
| `rejectGps`       | `false`                              | Reject images that still carry GPS location data.                                 |
| `maxFileSize`     | none                                 | Reject files larger than this many bytes.                                         |
| `maxPixels`       | none                                 | Reject images with more than this many pixels.                                    |

Problems are warnings in dev and fail the build.

## Exports

| Import                                | What it is                                 |
| ------------------------------------- | ------------------------------------------ |
| `@jayalfredprufrock/ansel`            | `defineImages` and types                   |
| `@jayalfredprufrock/ansel/vite`       | Vite plugin                                |
| `@jayalfredprufrock/ansel/Img.astro`  | `<Img>` for Astro                          |
| `@jayalfredprufrock/ansel/react`      | `<Img>` for React                          |
| `@jayalfredprufrock/ansel/styles.css` | Styles (Astro's `<Img>` includes them)     |
| `@jayalfredprufrock/ansel/url`        | URL format: building and parsing `/_img/…` |

## Requirements

Node 22.18 or newer, Vite 8, and Astro 7 or React 19.

## License

MIT
