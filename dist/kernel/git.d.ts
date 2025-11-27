import { TGPConfig } from '../types.js';
/**
 * The Git Interface required by the Kernel.
 * We rely on the 'fs' interface compatible with isomorphic-git.
 */
export interface GitBackend {
    hydrate(): Promise<void>;
    persist(message: string, files: string[]): Promise<void>;
}
export declare function createGitBackend(fs: any, config: TGPConfig): GitBackend;
