import { TGPConfig } from '../types.js';
import { VFSAdapter } from '../vfs/types.js';
import { GitBackend } from './git.js';
import { DBBackend } from './db.js';
import { Registry } from './registry.js';
export interface KernelOptions {
    config: TGPConfig;
    vfs: VFSAdapter;
    fs: any;
}
export interface Kernel {
    boot(): Promise<void>;
    shutdown(): Promise<void>;
    config: TGPConfig;
    vfs: VFSAdapter;
    git: GitBackend;
    db: DBBackend;
    registry: Registry;
}
/**
 * Factory to create a TGP Kernel.
 * This wires up the configuration, the filesystem, and the git backend.
 */
export declare function createKernel(opts: KernelOptions): Kernel;
