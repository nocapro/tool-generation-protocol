/**
 * Configuration for the V8 Sandbox.
 */
export interface SandboxOptions {
    memoryLimitMb?: number;
    timeoutMs?: number;
}
export interface Sandbox {
    compileAndRun: (code: string, context: Record<string, any>) => Promise<any>;
    dispose: () => void;
}
/**
 * Creates a secure V8 Isolate.
 */
export declare function createSandbox(opts?: SandboxOptions): Sandbox;
