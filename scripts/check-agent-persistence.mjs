import { readFileSync } from "node:fs";

const source = readFileSync("src/agents.ts", "utf8");
const insertPattern = /INSERT INTO messages \(id, conversation_id, role, content, model, agent_type, tokens_in, tokens_out, latency_ms, artifacts\)/;
const bindPattern = /agentType, 0, 0, 0, null\)\.run\(\)/;

const failures = [];
if (!insertPattern.test(source)) failures.push("user-message INSERT was not found");
if (!bindPattern.test(source)) failures.push("user-message INSERT is missing the artifacts bind value");

if (failures.length) {
  console.error("Agent persistence regression detected:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Agent persistence checks passed.");
