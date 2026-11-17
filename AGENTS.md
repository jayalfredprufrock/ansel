# AGENTS.md

`@jayalfredprufrock/ansel`: responsive images for Vite, Astro and React. Public package, published to npm.

## Layout

- `src/index.ts` (root export): `defineImages`, the shared types, and the registries the generated `types.d.ts` fills in.
- `src/url.ts`: the shared image URL format, snapping rules and crop math. Used by the components, the dev server and the optimizer; never duplicate its rules elsewhere.
- `src/manifest.ts`: scanning the images folder and building manifest entries (size, focal point, preview, color, transparency, GPS, embedded metadata).
- `src/vite.ts`: the Vite plugin. Keeps `manifest.json` and `types.d.ts` up to date (`write`) or verifies them (`check`, default in CI), loads `images.ts`, runs the optional checks, provides `virtual:ansel` (all images, for Astro on the server) and `?ansel` imports (one image, for React), and serves `/_img/*` in dev. It reads source images and never rewrites them.
- `src/transform.ts`: produces one variant with sharp. Shared by the dev server and the optimizer.
- `src/render.ts`: the markup `<Img>` renders, shared by `src/astro/Img.astro` (shipped as source) and `src/react.tsx`. `src/styles.css`: placeholder styles in `@layer ansel`.
- `src/client.d.ts`: types for `?ansel` and `virtual:ansel`, referenced by the generated `types.d.ts`.
- `examples/astro`, `examples/react`: small apps that use the package from source; CI builds both.
- Planned: `src/cdk.ts` (`/cdk` export, the optimizer construct; `aws-cdk-lib` and `constructs` as optional peers).

## Commands

- `vp run ci`: everything CI runs (format, lint, types, tests, package build, astro check, example builds).
- `vp check --fix`: format and lint. `vp test`: unit tests. `vp pack`: build `dist`.
- In an example: `pnpm dev`, `pnpm build`.

## Rules

- **Commits / PR titles:** `<type>(<scope>)[!]: <summary>`, e.g. `feat(vite): add image manifest`. Scopes: url, vite, astro, react, cdk, examples, repo, deps. Add `[release]` to publish; it always publishes (`feat` → minor, any other type → patch). **Pre-1.0:** `!`/`BREAKING CHANGE` → minor too (0.x semver). At 1.0, set the breaking rule in `package.json` `release` back to `major` and release a `!` commit. PRs are squash-merged; the PR title becomes the commit.
- **Versions** are set by semantic-release in CI. Never edit `version`.
- **Dependencies:** keep them few. Framework packages (`astro`, `react`, `vite`) are optional peers. At the root, `vite` must stay aliased to vite-plus's core (the pnpm catalog), or `vp` refuses to run. The examples use real Vite, and their tsconfig `paths` point the package's `vite` types at it.
- **Components:** no inline `style` attributes and no client JavaScript; output must work under a strict CSP (`img-src 'self' data:`).
- **TypeScript 6** for now (`astro check` doesn't support 7 yet). Relative imports use explicit `.ts` extensions.
