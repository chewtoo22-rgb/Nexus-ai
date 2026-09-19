import { readFileSync } from "node:fs";

const source = readFileSync("src/agents.ts", "utf8");
const checks = [
  {
    name: "user-message persistence bind count",
    pattern: /INSERT INTO messages \(id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts\)[\s\S]*?role, content, model, agentType, 0, 0, 0, null\)\.run\(\)/,
    message: "The user-message INSERT must bind 9 values, including the artifacts column.",
  },
];

const failures = checks.filter((check) => check.pattern.test(source));
if (failures.length) {
  console.error("Agent persistence regression detected:");
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exit(1);
}

console.log("Agent persistence checks passed.");
