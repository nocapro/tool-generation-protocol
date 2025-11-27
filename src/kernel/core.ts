/* eslint-disable no-console */
import { TGPConfig } from '../types.js';
import { VFSAdapter } from '../vfs/types.js';
import { createGitBackend, GitBackend, GitDependencies } from './git.js';
import { createDBBackend, DBBackend } from './db.js';
import { createRegistry, Registry } from './registry.js';

// We inject the platform-specific environment dependencies here.
// This allows the Kernel to run in Node, Edge, or Browser environments.
export interface KernelEnvironment extends GitDependencies {
  // We can extend this if Kernel needs more platform specific components later
}

export interface KernelOptions {
  config: TGPConfig;
  vfs: VFSAdapter; 
  env: KernelEnvironment;
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
  const { config, vfs, env } = opts;
  
  const git = createGitBackend(env, config);
  const db = createDBBackend(config); 
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