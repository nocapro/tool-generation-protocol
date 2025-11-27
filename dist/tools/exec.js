import { z } from 'zod';
import { executeTool } from '../sandbox/execute.js';
export const ExecToolParams = z.object({
    path: z.string().describe('The relative path of the tool to execute'),
    args: z.record(z.any()).describe('The arguments to pass to the tool'),
});
export function createExecTools(kernel) {
    return {
        exec_tool: {
            description: 'Execute a tool inside the secure Sandbox.',
            parameters: ExecToolParams,
            execute: async ({ path, args }) => {
                // Security: Ensure args are serializable (no functions, no circular refs)
                // This prevents the agent from trying to pass internal objects to the guest.
                try {
                    JSON.stringify(args);
                }
                catch {
                    throw new Error("Arguments must be serializable JSON.");
                }
                const code = await kernel.vfs.readFile(path);
                // The sandbox takes care of safety, timeout, and memory limits
                const result = await executeTool(kernel, code, args, path);
                return result;
            },
        },
    };
}
