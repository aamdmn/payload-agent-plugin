import type { ChatMiddleware } from "@tanstack/ai";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function indent(text: string, spaces = 4): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function truncate(text: string, max = 500): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}${DIM}... (${text.length - max} more chars)${RESET}`;
}

export const loggingMiddleware: ChatMiddleware = {
  name: "payload-agent-logger",

  onStart(ctx) {
    const line = `${BOLD}${CYAN}[agent]${RESET} Chat started ${DIM}(${ctx.provider}/${ctx.model}, ${ctx.messageCount} messages)${RESET}`;
    process.stdout.write(`${line}\n`);
  },

  onIteration(_ctx, info) {
    const line = `${CYAN}[agent]${RESET} ${DIM}--- iteration ${info.iteration} ---${RESET}`;
    process.stdout.write(`${line}\n`);
  },

  onBeforeToolCall(_ctx, hookCtx) {
    const header = `${YELLOW}[tool]${RESET} ${BOLD}${hookCtx.toolName}${RESET} called`;
    process.stdout.write(`${header}\n`);

    if (
      hookCtx.toolName === "execute_typescript" &&
      hookCtx.args &&
      typeof hookCtx.args === "object" &&
      "typescriptCode" in hookCtx.args
    ) {
      const code = String(
        (hookCtx.args as { typescriptCode: string }).typescriptCode
      );
      process.stdout.write(`${DIM}${indent(code)}${RESET}\n`);
    } else if (hookCtx.args !== undefined) {
      const argsStr = JSON.stringify(hookCtx.args, null, 2);
      process.stdout.write(`${DIM}${indent(truncate(argsStr))}${RESET}\n`);
    }
  },

  onAfterToolCall(_ctx, info) {
    if (info.ok) {
      const resultStr = JSON.stringify(info.result, null, 2);
      const line = `${GREEN}[tool]${RESET} ${info.toolName} ${DIM}(${info.duration}ms)${RESET}`;
      process.stdout.write(`${line}\n`);
      process.stdout.write(`${DIM}${indent(truncate(resultStr))}${RESET}\n`);
    } else {
      const errMsg =
        info.error instanceof Error ? info.error.message : String(info.error);
      const line = `${RED}[tool]${RESET} ${info.toolName} failed ${DIM}(${info.duration}ms)${RESET}: ${errMsg}`;
      process.stdout.write(`${line}\n`);
    }
  },

  onUsage(_ctx, usage) {
    const line = `${DIM}[usage] ${usage.promptTokens} prompt + ${usage.completionTokens} completion = ${usage.totalTokens} tokens${RESET}`;
    process.stdout.write(`${line}\n`);
  },

  onFinish(_ctx, info) {
    const response = truncate(info.content, 200);
    const line = `${BOLD}${GREEN}[agent]${RESET} Done ${DIM}(${info.duration}ms)${RESET}`;
    process.stdout.write(`${line}\n`);
    process.stdout.write(`${DIM}${indent(response)}${RESET}\n`);
  },

  onError(_ctx, info) {
    const errMsg =
      info.error instanceof Error ? info.error.message : String(info.error);
    const line = `${BOLD}${RED}[agent]${RESET} Error ${DIM}(${info.duration}ms)${RESET}: ${errMsg}`;
    process.stdout.write(`${line}\n`);
  },
};
