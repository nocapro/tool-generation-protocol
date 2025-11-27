import { z } from 'zod';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';
export declare const ExecToolParams: z.ZodObject<{
    path: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    path: string;
    args: Record<string, any>;
}, {
    path: string;
    args: Record<string, any>;
}>;
export declare function createExecTools(kernel: Kernel): {
    exec_tool: AgentTool<typeof ExecToolParams, any>;
};
