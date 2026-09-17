import { readFileSync } from "node:fs";

const files = ["src/index.ts", "src/agents.ts"];
const forbidden = [
  /body\.model\s*\|\|/,
  /model\s*\|\|\s*agent\.models\.primary/,
];

const violations = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) violations.push(`${file}: ${pattern}`);
  }
}

if (violations.length) {
  console.error("Unsafe direct model selection detected:");
  for (const violation of violations) console.error(`- ${violation}`);
  console.error("Route chat requests through src/model-router.ts before merging.");
  process.exit(1);
}

console.log("Model routing guard passed.");
