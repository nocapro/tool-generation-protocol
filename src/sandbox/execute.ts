import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';

/**
 * Executes a tool script within a secure sandbox.
 * 
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 */
export async function executeTool(kernel: Kernel, code: string, args: Record<string, any> = {}): Promise<any> {
  const sandbox = createSandbox({
    memoryLimitMb: 128,
    timeoutMs: 5000 // 5s hard limit
  });

  try {
    const bridge = createSandboxBridge(kernel);

    // Context Injection:
    // 1. The 'args' object (Input)
    // 2. The Bridge functions (Capabilities)
    const context = {
      args,
      ...bridge
    };

    // We wrap the user code to ensure it can consume the 'args' and use the bridge.
    // The user code is expected to be a module or script. 
    // We wrap it in an IIFE to allow top-level execution flows if needed, 
    // but typically we expect a standard script execution.
    // 
    // We explicitly expose the bridge functions on the global scope by the isolate.ts logic.
    
    const result = await sandbox.compileAndRun(code, context);
    return result;

  } catch (error) {
    console.error(`[TGP] Tool Execution Failed:`, error);
    throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    sandbox.dispose();
  }
}