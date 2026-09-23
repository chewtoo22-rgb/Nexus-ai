import { readFileSync } from "node:fs";

const source = readFileSync("src/index.ts", "utf8");
const requiredProtectedPrefixes = [
  "/api/documents",
  "/api/ingest",
  "/api/plugins",
  "/api/tools/execute",
  "/api/search",
  "/api/ai-search",
];

const authPrefixMatch = source.match(/const AUTH_PREFIXES\s*=\s*\[([\s\S]*?)\];/);
if (!authPrefixMatch) {
  console.error("Unable to locate AUTH_PREFIXES in src/index.ts");
  process.exit(1);
}

const authBlock = authPrefixMatch[1];
const missing = requiredProtectedPrefixes.filter((prefix) => !authBlock.includes(`\"${prefix}\"`));

if (missing.length) {
  console.error("Sensitive routes are missing from the shared auth gate:");
  for (const route of missing) console.error(`- ${route}`);
  console.error("Refusing to pass smoke validation until these data-plane routes are protected.");
  process.exit(1);
}

console.log("Security route guard passed.");
