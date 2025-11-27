import { VFSAdapter } from './types.js';
/**
 * Creates a VFS adapter backed by the physical disk.
 * Used for standard Node.js deployments and CLI tools.
 *
 * @param rootDir The absolute or relative path to the sandbox root (e.g., ./.tgp)
 */
export declare function createNodeVFS(rootDir: string): VFSAdapter;
