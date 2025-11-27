import { VFSAdapter } from './types.js';
/**
 * Creates an ephemeral, in-memory VFS.
 * Used for Serverless execution or Unit Testing.
 */
export declare function createMemoryVFS(initialFiles?: Record<string, string>): VFSAdapter;
