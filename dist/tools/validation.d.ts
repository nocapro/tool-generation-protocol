import { z } from 'zod';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';
export declare const CheckToolParams: z.ZodObject<{
    path: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
}, {
    path: string;
}>;
export declare function createValidationTools(kernel: Kernel): {
    check_tool: AgentTool<typeof CheckToolParams, {
        valid: boolean;
        errors: string[];
    }>;
};
