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
                    // LINTING: Enforce the "8 Standards" via Static Analysis
                    const errors = [];
                    // 1. Strict Typing: No 'any'
                    if (/\bany\b/.test(code)) {
                        errors.push("Violation: Usage of 'any' is prohibited. Use specific types or generic constraints.");
                    }
                    // 2. Safety: No 'eval' or 'Function' constructor
                    if (/\beval\(/.test(code) || /\bnew Function\(/.test(code)) {
                        errors.push("Violation: Dynamic code execution ('eval') is prohibited.");
                    }
                    // 3. Stateless: No process global access (except inside standard library wrappers which are hidden)
                    if (/\bprocess\./.test(code) && !code.includes('process.env.NODE_ENV')) {
                        errors.push("Violation: Direct access to 'process' is prohibited. Use 'args' for inputs.");
                    }
                    return { valid: errors.length === 0, errors };
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
