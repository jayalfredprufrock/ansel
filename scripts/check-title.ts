// Checks a PR title (CI) or commit subject (commit-msg hook).
// Usage: node scripts/check-title.ts "<title>"  |  node scripts/check-title.ts --file <path>
import { readFileSync } from "node:fs";

const TYPES = "feat|fix|perf|refactor|docs|style|test|build|ci|chore|revert";
const SCOPES = "url|vite|astro|react|cdk|examples|repo|deps";
const PATTERN = new RegExp(`^(${TYPES})\\((${SCOPES})\\)!?: \\S.*$`);

const [flag, value] = process.argv.slice(2);
const raw = flag === "--file" ? readFileSync(value ?? "", "utf8") : (flag ?? "");
const title = raw.split("\n")[0]?.trim() ?? "";

if (!PATTERN.test(title) && !/^(Merge|Revert) /.test(title)) {
  console.error(`Invalid title: "${title}"
Expected: <type>(<scope>)[!]: <summary> [release]
  types:  ${TYPES.replaceAll("|", ", ")}
  scopes: ${SCOPES.replaceAll("|", ", ")}
  e.g.    feat(vite): add image manifest [release]`);
  process.exit(1);
}
