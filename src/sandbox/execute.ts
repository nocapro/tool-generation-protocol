 
import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';
import { transformSync } from 'esbuild';
import * as path from 'path';

export interface ExecutionResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  logs: string[];
  error?: string;
}

/**
 * Executes a tool script within a secure sandbox.
 * 
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 * @param filePath Optional path of the tool being executed (used for relative imports)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeTool(kernel: Kernel, code: string, args: Record<string, any> = {}, filePath: string = 'root.ts'): Promise<ExecutionResult> {
  const sandbox = createSandbox({
    memoryLimitMb: 128,
    timeoutMs: 5000 // 5s hard limit
  });
  
  const logs: string[] = [];

  try {
    // 1. Setup Bridge
    // We pass the kernel directly.
    const bridge = createSandboxBridge({
      kernel,
      onLog: (msg) => logs.push(msg)
    });

    // 2. Module Orchestration (The 'require' Bridge)
    // This host function is called synchronously from the Guest.
    const __tgp_load_module = (baseDir: string, importId: string) => {
      // Security: Ensure we don't traverse out of sandbox (handled by VFS)
      // Resolution Logic:
      // - Starts with '.': Relative to baseDir
      // - Otherwise: Absolute from root (or relative to root)
      
      let targetPath = '';
      if (importId.startsWith('.')) {
        targetPath = path.join(baseDir, importId);
      } else {
        targetPath = importId;
      }

      // Normalize extension (assume .ts if missing)
      if (!targetPath.endsWith('.ts') && !targetPath.endsWith('.js')) {
          // Check if it exists with .ts
          // We can't easily check existence sync in VFS without try/catch read
          // Let's assume .ts for TGP tools
          targetPath += '.ts';
      }

      try {
        const raw = kernel.vfs.readSync(targetPath);
        const transformed = transformSync(raw, {
          loader: 'ts',
          format: 'cjs',
          target: 'es2020',
        });
        
        return {
          code: transformed.code,
          path: targetPath,
          dirname: path.dirname(targetPath)
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load module '${importId}' from '${baseDir}': ${msg}`);
      }
    };

    // 3. Shim Injection
    // We prepend a CommonJS loader shim to the user code.
    // This allows 'require' to work by calling back to __tgp_load_module.
    const shim = `
      const __moduleCache = {};

      function __makeRequire(baseDir) {
        return function(id) {
          // Check Cache (Global)
          // In a real system, cache keys should be absolute paths.
          // Here we rely on the host to return consistent paths if we wanted perfect caching.
          // For now, we skip cache or use simple ID (flawed for relatives).
          // Let's implement correct caching by asking Host for absolute path first?
          // Simpler: Just reload for now (Stateless).
          
          // Call Host Sync
          const mod = __tgp_load_module.applySync(undefined, [baseDir, id]);
          
          if (__moduleCache[mod.path]) return __moduleCache[mod.path];

          // Wrap in CommonJS Function
          const fun = new Function('exports', 'require', 'module', '__filename', '__dirname', mod.code);
          const newModule = { exports: {} };
          
          // Execute
          fun(newModule.exports, __makeRequire(mod.dirname), newModule, mod.path, mod.dirname);
          
          __moduleCache[mod.path] = newModule.exports;
          return newModule.exports;
        };
      }
      
      // Setup Global Require for the entry point
      // We assume the entry point is at 'filePath'
      global.require = __makeRequire('${path.dirname(filePath)}');
    `;

    const context = {
      ...bridge, // { tgp: { ... } }
      args,
      __tgp_load_module // Injected as Reference
    };

    // Combine Shim + User Code
    // We wrap user code to provide top-level CommonJS variables if needed, 
    // but standard TGP tools are just scripts. 
    // We append the code. The 'shim' sets up 'global.require'.
    const fullScript = shim + '\n' + code;

    const result = await sandbox.compileAndRun(fullScript, context);
    return { result, logs };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    kernel.logger.error(`Tool Execution Failed:`, error);
    return { result: null, logs, error: errMsg };
  } finally {
    sandbox.dispose();
  }
}