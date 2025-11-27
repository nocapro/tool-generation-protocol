import ivm from 'isolated-vm';
import { transform } from 'esbuild';

/**
 * Configuration for the V8 Sandbox.
 */
export interface SandboxOptions {
  memoryLimitMb?: number; // Default 128MB
  timeoutMs?: number;     // Default 5000ms
}

export interface Sandbox {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compileAndRun: (code: string, context: Record<string, any>) => Promise<any>;
  dispose: () => void;
}

/**
 * Creates a secure V8 Isolate.
 */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const memoryLimit = opts.memoryLimitMb ?? 128;
  const timeout = opts.timeoutMs ?? 5000;

  // Create the heavy V8 Isolate (The Virtual Machine)
  const isolate = new ivm.Isolate({ memoryLimit });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async compileAndRun(tsCode: string, context: Record<string, any>) {
      // 1. JIT Compile (TypeScript -> JavaScript)
      // We use esbuild for speed.
      const transformed = await transform(tsCode, {
        loader: 'ts',
        format: 'cjs', // CommonJS ensures simple execution in V8
        target: 'es2020',
      });

      const jsCode = transformed.code;

      // 2. Create a fresh Context for this execution
      const ivmContext = await isolate.createContext();

      try {
        // 3. Bridge the Global Scope (Host -> Guest)
        const jail = ivmContext.global;
        
        // Inject the 'tgp' global object which holds our bridge
        await jail.set('global', jail.derefInto()); // standard polyfill

        // We iterate over the context object and inject functions/values
        for (const [key, value] of Object.entries(context)) {
            if (typeof value === 'object' && value !== null) {
                // Handle namespaces (e.g. 'tgp')
                // We create a container in the guest and populate it
                // Note: deeply nested objects are not supported by this simple loop, just 1 level
                const container = new ivm.Reference({});
                await jail.set(key, container);
                
                // We can't easily populate a Reference from Host side without running script or intricate IVM calls.
                // Easier strategy: Copy by value if JSON, or if it contains functions, we need a different approach.
                // Since 'tgp' contains functions, we can't use ExternalCopy.
                // Let's recursively set on the global object's property? 
                // IVM makes this tricky. 
                // ALTERNATIVE: We inject a plain object with References.
                // Actually, 'context' passed here is usually flat or simple.
                // Since we changed Bridge to return { tgp: { ... } }, we need to handle it.
                // Let's use `compileScript` to setup the namespace if we can't do it via API easily.
                // Wait, jail.set accepts Reference. 
                // If we pass an object containing References, IVM doesn't auto-unwrap.
                
                // Let's treat 'tgp' special case or generic object-of-functions.
                if (key === 'tgp') {
                   // Create the 'tgp' object in the guest
                   await isolate.compileScript(`global.tgp = {}`).then(s => s.run(ivmContext));
                   const tgpHandle = await jail.get('tgp');
                   
                   for (const [subKey, subValue] of Object.entries(value)) {
                      if (typeof subValue === 'function') {
                         await tgpHandle.set(subKey, new ivm.Reference(subValue));
                      }
                   }
                } else {
                   // Fallback for non-function objects
                   await jail.set(key, new ivm.ExternalCopy(value).copyInto());
                }
            } else if (typeof value === 'function') {
              await jail.set(key, new ivm.Reference(value));
            } else {
              await jail.set(key, new ivm.ExternalCopy(value).copyInto());
            }
        }

        // 4. Compile the Script inside the Isolate
        const script = await isolate.compileScript(jsCode);

        // 5. Execute
        const result = await script.run(ivmContext, { timeout });
        
        // 6. Return result (Unwrap from IVM)
        if (typeof result === 'object' && result !== null && 'copy' in result) {
            // If it's a reference, try to copy it out, otherwise return as is
            return result.copy();
        }
        return result;

      } finally {
        // Cleanup the context to free memory immediately
        ivmContext.release();
      }
    },

    dispose() {
      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  };
}