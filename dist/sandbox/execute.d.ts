import { Kernel } from '../kernel/core.js';
/**
 * Executes a tool script within a secure sandbox.
 *
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 * @param filePath Optional path of the tool being executed (used for relative imports)
 */
export declare function executeTool(kernel: Kernel, code: string, args?: Record<string, any>, filePath?: string): Promise<any>;
