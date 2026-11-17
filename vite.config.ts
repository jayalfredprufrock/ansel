import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: {
      index: "src/index.ts",
      url: "src/url.ts",
      vite: "src/vite.ts",
      react: "src/react.tsx",
      render: "src/render.ts",
    },
    format: ["esm"],
    dts: true,
    platform: "node",
  },
  fmt: {
    printWidth: 100,
    astro: true,
    // Written by the plugin; formatting them would make the manifest check fail.
    ignorePatterns: ["**/images/manifest.json", "**/images/types.d.ts"],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/images/types.d.ts"],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
