import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: [
    {
      entry: {
        index: "src/index.ts",
        url: "src/url.ts",
        vite: "src/vite.ts",
        react: "src/react.tsx",
        render: "src/render.ts",
        cdk: "src/cdk.ts",
      },
      format: ["esm"],
      dts: true,
      platform: "node",
    },
    // The optimizer Lambda's code: one self-contained file the `/cdk` construct copies into its
    // asset (sharp is installed next to it for Linux; the Lambda runtime provides the AWS SDK).
    {
      entry: { "optimizer/index": "src/optimizer.ts" },
      format: ["esm"],
      platform: "node",
      dts: false,
      external: [/^@aws-sdk\//, "sharp"],
      noExternal: [/^(?!@aws-sdk\/|sharp$)/],
      clean: false,
    },
  ],
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
