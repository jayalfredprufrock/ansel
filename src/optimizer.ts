/**
 * The optimizer: an AWS Lambda behind CloudFront (Function URL with origin access control) that
 * turns `/_img/…` URLs into image variants, with the same output as the dev server. Deployed by
 * the `/cdk` construct, which bundles this file on its own (sharp installed for Linux; the AWS SDK
 * comes with the Lambda runtime).
 *
 * Requests: `/_img/[<scope>/…]<hash>/w<width>[-r<w>x<h>]-q<quality>/<slug>.<format>`. Optional
 * scope segments (e.g. a site ID inserted by a CloudFront function) select a folder of originals:
 * the original is `<prefix><scope…>/<hash>/<slug>`, with its focal point in the object's `focal`
 * metadata (`"x,y"`). A URL that doesn't parse or has no original is a 404, so nothing in it can be
 * invented: the hash and slug must match an upload and the rest comes from fixed lists.
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Focal } from "./index.ts";
import { transformImage } from "./transform.ts";
import { IMAGE_PATH_PREFIX, parseImageUrl, type ImageVariant } from "./url.ts";

const SCOPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SCOPE_DEPTH = 3;
const ONE_YEAR = "public, max-age=31536000, immutable";

export interface OptimizerRequest {
  /** Folders between `/_img/` and the hash. */
  scope: string[];
  variant: ImageVariant;
}

/** Parses an optimizer path; `undefined` for anything a build couldn't have produced. */
export function parseOptimizerPath(path: string): OptimizerRequest | undefined {
  if (!path.startsWith(IMAGE_PATH_PREFIX)) return undefined;
  const segments = path.slice(IMAGE_PATH_PREFIX.length).split("/");
  // hash, variant and file name are the last three; anything before is the scope.
  const scope = segments.slice(0, -3);
  if (scope.length > MAX_SCOPE_DEPTH || !scope.every((s) => SCOPE.test(s))) return undefined;
  const variant = parseImageUrl(IMAGE_PATH_PREFIX + segments.slice(-3).join("/"));
  return variant && { scope, variant };
}

/** Where the original for `request` is stored. */
export const originalKey = (prefix: string, { scope, variant }: OptimizerRequest): string =>
  `${prefix}${[...scope, variant.hash, variant.name].join("/")}`;

/** Reads `"x,y"` focal metadata; the center when missing or invalid. */
export function parseFocal(value: string | undefined): Focal {
  const [x, y] = (value ?? "").split(",").map(Number);
  const ok = (n: number | undefined): n is number =>
    n !== undefined && Number.isInteger(n) && n >= 0 && n <= 100;
  return ok(x) && ok(y) ? [x, y] : [50, 50];
}

export interface Original {
  bytes: Uint8Array;
  focal: Focal;
}

export interface OptimizerOptions {
  /** Loads an original by key; `undefined` when it doesn't exist. */
  load: (key: string) => Promise<Original | undefined>;
  /** Key prefix of the originals, e.g. `images/`. */
  prefix: string;
  maxPixels?: number;
}

export interface OptimizerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

const notFound = (): OptimizerResponse => ({
  statusCode: 404,
  // Briefly: a deploy uploads originals before its pages reference them.
  headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" },
  body: "Not found",
  isBase64Encoded: false,
});

/** Handles one request path. Exported for tests and custom handlers. */
export async function optimize(
  path: string,
  options: OptimizerOptions,
): Promise<OptimizerResponse> {
  const request = parseOptimizerPath(path);
  if (!request) return notFound();
  const original = await options.load(originalKey(options.prefix, request));
  if (!original) return notFound();
  const output = await transformImage(
    original.bytes,
    request.variant,
    original.focal,
    options.maxPixels,
  );
  return {
    statusCode: 200,
    headers: { "content-type": `image/${request.variant.format}`, "cache-control": ONE_YEAR },
    body: output.toString("base64"),
    isBase64Encoded: true,
  };
}

const s3 = new S3Client({});

/** Loads originals from `ANSEL_BUCKET`, refusing files over `ANSEL_MAX_BYTES`. */
async function loadFromS3(key: string): Promise<Original | undefined> {
  const maxBytes = Number(process.env.ANSEL_MAX_BYTES ?? 0);
  try {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: process.env.ANSEL_BUCKET, Key: key }),
    );
    if (maxBytes && (object.ContentLength ?? 0) > maxBytes) {
      console.warn(JSON.stringify({ message: "Original over the size limit", key }));
      return undefined;
    }
    return {
      bytes: await object.Body!.transformToByteArray(),
      focal: parseFocal(object.Metadata?.focal),
    };
  } catch (error) {
    const name = (error as Error).name;
    // Without s3:ListBucket a missing key is AccessDenied rather than NoSuchKey.
    if (name === "NoSuchKey" || name === "AccessDenied") return undefined;
    throw error;
  }
}

/** Lambda handler (Function URL event). */
export async function handler(event: { rawPath: string }): Promise<OptimizerResponse> {
  return optimize(event.rawPath, {
    load: loadFromS3,
    prefix: process.env.ANSEL_PREFIX ?? "",
    maxPixels: Number(process.env.ANSEL_MAX_PIXELS ?? 0) || undefined,
  });
}
