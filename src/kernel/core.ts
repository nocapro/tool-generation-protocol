/* eslint-disable no-console */
import { TGPConfig } from '../types.js';
import { VFSAdapter } from '../vfs/types.js';
import { createGitBackend, GitBackend } from './git.js';
import { createNoOpDB, DBBackend } from './db.js';
import { createRegistry, Registry } from './registry.js';

// We inject the low-level FS for Git separately from the VFS adapter
// This is because Git needs raw FS access, while the Agent uses the VFS Jail.
export interface KernelOptions {
  config: TGPConfig;
  vfs: VFSAdapter; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any; // The raw filesystem object (node:fs or memfs) used by isomorphic-git
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
export function createKernel(opts: KernelOptions): Kernel {
  const { config, vfs, fs } = opts;
  
  const git = createGitBackend(fs, config);
  const db = createNoOpDB(); // TODO: Connect to real DB based on config.db
  const registry = createRegistry(vfs);

  let isBooted = false;

  return {
    config,
    vfs,
    git,
    db,
    registry,

    async boot() {
      if (isBooted) return;
      console.log(`[TGP] Kernel booting...`);
      
      try {
        // Hydrate the filesystem from Git
        await git.hydrate();
        
        // Hydrate registry from meta.json
        await registry.hydrate();
        isBooted = true;
        console.log(`[TGP] Kernel ready.`);
      } catch (error) {
        console.error(`[TGP] Boot failed:`, error);
        throw error;
      }
    },

    async shutdown() {
      console.log(`[TGP] Kernel shutting down...`);
      // Cleanup tasks (close db connections, etc) can go here
      isBooted = false;
    }
  };
}