import { readFileSync } from "node:fs";

const source = readFileSync("src/index.ts", "utf8");
const requiredProtectedPrefixes = [
  "/api/documents",
  "/api/ingest",
  "/api/plugins",
  "/api/tools/execute",
];
const ragRoutes = ["/api/search", "/api/ai-search"];

const authPrefixMatch = source.match(/const AUTH_PREFIXES\s*=\s*\[([\s\S]*?)\];/);
if (!authPrefixMatch) {
  console.error("Unable to locate AUTH_PREFIXES in src/index.ts");
  process.exit(1);
}

const authBlock = authPrefixMatch[1];
const missingPrefixes = requiredProtectedPrefixes.filter((prefix) => !authBlock.includes(`\"${prefix}\"`));
if (missingPrefixes.length) {
  console.error("Sensitive routes are missing from the shared auth gate:");
  for (const route of missingPrefixes) console.error(`- ${route}`);
  process.exit(1);
}

// handleApi currently authenticates every API request before dispatching routes.
// Accept that centralized guard for RAG routes, while still failing if the
// implementation is weakened or removed.
const handleApiAuth = /async function handleApi\([\s\S]*?\{\s*\n?\s*const session = await authenticateRequest\(request, env\);/.test(source);
if (!handleApiAuth) {
  console.error("RAG route protection is not centralized in handleApi.");
  console.error(`Add ${ragRoutes.join(" and ")} to AUTH_PREFIXES or restore the unconditional handleApi authentication gate.`);
  process.exit(1);
}

console.log("Security route guard passed.");
