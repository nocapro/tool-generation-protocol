import { z } from 'zod';
/**
 * Represents a tool that can be exposed to an AI Agent.
 * This is generic enough to be adapted to OpenAI, Vercel AI SDK, or other consumers.
 */
export interface AgentTool<TParams extends z.ZodTypeAny = any, TResult = any> {
    description: string;
    parameters: TParams;
    execute: (args: z.infer<TParams>) => Promise<TResult>;
}
export type ToolSet = Record<string, AgentTool>;
