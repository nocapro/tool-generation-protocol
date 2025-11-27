import { z } from 'zod';
import { transform } from 'esbuild';
export const CheckToolParams = z.object({
    path: z.string().describe('The relative path of the tool to validate'),
});
export function createValidationTools(kernel) {
    return {
        check_tool: {
            description: 'Run JIT compilation and syntax check on a tool.',
            parameters: CheckToolParams,
            execute: async ({ path }) => {
                try {
                    const code = await kernel.vfs.readFile(path);
                    // Dry-run transformation to catch syntax errors
                    await transform(code, {
                        loader: 'ts',
                        format: 'cjs',
                        target: 'es2020',
                    });
                    // TODO: Add AST traversal here to enforce the "8 Standards"
                    // e.g. check for prohibited imports, global state usage, etc.
                    return { valid: true, errors: [] };
                }
                catch (error) {
                    // esbuild errors are usually descriptive
                    const msg = error.message || String(error);
                    // Return valid: false so the model can reason about the error, rather than crashing the tool call
                    return { valid: false, errors: [msg] };
                }
            },
        },
    };
}
