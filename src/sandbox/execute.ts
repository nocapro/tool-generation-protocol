import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';
import { bundleDependencySync } from './bundler.js';
import { transformSync } from 'esbuild';
import * as path from 'path';

export interface ExecutionResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  logs: string[];
  error?: string;
}

/**
 * Resolves a module path within the VFS using standard Node.js resolution logic.
 * Checks: path, path.ts, path.js, path/index.ts, path/index.js
 */
function resolveVfsPath(vfs: Kernel['vfs'], baseDir: string, importPath: string): string | null {
  const candidates: string[] = [];
  
  // Resolve absolute path based on import type
  // If it starts with '/', it's absolute (from VFS root).
  // Otherwise, it's relative to baseDir.
  const target = importPath.startsWith('/') 
    ? importPath 
    : path.join(baseDir, importPath);

  // 1. Exact match (e.g. require('./foo.ts'))
  candidates.push(target);
  
  // 2. Extensions (e.g. require('./foo'))
  candidates.push(`${target}.ts`);
  candidates.push(`${target}.js`);
  
  // 3. Directory Indices
  candidates.push(path.join(target, 'index.ts'));
  candidates.push(path.join(target, 'index.js'));

  for (const c of candidates) {
    try {
      // Synchronous check is required for the sync require shim
      vfs.readSync(c);
      return c;
    } catch {
      continue;
    }
  }
  return null;
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
      // 1. Handle whitelisted node modules (bare specifiers)
      if (!importId.startsWith('.') && !importId.startsWith('/')) {
        if (!kernel.config.allowedImports.includes(importId)) {
          throw new Error(`Security Violation: Import of module '${importId}' is not allowed. Allowed modules are: ${kernel.config.allowedImports.join(', ')}`);
        }
        try {
          const bundledCode = bundleDependencySync(importId);
          return {
            code: bundledCode,
            path: `/__node_modules__/${importId}`, // Virtual path for caching
            dirname: `/__node_modules__`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to bundle allowed module '${importId}': ${msg}`);
        }
      }

      // 2. Resolve Local Modules (VFS)
      const resolvedPath = resolveVfsPath(kernel.vfs, baseDir, importId);

      if (resolvedPath === null) {
        throw new Error(`Cannot find module '${importId}' from '${baseDir}'`);
      }

      try {
        const raw = kernel.vfs.readSync(resolvedPath);
        const transformed = transformSync(raw, {
          loader: 'ts',
          format: 'cjs',
          target: 'es2020',
        });
        
        return {
          code: transformed.code,
          path: resolvedPath,
          dirname: path.dirname(resolvedPath)
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load module '${importId}' from '${baseDir}': ${msg}`);
      }
    };

    // 3. Shim Injection
    // We prepend a CommonJS loader shim to the user code.
    // This allows 'require' to work by calling back to the host via __tgp_load_module.
    // It includes a cache to prevent reloading the same module within a single execution.
    const shim = `
      const __moduleCache = {};

      function __makeRequire(baseDir) {
        return function(id) {
          // HOST INTERACTION: Resolve module path and get its source code from the host.
          // This is a synchronous call to the Node.js environment.
          
          let mod;
          if (typeof __tgp_load_module.applySync === 'function') {
             mod = __tgp_load_module.applySync(undefined, [baseDir, id]);
          } else {
             mod = __tgp_load_module(baseDir, id);
          }

          // CACHE CHECK: If the module has already been loaded, return it from the cache.
          if (__moduleCache[mod.path]) {
            return __moduleCache[mod.path].exports;
          }

          // MODULE EXECUTION: If it's a new module, execute its code.
          const newModule = { exports: {} };

          // Before executing, store the module object in the cache to handle circular dependencies.
          __moduleCache[mod.path] = newModule;

          // We provide the module with its own 'exports' object, a 'require' function
          // scoped to its own directory, and other CommonJS globals.
          const fun = new Function('exports', 'require', 'module', '__filename', '__dirname', mod.code);

          // Execute the module's code.
          fun(newModule.exports, __makeRequire(mod.dirname), newModule, mod.path, mod.dirname);

          // The 'newModule.exports' object is now populated.
          return newModule.exports;
        };
      }
    `;

    const context = {
      ...bridge, // { tgp: { ... } }
      args,
      __tgp_load_module // Injected as Reference
    };

    // 1. Transform user code to CJS explicitly
    // We do this to ensure we can wrap it safely without worrying about top-level imports in the final string
    const { code: cjsCode } = transformSync(code, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
    });

    // 2. Construct the Execution Harness
    const script = `
      ${shim}

      // Setup CJS Environment for the entry point
      global.exports = {};
      global.module = { exports: global.exports };
      global.require = __makeRequire('${path.dirname(filePath)}');

      // Execute User Code
      (function() {
        ${cjsCode}
      })();

      // Run Default Export
      const __main = global.module.exports.default || global.module.exports;
      if (typeof __main === 'function') {
         __main(global.args);
      } else {
         __main;
      }
    `;

    const result = await sandbox.compileAndRun(script, context);
    return { result, logs };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    kernel.logger.error(`Tool Execution Failed:`, error);
    return { result: null, logs, error: errMsg };
  } finally {
    sandbox.dispose();
  }
}