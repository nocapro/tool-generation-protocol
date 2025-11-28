import { z } from 'zod';
import * as ts from 'typescript';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const CheckToolParams = z.object({
  path: z.string().describe('The relative path of the tool to validate'),
});

export function createValidationTools(kernel: Kernel) {
  return {
    check_tool: {
      description: 'Run JIT compilation and AST-based static analysis on a tool.',
      parameters: CheckToolParams,
      execute: async ({ path }) => {
        const { allowedImports } = kernel.config;
        try {
          const code = await kernel.vfs.readFile(path);
          
          // 1. Parse AST
          // We use ES2020 as target to match the sandbox environment
          const sourceFile = ts.createSourceFile(
            path,
            code,
            ts.ScriptTarget.ES2020,
            true
          );

          const errors: string[] = [];

          // 2. Recursive AST Visitor
          const visit = (node: ts.Node) => {
            // [Standard 3] Strict Typing: No 'any'
            if (node.kind === ts.SyntaxKind.AnyKeyword) {
               errors.push("Violation [Standard 3]: Usage of 'any' is prohibited. Use specific types or generic constraints.");
            }

            // [Safety] Restricted Imports
            if (ts.isImportDeclaration(node)) {
                if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    const pkg = node.moduleSpecifier.text;
                    if (!allowedImports.includes(pkg)) {
                         errors.push(`Violation [Safety]: Restricted import of '${pkg}' detected.`);
                    }
                }
            }

            // [Safety] No 'eval'
            if (ts.isCallExpression(node)) {
                if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
                    errors.push("Violation [Safety]: Dynamic code execution ('eval') is prohibited.");
                }
            }

            // [Safety] No 'new Function(...)'
            if (ts.isNewExpression(node)) {
                if (ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
                    errors.push("Violation [Safety]: Dynamic code execution ('Function' constructor) is prohibited.");
                }
            }

            // [Standard 4] Stateless: No process global access (except process.env.NODE_ENV)
            if (ts.isIdentifier(node) && node.text === 'process') {
                // Check context to see if allowed.
                // We allow strict access to `process.env.NODE_ENV`.
                // AST Structure: PropertyAccess(NODE_ENV) -> PropertyAccess(env) -> Identifier(process)
                
                let isAllowed = false;
                
                // Ensure parent is property access 'env'
                if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === 'env') {
                     // Ensure grandparent is property access 'NODE_ENV'
                     if (ts.isPropertyAccessExpression(node.parent.parent) && node.parent.parent.expression === node.parent && node.parent.parent.name.text === 'NODE_ENV') {
                         isAllowed = true;
                     }
                }
                
                if (!isAllowed) {
                     // We check if this identifier is being used as a property access base or standalone.
                     // To avoid noise, we only report if it's the base of a property access OR used standalone.
                     // If it's a property of something else (e.g. myObj.process), parent is PropertyAccess but expression is NOT node.
                     if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
                         // This is something.process - Allowed
                     } else {
                         errors.push("Violation [Standard 4]: Direct access to 'process' is prohibited. Use 'args' for inputs to ensure statelessness.");
                     }
                }
            }

            // [Standard 1] No Magic Numbers
            if (node.kind === ts.SyntaxKind.NumericLiteral) {
                const text = (node as ts.NumericLiteral).text;
                const val = Number(text); // Handle hex, etc.
                const allowed = [0, 1, 2, -1, 100, 1000];
                if (!isNaN(val) && !allowed.includes(val)) {
                    // Filter out array indices? Hard to detect without type checker.
                    // We enforce strictness: abstract data to args.
                    errors.push(`Violation [Standard 1]: Found potential Magic Number '${node.text}'. Abstract logic from data.`);
                }
            }

            // [Standard 7] No Hardcoded Secrets
            if (ts.isStringLiteral(node)) {
                const text = node.text;
                // Emails
                if (/\b[\w.-]+@[\w.-]+\.\w{2,4}\b/.test(text)) {
                     errors.push("Violation [Standard 7]: Hardcoded email address detected. Pass this as an argument.");
                }
                // Long Alphanumeric Strings (potential IDs/Keys) - strict heuristic
                // Must be 24+ chars, alphanumeric mixed, no spaces.
                if (/[a-zA-Z0-9-]{24,}/.test(text) && !text.includes(' ')) {
                     errors.push("Violation [Standard 7]: Potential hardcoded ID or Secret detected. Pass this as an argument.");
                }
            }

            ts.forEachChild(node, visit);
          };

          visit(sourceFile);

          return { valid: errors.length === 0, errors };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          const msg = error.message ?? String(error);
          console.error('[Validation Error]', msg);
          return { valid: false, errors: [msg] };
        }
      },
    } as AgentTool<typeof CheckToolParams, { valid: boolean; errors: string[] }>,
  };
}