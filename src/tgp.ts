import * as fs from 'node:fs';
import { createKernel, Kernel } from './kernel/core.js';
import { loadTGPConfig } from './config.js';
import { createNodeVFS } from './vfs/node.js';

export interface TGPOptions {
  /**
   * Path to the configuration file.
   * @default "./tgp.config.ts"
   */
  configFile?: string;
}

/**
 * High-level factory to create a fully initialized TGP Kernel in a Node.js environment.
 * This handles config loading, VFS setup (Disk-based), and Git backend wiring.
 */
export async function createTGP(opts: TGPOptions = {}): Promise<Kernel> {
  const configPath = opts.configFile || './tgp.config.ts';

  // 1. Load Configuration
  const config = await loadTGPConfig(configPath);

  // 2. Setup Filesystem (Node VFS)
  const vfs = createNodeVFS(config.rootDir);

  // 3. Create Kernel
  // We pass the raw 'fs' module to isomorphic-git so it can do its magic on the .git folder
  const kernel = createKernel({
    config,
    vfs,
    fs
  });

  // 4. Boot (Hydrate from Git)
  await kernel.boot();

  return kernel;
}

/**
 * Generates the System Prompt enforcing the "8 Standards" and TGP protocol.
 */
export function getSystemPrompt(): string {
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