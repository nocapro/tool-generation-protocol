import { Kernel } from '../kernel/core.js';
import { ToolSet } from './types.js';
export * from './types.js';
/**
 * Generates the complete set of TGP tools (Capabilities) for a given Kernel.
 * These are the tools the Agent will use to build, test, and run the user-land tools.
 */
export declare function tgpTools(kernel: Kernel): ToolSet;
