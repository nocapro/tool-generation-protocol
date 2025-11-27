import ivm from 'isolated-vm';
import { transform } from 'esbuild';
/**
 * Creates a secure V8 Isolate.
 */
export function createSandbox(opts = {}) {
    const memoryLimit = opts.memoryLimitMb || 128;
    const timeout = opts.timeoutMs || 5000;
    // Create the heavy V8 Isolate (The Virtual Machine)
    const isolate = new ivm.Isolate({ memoryLimit });
    return {
        async compileAndRun(tsCode, context) {
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
                    if (typeof value === 'function') {
                        // Bridge functions: Host runs the logic, Guest calls it
                        await jail.set(key, new ivm.Reference(value));
                    }
                    else {
                        // Bridge values: Copy by value (JSON safe)
                        await jail.set(key, new ivm.ExternalCopy(value).copyInto());
                    }
                }
                // 4. Compile the Script inside the Isolate
                const script = await isolate.compileScript(jsCode);
                // 5. Execute
                const result = await script.run(ivmContext, { timeout });
                // 6. Return result (Unwrap from IVM)
                if (result && typeof result === 'object' && 'copy' in result) {
                    // If it's a reference, try to copy it out, otherwise return as is
                    return result.copy();
                }
                return result;
            }
            finally {
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
