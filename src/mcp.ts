/**
 * lockdrift MCP server. Tool: check_lockfile.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCheck, VERSION } from "./core.js";

const server = new McpServer({ name: "lockdrift", version: VERSION });

server.tool(
  "check_lockfile",
  "Check a package.json against its package-lock.json: dependencies with no lock entry, locked versions that do not satisfy the declared range (exact, caret, tilde, and >= ranges), packages locked but not declared, and a missing or unparsable lockfile. Verdict IN-SYNC or DRIFT with per-dependency evidence.",
  {
    path: z.string().describe("Target path to check"),
  },
  async ({ path }) => {
    const report = runCheck(path);
    return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
