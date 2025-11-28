import { z } from 'zod';

/**
 * Represents a tool that can be exposed to an AI Agent.
 * This is generic enough to be adapted to OpenAI, Vercel AI SDK, or other consumers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AgentTool<TParams extends z.ZodTypeAny = any, TResult = any> {
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>) => Promise<TResult>;
  // For Vercel AI SDK compatibility - use the schema directly
  inputSchema: TParams;
}

export type ToolSet = Record<string, AgentTool>;