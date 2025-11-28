import * as fs from 'node:fs';
import * as http from 'isomorphic-git/http/node';
import { createKernel, Kernel, KernelEnvironment } from './kernel/core.js';
import { loadTGPConfig } from './config.js';
import { createNodeVFS } from './vfs/node.js';
import { TGPConfigSchema, TGPConfig, Logger, DBBackend } from './types.js';
import { VFSAdapter } from './vfs/types.js';
import { GitBackend } from './kernel/git.js';
import { Registry } from './kernel/registry.js';

export interface TGPOptions {
  /**
   * Path to the configuration file.
   * @default "./tgp.config.ts"
   */
  configFile?: string;

  /**
   * Override the Virtual Filesystem Adapter.
   * Useful for using MemoryVFS in tests or Edge environments.
   * If omitted, defaults to NodeVFS rooted at config.rootDir.
   */
  vfs?: VFSAdapter;

  /**
   * Inject a custom logger. Defaults to console.
   */
  logger?: Logger;

  /**
   * Inject a custom Database Backend.
   */
  db?: DBBackend;

  /**
   * Override the raw filesystem used by Git.
   * If omitted, defaults to 'node:fs'.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs?: any;

  /**
   * Override the HTTP client used by Git.
   * If omitted, defaults to 'isomorphic-git/http/node'.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http?: any;
}

/**
 * The TGP Kernel Class.
 * Manages the lifecycle of the Agent's runtime environment, including
 * configuration, filesystem (VFS), Git persistence, and the Tool Registry.
 */
export class TGP implements Kernel {
  public config: TGPConfig;
  public vfs: VFSAdapter;
  public git: GitBackend;
  public db: DBBackend;
  public registry: Registry;
  public logger: Logger;
  
  private _isBooted = false;

  constructor(private opts: TGPOptions = {}) {
    // 1. Initialize with Defaults (Sync)
    // We use the default schema to ensure the kernel is usable immediately (e.g. for tooling)
    // even before the async config load completes.
    this.config = TGPConfigSchema.parse({});
    
    // 2. Setup VFS
    // Use injected VFS or default to Node VFS
    this.vfs = opts.vfs || createNodeVFS(this.config.rootDir);

    // 3. Initialize Kernel Components
    // Construct Environment with defaults if not provided
    const env: KernelEnvironment = {
      fs: opts.fs || fs,
      http: opts.http || http
    };

    const kernel = createKernel({
      config: this.config,
      vfs: this.vfs,
      env,
      logger: opts.logger,
      db: opts.db
    });

    this.git = kernel.git;
    this.db = kernel.db;
    this.registry = kernel.registry;
    this.logger = kernel.logger;
  }

  /**
   * Hydrates the Kernel from the configuration file and Git.
   * This must be awaited before executing tools in production.
   */
  async boot(): Promise<void> {
    if (this._isBooted) return;

    const configPath = this.opts.configFile || './tgp.config.ts';

    try {
      // 1. Load Real Configuration
      const loadedConfig = await loadTGPConfig(configPath);
      this.config = loadedConfig;

      // 2. Re-initialize VFS if RootDir changed AND user didn't inject a custom VFS
      // If the user injected a VFS, we assume they configured it correctly.
      if (!this.opts.vfs) {
        this.vfs = createNodeVFS(this.config.rootDir);
      }

      // 3. Re-initialize Kernel Components with new Config/VFS
      const env: KernelEnvironment = {
        fs: this.opts.fs || fs,
        http: this.opts.http || http
      };

      const kernel = createKernel({
        config: this.config,
        vfs: this.vfs,
        env,
        logger: this.opts.logger,
        db: this.opts.db
      });
      
      this.git = kernel.git;
      this.db = kernel.db;
      this.registry = kernel.registry;

      // 4. Hydrate State (Git Clone/Pull + Registry Build)
      await kernel.boot();
      
      this._isBooted = true;
    } catch (error) {
      // If config loading fails, we might still be in a valid default state,
      // but we should warn the user.
      console.warn(`[TGP] Boot warning:`, error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    // Passthrough to internal kernel shutdown if needed
    this._isBooted = false;
  }

  /**
   * Generates the System Prompt enforcing the "8 Standards" and TGP protocol.
   */
  getSystemPrompt(): string {
    return `
You are an autonomous AI Engineer running on the Tool Generation Protocol (TGP).
Your goal is to build, validate, and execute tools to solve the user's request.

# THE PROTOCOL

1.  **Reuse or Forge**: Check if a tool exists. If not, write it.
2.  **No One-Offs**: Do not execute arbitrary scripts. Create a reusable tool in 'tools/'.
3.  **Strict Typing**: All tools must be written in TypeScript. No 'any', no 'unknown'.

# CODING STANDARDS (The 8 Commandments)

1.  **Abstract**: Logic must be separated from data. (e.g., args.taxRate, not 0.05).
2.  **Composable**: Functions should return results usable by others.
3.  **HOFs**: Use map/reduce/filter over imperative loops.
4.  **Stateless**: No global state. No reliance on previous execution.
5.  **Reusable**: Generic enough for multiple use cases.
6.  **General by Params**: Behavior controlled by arguments.
7.  **No Hardcoded Values**: No magic numbers or IDs.
8.  **Orchestrator**: Tools can import other tools via 'require'.

# EXECUTION FLOW

1.  List files to see what you have.
2.  Read file content to understand the tool.
3.  If missing, write_file to create a new tool.
4.  Use check_tool to validate syntax.
5.  Use exec_tool to run it.
`;
  }
}

/**
 * Legacy Factory to create a TGP Kernel (Backward Compatibility).
 */
export async function createTGP(opts: TGPOptions = {}): Promise<Kernel> {
  const tgp = new TGP(opts);
  await tgp.boot();
  return tgp;
}

/**
 * Helper to get the system prompt (Backward Compatibility).
 */
export function getSystemPrompt(): string {
  return new TGP().getSystemPrompt();
}