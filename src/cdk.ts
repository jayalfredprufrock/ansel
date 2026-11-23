import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssetHashType, DockerImage, Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import type * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface ImageOptimizerProps {
  /** Bucket holding the originals. */
  bucket: s3.IBucket;
  /** Key prefix of the originals. Default: `images/`. */
  prefix?: string;
  /** Default: 2048 (more memory is also more CPU, and AVIF encoding is CPU-bound). */
  memorySize?: number;
  /** Default: 15 seconds. */
  timeout?: Duration;
  /**
   * Hard ceiling on concurrent encodes, and so on what a flood of uncached requests can cost.
   * Default: 20. `undefined` (explicitly) leaves it unreserved.
   */
  reservedConcurrency?: number | undefined;
  /** Refuse originals larger than this. Default: 25 MB. */
  maxOriginalBytes?: number;
  /** Refuse originals with more pixels than this. Default: 50 million. */
  maxPixels?: number;
}

const HANDLER_CANDIDATES = [
  // Published package: dist/cdk.mjs next to dist/optimizer/index.mjs.
  "./optimizer/index.mjs",
  // From source in this repo: run `vp pack` first.
  "../dist/optimizer/index.mjs",
];

function handlerFile(): string {
  for (const candidate of HANDLER_CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  throw new Error("ansel: the optimizer handler isn't built (run `vp pack` in the ansel package)");
}

/** The sharp version ansel itself uses, so production encodes like the dev server. */
function sharpVersion(): string {
  // sharp doesn't export its package.json: walk up from its entry point.
  let dir = dirname(createRequire(import.meta.url).resolve("sharp"));
  while (dir !== dirname(dir)) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version: string };
      if (pkg.name === "sharp") return pkg.version;
    }
    dir = dirname(dir);
  }
  throw new Error("ansel: couldn't find sharp's version");
}

/**
 * The image optimizer: a Lambda (arm64, Node.js 24) with a Function URL that only CloudFront may
 * call (`AWS_IAM` auth; put it behind origin access control). Serves `/_img/…` from originals in
 * `bucket` under `prefix`; see `optimizer.ts` for the URL and key format.
 *
 * Packaging needs no Docker: at synth time the handler is copied and sharp is installed for
 * linux-arm64 with `npm install --os=linux --cpu=arm64 --libc=glibc` (needs npm and network).
 */
export class ImageOptimizer extends Construct {
  readonly function: lambda.Function;
  readonly url: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ImageOptimizerProps) {
    super(scope, id);
    const handler = handlerFile();
    const sharp = sharpVersion();
    const hash = createHash("sha256")
      .update(readFileSync(handler))
      .update(`sharp@${sharp} linux-arm64-glibc`)
      .digest("hex");

    const code = lambda.Code.fromAsset(join(handler, ".."), {
      assetHashType: AssetHashType.CUSTOM,
      assetHash: hash,
      bundling: {
        // Required by the API; local bundling always succeeds, so Docker is never used.
        image: DockerImage.fromRegistry("public.ecr.aws/sam/build-nodejs24.x"),
        local: {
          tryBundle(outputDir: string) {
            copyFileSync(handler, join(outputDir, "index.mjs"));
            writeFileSync(
              join(outputDir, "package.json"),
              JSON.stringify({ private: true, type: "module" }),
            );
            execFileSync(
              "npm",
              [
                "install",
                `sharp@${sharp}`,
                "--os=linux",
                "--cpu=arm64",
                "--libc=glibc",
                "--ignore-scripts",
                "--no-save",
                "--no-package-lock",
                "--no-audit",
                "--no-fund",
              ],
              { cwd: outputDir, stdio: ["ignore", "ignore", "inherit"] },
            );
            return true;
          },
        },
      },
    });

    const prefix = props.prefix ?? "images/";
    this.function = new lambda.Function(this, "Function", {
      description: "ansel image optimizer",
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code,
      memorySize: props.memorySize ?? 2048,
      timeout: props.timeout ?? Duration.seconds(15),
      ...("reservedConcurrency" in props
        ? props.reservedConcurrency !== undefined && {
            reservedConcurrentExecutions: props.reservedConcurrency,
          }
        : { reservedConcurrentExecutions: 20 }),
      environment: {
        ANSEL_BUCKET: props.bucket.bucketName,
        ANSEL_PREFIX: prefix,
        ANSEL_MAX_BYTES: String(props.maxOriginalBytes ?? 25 * 1024 * 1024),
        ANSEL_MAX_PIXELS: String(props.maxPixels ?? 50_000_000),
        // Without it, sharp on glibc Linux (Lambda) uses one thread, to limit memory
        // fragmentation; with it, every core (AVIF encoding scales almost linearly). Each
        // invocation encodes one image, so two arenas are plenty.
        MALLOC_ARENA_MAX: "2",
      },
    });
    props.bucket.grantRead(this.function, `${prefix}*`);
    this.url = this.function.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });
  }
}
