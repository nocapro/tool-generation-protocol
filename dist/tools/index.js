import { createFsTools } from './fs.js';
import { createValidationTools } from './validation.js';
import { createExecTools } from './exec.js';
export * from './types.js';
/**
 * Generates the complete set of TGP tools (Capabilities) for a given Kernel.
 * These are the tools the Agent will use to build, test, and run the user-land tools.
 */
export function tgpTools(kernel) {
    return {
        ...createFsTools(kernel),
        ...createValidationTools(kernel),
        ...createExecTools(kernel),
    };
}
