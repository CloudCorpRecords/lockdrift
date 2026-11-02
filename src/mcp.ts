/**
 * lockdrift MCP server. Tools: check_lockfile_drift.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod
 * still validates every tools/call argument set.
 *
 * The comparison is pure local computation: no upstream API, no
 * authentication, no configuration.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { checkLockfileDrift, formatPayload, VERSION } from "./lockdrift.js";

const CheckArgs = z.object({
  package_json: z.string(),
  lockfile_json: z.string(),
});

const TOOLS = [
  {
    name: "check_lockfile_drift",
    description:
      "Compare a package.json against its package-lock.json and report drift: declared dependencies missing from the lockfile, ranges that disagree, and locked packages no longer declared.",
    inputSchema: {
      type: "object" as const,
      properties: {
        package_json: {
          type: "string",
          description: "The package.json document, as a JSON string",
        },
        lockfile_json: {
          type: "string",
          description: "The package-lock.json document, as a JSON string",
        },
      },
      required: ["package_json", "lockfile_json"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "lockdrift", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "check_lockfile_drift") {
      const parsed = CheckArgs.parse(args ?? {});
      out = checkLockfileDrift(parsed.package_json, parsed.lockfile_json);
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
