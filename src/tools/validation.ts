import { z } from 'zod';
import { transform } from 'esbuild';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const CheckToolParams = z.object({
  path: z.string().describe('The relative path of the tool to validate'),
});

export function createValidationTools(kernel: Kernel) {
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
          const errors: string[] = [];

          // 1. Strict Typing: No 'any'
          if (/\bany\b/.test(code)) {
            errors.push("Violation [Standard 3]: Usage of 'any' is prohibited. Use specific types or generic constraints.");
          }

          // 2. Safety: No 'eval' or 'Function' constructor
          if (/\beval\(/.test(code) || /\bnew Function\(/.test(code)) {
            errors.push("Violation [Safety]: Dynamic code execution ('eval') is prohibited.");
          }

          // 3. Stateless: No process global access (except inside standard library wrappers which are hidden)
          if (/\bprocess\./.test(code) && !code.includes('process.env.NODE_ENV')) {
            errors.push("Violation [Standard 4]: Direct access to 'process' is prohibited. Use 'args' for inputs to ensure statelessness.");
          }

          // 4. Abstract / No Magic Numbers (Heuristic)
          // We look for 'const x = 0.05' type patterns.
          // This matches: const name = number; (with optional decimals)
          // We skip common integers like 0, 1, -1, 100 which are often used for loops or percentages base.
          const magicNumMatch = code.match(/\bconst\s+[a-zA-Z0-9_]+\s*=\s*(\d+(?:\.\d+)?)\s*;/);
          if (magicNumMatch) {
            const val = parseFloat(magicNumMatch[1]);
            if (val !== 0 && val !== 1 && val !== -1 && val !== 100) {
               errors.push(`Violation [Standard 1]: Found potential magic number '${magicNumMatch[0]}'. Abstract logic from data (e.g., args.taxRate, not 0.05).`);
            }
          }

          // 5. No Hardcoded Secrets/IDs
          // Emails
          if (/\b[\w.-]+@[\w.-]+\.\w{2,4}\b/.test(code)) {
            errors.push("Violation [Standard 7]: Hardcoded email address detected. Pass this as an argument.");
          }
          // Long Alphanumeric Strings (potential IDs/Keys) - strict heuristic
          if (/['"][a-zA-Z0-9-]{24,}['"]/.test(code)) {
             errors.push("Violation [Standard 7]: Potential hardcoded ID or Secret detected. Pass this as an argument.");
          }

          return { valid: errors.length === 0, errors };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // esbuild errors are usually descriptive
          const msg = error.message ?? String(error);
          // Return valid: false so the model can reason about the error, rather than crashing the tool call
          return { valid: false, errors: [msg] };
        }
      },
    } as AgentTool<typeof CheckToolParams, { valid: boolean; errors: string[] }>,
  };
}