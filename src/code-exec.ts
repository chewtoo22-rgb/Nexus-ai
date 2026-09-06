import { getSandbox } from "@cloudflare/sandbox";

export interface CodeResult { stdout: string; stderr: string; exitCode: number; output?: any; }

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

export async function runCodeTool(args: { code: string; language: string }, env: any, sessionId: string): Promise<{ result: string; artifact?: any }> {
  const lang = (args.language || "python") as "python" | "javascript" | "typescript";
  const result = await runCode(env, args.code, lang, sessionId);
  const output = result.stdout + (result.stderr ? `\n\nErrors:\n${result.stderr}` : "");
  return { result: output || "Code executed (no output).", artifact: { type: "code", title: `Code (${lang})`, content: `// ${lang}\n${args.code}\n\n// Output:\n${output}`, language: lang } };
}
