import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolSet } from './tools/types.js';

/**
 * Converts a TGP ToolSet into a format compatible with the Vercel AI SDK (Core).
 * 
 * @param tools The TGP ToolSet (from tgpTools(kernel))
 * @returns An object structurally compatible with the `tools` parameter of `generateText`.
 */
export function formatTools(tools: ToolSet) {
  // TGP's AgentTool interface is designed to be structurally compatible 
  // with Vercel AI SDK's CoreTool interface. 
  // We return identity here, but explicit validation/adapter logic can be added if interfaces diverge.
  return tools;
}

/**
 * Converts a TGP ToolSet into the standard OpenAI "functions" or "tools" JSON format.
 * Useful if using the raw OpenAI SDK.
 */
export function toOpenAITools(tools: ToolSet) {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  }));
}