import { getSandbox } from "@cloudflare/sandbox";

export interface CodeResult { stdout: string; stderr: string; exitCode: number; output?: any; }

/**
 * Executes code in a sandboxed environment using Cloudflare Sandbox.
 * @param env Environment bindings
 * @param code Source code to execute
 * @param language Programming language (python, javascript, or typescript)
 * @param sessionId User session ID for sandbox isolation
 * @returns Execution result with stdout, stderr, and exit code
 */
export async function runCode(env: any, code: string, language: "python" | "javascript" | "typescript", sessionId: string): Promise<CodeResult> {
  const sandbox = getSandbox(env.SANDBOX, sessionId);
  try {
    const ctx = await sandbox.createCodeContext({ language });
    const execution = await sandbox.runCode(code, { context: ctx });
    return {
      stdout: execution.logs.stdout.join("\n"),
      stderr: execution.logs.stderr.join("\n"),
      exitCode: execution.error ? 1 : 0,
      output: execution.results,
    };
  } catch (err) { return { stdout: "", stderr: String(err), exitCode: 1 }; }
}

/**
 * Tool wrapper for code execution that formats results and creates an artifact.
 * @param args Tool arguments containing code and language
 * @param env Environment bindings
 * @param sessionId User session ID for sandbox isolation
 * @returns Formatted result string and code artifact
 */
export async function runCodeTool(args: { code: string; language: string }, env: any, sessionId: string): Promise<{ result: string; artifact?: any }> {
  const lang = (args.language || "python") as "python" | "javascript" | "typescript";
  const result = await runCode(env, args.code, lang, sessionId);
  const output = result.stdout + (result.stderr ? `\n\nErrors:\n${result.stderr}` : "");
  return { result: output || "Code executed (no output).", artifact: { type: "code", title: `Code (${lang})`, content: `// ${lang}\n${args.code}\n\n// Output:\n${output}`, language: lang } };
}
