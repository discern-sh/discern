/**
 * MCP-side registry-rendered hint assertions: the expectations resolve each
 * entry's command references through the SAME renderer and TOOLS-derived
 * lookup the server's delivery boundary uses, so a test asserting an MCP
 * envelope can never pass on a rendering production would not emit.
 */

import { renderCommandRefsMcp } from "../src/shared/command_reference.ts";
import { mcpToolNameForVerb } from "../src/engine/mcp/server.ts";
import { hintAssertsWithResolver } from "./hint_asserts.ts";

const mcp = hintAssertsWithResolver((authored) =>
  renderCommandRefsMcp(authored, mcpToolNameForVerb)
);

/** Assert that an MCP envelope carries the entry in its MCP rendering. */
export const assertHasMcpHint = mcp.assertHasHint;

/** Assert that an MCP envelope does not carry the entry's MCP rendering. */
export const assertLacksMcpHint = mcp.assertLacksHint;
