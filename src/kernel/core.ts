/* eslint-disable no-console */
import { TGPConfig, Logger } from '../types.js';
import { VFSAdapter } from '../vfs/types.js';
import { createGitBackend, GitBackend, GitDependencies } from './git.js';
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
  logger?: Logger;
}

export interface Kernel {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  config: TGPConfig;
  vfs: VFSAdapter;
  git: GitBackend;
  registry: Registry;
  logger: Logger;
}

const defaultLogger: Logger = {
  debug: (msg, ...args) => console.debug(`[TGP] ${msg}`, ...args),
  info: (msg, ...args) => console.log(`[TGP] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[TGP] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[TGP] ${msg}`, ...args),
};

/**
 * Factory to create a TGP Kernel.
 * This wires up the configuration, the filesystem, and the git backend.
 */
export function createKernel(opts: KernelOptions): Kernel {
  const { config, vfs, env } = opts;
  const logger = opts.logger ?? defaultLogger;
  
  const git = createGitBackend(env, config, logger);
  const registry = createRegistry(vfs);

  let isBooted = false;

  return {
    config,
    vfs,
    git,
    registry,
    logger,

    async boot() {
      if (isBooted) return;
      logger.info(`Kernel booting...`);
      
      try {
        // Hydrate the filesystem from Git
        await git.hydrate().catch(err => {
          logger.error(`Git hydration failed.`, err);
          throw err;
        });
        
        // Hydrate registry from meta.json
        await registry.hydrate().catch(err => logger.warn(`Registry hydration warning:`, err));
        
        isBooted = true;
        logger.info(`Kernel ready.`);
      } catch (error) {
        logger.error(`Boot failed:`, error);
        throw error;
      }
    },

    async shutdown() {
      logger.info(`Kernel shutting down...`);
      // Cleanup tasks (close db connections, etc) can go here
      isBooted = false;
    }
  };
}