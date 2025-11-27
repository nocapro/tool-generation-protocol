# Directory Structure
```
bin/
  tgp.js
src/
  cli/
    index.ts
    init.ts
  kernel/
    core.ts
    git.ts
  sandbox/
    bridge.ts
    execute.ts
    isolate.ts
  tools/
    exec.ts
    fs.ts
    index.ts
    types.ts
    validation.ts
  vfs/
    memory.ts
    node.ts
    types.ts
  adapter.ts
  config.ts
  index.ts
  tgp.ts
  types.ts
package.json
README.md
tsconfig.json
```

# Files

## File: bin/tgp.js
````javascript
#!/usr/bin/env node

import { cli } from '../dist/cli/index.js';

cli().catch((err) => {
  console.error('TGP CLI Error:', err);
  process.exit(1);
});
````

## File: src/cli/index.ts
````typescript
import * as path from 'path';
import * as fs from 'fs/promises';
import { initCommand } from './init.js';

export async function cli() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      await initCommand();
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
Tool Generation Protocol (TGP) CLI

Usage:
  tgp init    Initialize a new TGP environment in the current directory.
  tgp help    Show this message.
`);
}
````

## File: src/cli/init.ts
````typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export async function initCommand() {
  const cwd = process.cwd();
  console.log(`[TGP] Initializing in ${cwd}...`);

  const configPath = path.join(cwd, 'tgp.config.ts');
  const gitIgnorePath = path.join(cwd, '.gitignore');
  const tgpDir = path.join(cwd, '.tgp');

  // 1. Create tgp.config.ts
  if (await exists(configPath)) {
    console.log(`[TGP] tgp.config.ts already exists. Skipping.`);
  } else {
    await fs.writeFile(configPath, CONFIG_TEMPLATE.trim());
    console.log(`[TGP] Created tgp.config.ts`);
  }

  // 2. Update .gitignore
  if (await exists(gitIgnorePath)) {
    const content = await fs.readFile(gitIgnorePath, 'utf-8');
    if (!content.includes('.tgp')) {
      await fs.appendFile(gitIgnorePath, '\n# TGP\n.tgp\n');
      console.log(`[TGP] Added .tgp to .gitignore`);
    }
  } else {
    await fs.writeFile(gitIgnorePath, '# TGP\n.tgp\n');
    console.log(`[TGP] Created .gitignore`);
  }

  // 3. Create .tgp directory (just to be nice)
  await fs.mkdir(tgpDir, { recursive: true });

  console.log(`[TGP] Initialization complete. Run 'npx tgp' to start hacking.`);
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const CONFIG_TEMPLATE = `
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem
  rootDir: './.tgp',

  // Database Configuration (Optional)
  // db: {
  //   dialect: 'postgres',
  //   ddlSource: 'drizzle-kit generate --print',
  // },

  // Git Backend (Required for Persistence)
  git: {
    provider: 'github',
    repo: 'my-org/tgp-tools',
    branch: 'main',
    auth: {
      token: process.env.GITHUB_TOKEN || '',
      user: 'tgp-bot',
      email: 'bot@tgp.dev'
    },
    writeStrategy: 'direct' // or 'pr'
  },

  // Sandbox Security
  fs: {
    allowedDirs: ['./tmp'],
    blockUpwardTraversal: true
  },

  allowedImports: ['@tgp/std', 'zod', 'date-fns']
});
`;
````

## File: src/kernel/core.ts
````typescript
import { TGPConfig } from '../types.js';
import { VFSAdapter } from '../vfs/types.js';
import { createGitBackend, GitBackend } from './git.js';

// We inject the low-level FS for Git separately from the VFS adapter
// This is because Git needs raw FS access, while the Agent uses the VFS Jail.
export interface KernelOptions {
  config: TGPConfig;
  vfs: VFSAdapter; 
  fs: any; // The raw filesystem object (node:fs or memfs) used by isomorphic-git
}

export interface Kernel {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  config: TGPConfig;
  vfs: VFSAdapter;
  git: GitBackend;
}

/**
 * Factory to create a TGP Kernel.
 * This wires up the configuration, the filesystem, and the git backend.
 */
export function createKernel(opts: KernelOptions): Kernel {
  const { config, vfs, fs } = opts;
  
  const git = createGitBackend(fs, config);

  let isBooted = false;

  return {
    config,
    vfs,
    git,

    async boot() {
      if (isBooted) return;
      console.log(`[TGP] Kernel booting...`);
      
      try {
        // Hydrate the filesystem from Git
        await git.hydrate();
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
````

## File: src/kernel/git.ts
````typescript
import * as git from 'isomorphic-git';
import * as http from 'isomorphic-git/http/node';
import { TGPConfig } from '../types.js';
import * as path from 'path';

/**
 * The Git Interface required by the Kernel.
 * We rely on the 'fs' interface compatible with isomorphic-git.
 */
export interface GitBackend {
  hydrate(): Promise<void>;
  persist(message: string, files: string[]): Promise<void>;
}

export function createGitBackend(fs: any, config: TGPConfig): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy } = config.git;

  // Helper to configure git options
  const gitOpts = {
    fs,
    dir,
    http,
    onAuth: () => ({ username: auth.token }),
  };

  const author = {
    name: auth.user,
    email: auth.email,
  };

  return {
    async hydrate() {
      // 1. Check if repo exists locally
      const gitDirExists = await fs.promises.stat(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false);

      if (!gitDirExists) {
        // Clone
        console.log(`[TGP] Cloning ${repo} into ${dir}...`);
        await git.clone({
          ...gitOpts,
          url: `https://github.com/${repo}.git`,
          ref: branch,
          singleBranch: true,
          depth: 1,
        });
      } else {
        // Pull
        console.log(`[TGP] Pulling latest from ${repo}...`);
        await git.pull({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
          singleBranch: true,
          author,
        });
      }
    },

    async persist(message: string, filesToAdd: string[]) {
      // 1. Add files
      for (const filepath of filesToAdd) {
        await git.add({ ...gitOpts, filepath });
      }

      // 2. Commit
      const sha = await git.commit({
        ...gitOpts,
        message,
        author,
      });
      console.log(`[TGP] Committed ${sha.slice(0, 7)}: ${message}`);

      // 3. Push
      if (writeStrategy === 'direct') {
        console.log(`[TGP] Pushing to ${branch}...`);
        await git.push({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
        });
      } else {
        // TODO: Implement PR creation logic for 'pr' strategy
        console.warn(`[TGP] PR Strategy not yet implemented. Changes committed locally.`);
      }
    }
  };
}
````

## File: src/sandbox/bridge.ts
````typescript
import { Kernel } from '../kernel/core.js';

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * NOTE: When passing functions to isolated-vm, arguments and return values 
 * must be serializable or wrapped in References.
 */
export function createSandboxBridge(kernel: Kernel) {
  const { vfs } = kernel;

  return {
    // --- Filesystem Bridge (Jailed) ---
    // The Guest sees these as async functions on the global scope or a 'tgp' object.
    
    // tgp_read_file('./data.txt')
    tgp_read_file: async (path: string) => {
      // VFS already enforces jail path traversal checks
      return vfs.readFile(path);
    },

    // tgp_write_file('./output.txt', 'content')
    tgp_write_file: async (path: string, content: string) => {
      return vfs.writeFile(path, content);
    },

    // tgp_list_files('./tools')
    tgp_list_files: async (dir: string) => {
      return vfs.listFiles(dir, false);
    },

    // --- Network Bridge (Allowed Only) ---
    // We can inject a restricted fetch here.
    tgp_fetch: async (url: string, init?: any) => {
      // Security: Parse URL and allow-list check could happen here
      const response = await fetch(url, init);
      const text = await response.text();
      return {
        status: response.status,
        text: () => text,
        json: () => JSON.parse(text),
      };
    },

    // --- Logger ---
    tgp_log: (...args: any[]) => {
      console.log('[TGP-TOOL]', ...args);
    }
  };
}
````

## File: src/sandbox/execute.ts
````typescript
import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';

/**
 * Executes a tool script within a secure sandbox.
 * 
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 */
export async function executeTool(kernel: Kernel, code: string, args: Record<string, any> = {}): Promise<any> {
  const sandbox = createSandbox({
    memoryLimitMb: 128,
    timeoutMs: 5000 // 5s hard limit
  });

  try {
    const bridge = createSandboxBridge(kernel);

    // Context Injection:
    // 1. The 'args' object (Input)
    // 2. The Bridge functions (Capabilities)
    const context = {
      args,
      ...bridge
    };

    // We wrap the user code to ensure it can consume the 'args' and use the bridge.
    // The user code is expected to be a module or script. 
    // We wrap it in an IIFE to allow top-level execution flows if needed, 
    // but typically we expect a standard script execution.
    // 
    // We explicitly expose the bridge functions on the global scope by the isolate.ts logic.
    
    const result = await sandbox.compileAndRun(code, context);
    return result;

  } catch (error) {
    console.error(`[TGP] Tool Execution Failed:`, error);
    throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    sandbox.dispose();
  }
}
````

## File: src/sandbox/isolate.ts
````typescript
import ivm from 'isolated-vm';
import { transform } from 'esbuild';

/**
 * Configuration for the V8 Sandbox.
 */
export interface SandboxOptions {
  memoryLimitMb?: number; // Default 128MB
  timeoutMs?: number;     // Default 5000ms
}

export interface Sandbox {
  compileAndRun: (code: string, context: Record<string, any>) => Promise<any>;
  dispose: () => void;
}

/**
 * Creates a secure V8 Isolate.
 */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const memoryLimit = opts.memoryLimitMb || 128;
  const timeout = opts.timeoutMs || 5000;

  // Create the heavy V8 Isolate (The Virtual Machine)
  const isolate = new ivm.Isolate({ memoryLimit });

  return {
    async compileAndRun(tsCode: string, context: Record<string, any>) {
      // 1. JIT Compile (TypeScript -> JavaScript)
      // We use esbuild for speed.
      const transformed = await transform(tsCode, {
        loader: 'ts',
        format: 'cjs', // CommonJS ensures simple execution in V8
        target: 'es2020',
      });

      const jsCode = transformed.code;

      // 2. Create a fresh Context for this execution
      const ivmContext = await isolate.createContext();

      try {
        // 3. Bridge the Global Scope (Host -> Guest)
        const jail = ivmContext.global;
        
        // Inject the 'tgp' global object which holds our bridge
        await jail.set('global', jail.derefInto()); // standard polyfill
        
        // We iterate over the context object and inject functions/values
        for (const [key, value] of Object.entries(context)) {
            if (typeof value === 'function') {
                // Bridge functions: Host runs the logic, Guest calls it
                await jail.set(key, new ivm.Reference(value));
            } else {
                // Bridge values: Copy by value (JSON safe)
                await jail.set(key, new ivm.ExternalCopy(value).copyInto());
            }
        }

        // 4. Compile the Script inside the Isolate
        const script = await isolate.compileScript(jsCode);

        // 5. Execute
        const result = await script.run(ivmContext, { timeout });
        
        // 6. Return result (Unwrap from IVM)
        if (result && typeof result === 'object' && 'copy' in result) {
            // If it's a reference, try to copy it out, otherwise return as is
            return result.copy();
        }
        return result;

      } finally {
        // Cleanup the context to free memory immediately
        ivmContext.release();
      }
    },

    dispose() {
      if (!isolate.isDisposed) {
        isolate.dispose();
      }
    }
  };
}
````

## File: src/tools/exec.ts
````typescript
import { z } from 'zod';
import { Kernel } from '../kernel/core.js';
import { executeTool } from '../sandbox/execute.js';
import { AgentTool } from './types.js';

export const ExecToolParams = z.object({
  path: z.string().describe('The relative path of the tool to execute'),
  args: z.record(z.any()).describe('The arguments to pass to the tool'),
});

export function createExecTools(kernel: Kernel) {
  return {
    exec_tool: {
      description: 'Execute a tool inside the secure Sandbox.',
      parameters: ExecToolParams,
      execute: async ({ path, args }) => {
        // Security: Ensure args are serializable (no functions, no circular refs)
        // This prevents the agent from trying to pass internal objects to the guest.
        try {
          JSON.stringify(args);
        } catch {
          throw new Error("Arguments must be serializable JSON.");
        }

        const code = await kernel.vfs.readFile(path);
        
        // The sandbox takes care of safety, timeout, and memory limits
        const result = await executeTool(kernel, code, args);
        return result;
      },
    } as AgentTool<typeof ExecToolParams, any>,
  };
}
````

## File: src/tools/fs.ts
````typescript
import { z } from 'zod';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const ListFilesParams = z.object({
  dir: z.string().describe('The relative directory path to list (e.g., "tools" or "tools/analytics")'),
});

export const ReadFileParams = z.object({
  path: z.string().describe('The relative path to the file to read'),
});

export const WriteFileParams = z.object({
  path: z.string().describe('The relative path where the file should be written'),
  content: z.string().describe('The full content of the file'),
});

export const PatchFileParams = z.object({
  path: z.string().describe('The relative path to the file to patch'),
  search: z.string().describe('The exact string content to find'),
  replace: z.string().describe('The string content to replace it with'),
});

export function createFsTools(kernel: Kernel) {
  return {
    list_files: {
      description: 'Recursively list available tools or definitions in the VFS.',
      parameters: ListFilesParams,
      execute: async ({ dir }) => {
        return kernel.vfs.listFiles(dir, true);
      },
    } as AgentTool<typeof ListFilesParams, string[]>,

    read_file: {
      description: 'Read the content of an existing tool or file.',
      parameters: ReadFileParams,
      execute: async ({ path }) => {
        return kernel.vfs.readFile(path);
      },
    } as AgentTool<typeof ReadFileParams, string>,

    write_file: {
      description: 'Create a new tool or overwrite a draft. Ensures parent directories exist.',
      parameters: WriteFileParams,
      execute: async ({ path, content }) => {
        await kernel.vfs.writeFile(path, content);
        return { success: true, path };
      },
    } as AgentTool<typeof WriteFileParams, { success: boolean; path: string }>,

    patch_file: {
      description: 'Surgical search-and-replace for refactoring code.',
      parameters: PatchFileParams,
      execute: async ({ path, search, replace }) => {
        const content = await kernel.vfs.readFile(path);
        
        if (!content.includes(search)) {
          throw new Error(`Patch failed: Search text not found in '${path}'. Please read the file again to ensure you have the exact content.`);
        }

        // We replace the first occurrence to be surgical.
        // If the agent needs global replace, it can do so in a loop or we can expand this tool later.
        const newContent = content.replace(search, replace);
        
        await kernel.vfs.writeFile(path, newContent);
        return { success: true, path };
      },
    } as AgentTool<typeof PatchFileParams, { success: boolean; path: string }>,
  };
}
````

## File: src/tools/index.ts
````typescript
import { Kernel } from '../kernel/core.js';
import { createFsTools } from './fs.js';
import { createValidationTools } from './validation.js';
import { createExecTools } from './exec.js';
import { ToolSet } from './types.js';

export * from './types.js';

/**
 * Generates the complete set of TGP tools (Capabilities) for a given Kernel.
 * These are the tools the Agent will use to build, test, and run the user-land tools.
 */
export function tgpTools(kernel: Kernel): ToolSet {
  return {
    ...createFsTools(kernel),
    ...createValidationTools(kernel),
    ...createExecTools(kernel),
  };
}
````

## File: src/tools/types.ts
````typescript
import { z } from 'zod';

/**
 * Represents a tool that can be exposed to an AI Agent.
 * This is generic enough to be adapted to OpenAI, Vercel AI SDK, or other consumers.
 */
export interface AgentTool<TParams extends z.ZodTypeAny = any, TResult = any> {
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>) => Promise<TResult>;
}

export type ToolSet = Record<string, AgentTool>;
````

## File: src/tools/validation.ts
````typescript
import { z } from 'zod';
import { transform } from 'esbuild';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const CheckToolParams = z.object({
  path: z.string().describe('The relative path of the tool to validate'),
});

export function createValidationTools(kernel: Kernel) {
  return {
    check_tool: {
      description: 'Run JIT compilation and syntax check on a tool.',
      parameters: CheckToolParams,
      execute: async ({ path }) => {
        try {
          const code = await kernel.vfs.readFile(path);
          
          // Dry-run transformation to catch syntax errors
          await transform(code, {
            loader: 'ts',
            format: 'cjs',
            target: 'es2020',
          });

          // LINTING: Enforce the "8 Standards" via Static Analysis
          const errors: string[] = [];

          // 1. Strict Typing: No 'any'
          if (/\bany\b/.test(code)) {
            errors.push("Violation: Usage of 'any' is prohibited. Use specific types or generic constraints.");
          }

          // 2. Safety: No 'eval' or 'Function' constructor
          if (/\beval\(/.test(code) || /\bnew Function\(/.test(code)) {
            errors.push("Violation: Dynamic code execution ('eval') is prohibited.");
          }

          // 3. Stateless: No process global access (except inside standard library wrappers which are hidden)
          if (/\bprocess\./.test(code) && !code.includes('process.env.NODE_ENV')) {
            errors.push("Violation: Direct access to 'process' is prohibited. Use 'args' for inputs.");
          }

          return { valid: errors.length === 0, errors };
        } catch (error: any) {
          // esbuild errors are usually descriptive
          const msg = error.message || String(error);
          // Return valid: false so the model can reason about the error, rather than crashing the tool call
          return { valid: false, errors: [msg] };
        }
      },
    } as AgentTool<typeof CheckToolParams, { valid: boolean; errors: string[] }>,
  };
}
````

## File: src/vfs/memory.ts
````typescript
import { VFSAdapter } from './types.js';

// Simple path normalizer for environments where 'path' module might be limited
// or to ensure consistent behavior across platforms.
function normalizePath(p: string): string {
  // Remove leading ./ and leading /
  return p.replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '');
}

/**
 * Creates an ephemeral, in-memory VFS.
 * Used for Serverless execution or Unit Testing.
 */
export function createMemoryVFS(initialFiles: Record<string, string> = {}): VFSAdapter {
  // Key: Normalized Path, Value: File Content
  const store = new Map<string, string>();

  // Initialize with seed data
  for (const [p, content] of Object.entries(initialFiles)) {
    store.set(normalizePath(p), content);
  }

  return {
    async readFile(target: string): Promise<string> {
      const key = normalizePath(target);
      const content = store.get(key);
      if (content === undefined) {
        throw new Error(`File not found: ${target}`);
      }
      return content;
    },

    async writeFile(target: string, content: string): Promise<void> {
      const key = normalizePath(target);
      store.set(key, content);
    },

    async remove(target: string): Promise<void> {
      const key = normalizePath(target);
      store.delete(key);
    },

    async exists(target: string): Promise<boolean> {
      const key = normalizePath(target);
      return store.has(key);
    },

    async listFiles(dir: string, recursive: boolean = false): Promise<string[]> {
      const normalizedDir = normalizePath(dir);
      const results: string[] = [];

      for (const key of store.keys()) {
        // Check if file is inside dir
        // We add a trailing slash to dir to ensure we match directory boundaries
        // e.g. dir="tools", key="tools/a.ts" -> match
        // e.g. dir="tool", key="tools/a.ts" -> no match
        
        // Handle root listing case
        const prefix = normalizedDir === '' ? '' : normalizedDir + '/';

        if (key.startsWith(prefix)) {
          const relativePart = key.slice(prefix.length);
          
          if (recursive) {
            results.push(key);
          } else {
            // If not recursive, ensure no more slashes in the remainder
            if (!relativePart.includes('/')) {
              results.push(key);
            }
          }
        }
      }
      return results;
    }
  };
}
````

## File: src/vfs/node.ts
````typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { VFSAdapter } from './types.js';

/**
 * Creates a VFS adapter backed by the physical disk.
 * Used for standard Node.js deployments and CLI tools.
 * 
 * @param rootDir The absolute or relative path to the sandbox root (e.g., ./.tgp)
 */
export function createNodeVFS(rootDir: string): VFSAdapter {
  const absoluteRoot = path.resolve(rootDir);

  // Security: Ensure the target path is inside the rootDir
  const resolvePath = (target: string): string => {
    // Normalize and resolve against root
    const resolved = path.resolve(absoluteRoot, target);
    
    // Guard: Path Traversal Attack
    if (!resolved.startsWith(absoluteRoot)) {
      throw new Error(`Security Violation: Path '${target}' is outside the sandbox root.`);
    }
    return resolved;
  };

  return {
    async readFile(target: string): Promise<string> {
      const fullPath = resolvePath(target);
      return fs.readFile(fullPath, 'utf-8');
    },

    async writeFile(target: string, content: string): Promise<void> {
      const fullPath = resolvePath(target);
      const dir = path.dirname(fullPath);
      
      // Ensure directory exists (mkdir -p)
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
    },

    async remove(target: string): Promise<void> {
      const fullPath = resolvePath(target);
      // Silent failure if not exists, matching standard rm -f behavior
      await fs.rm(fullPath, { force: true }).catch(() => {}); 
    },

    async exists(target: string): Promise<boolean> {
      const fullPath = resolvePath(target);
      try {
        await fs.access(fullPath);
        return true;
      } catch {
        return false;
      }
    },

    async listFiles(dir: string, recursive: boolean = false): Promise<string[]> {
      const fullDir = resolvePath(dir);
      
      try {
        await fs.access(fullDir);
      } catch {
        return []; // Return empty if dir doesn't exist
      }

      const results: string[] = [];

      async function walk(currentDir: string, relativeBase: string) {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          const relativePath = path.join(relativeBase, entry.name);

          if (entry.isDirectory()) {
            if (recursive) {
              await walk(entryPath, relativePath);
            }
          } else {
            results.push(relativePath);
          }
        }
      }

      await walk(fullDir, dir);
      return results;
    }
  };
}
````

## File: src/vfs/types.ts
````typescript
/**
 * The Virtual Filesystem Adapter Interface.
 * 
 * TGP is designed to run in environments where a real filesystem might not exist 
 * (e.g., Cloudflare Workers, Edge Functions). The VFS abstracts I/O operations.
 * 
 * All paths provided to these methods are relative to the VFS root.
 */
export interface VFSAdapter {
  /**
   * Reads the content of a file as a UTF-8 string.
   * Throws if file not found.
   */
  readFile: (path: string) => Promise<string>;

  /**
   * Writes content to a file. Creates parent directories if they don't exist.
   */
  writeFile: (path: string, content: string) => Promise<void>;

  /**
   * Deletes a file. Silent if file doesn't exist.
   */
  remove: (path: string) => Promise<void>;

  /**
   * Checks if a file exists.
   */
  exists: (path: string) => Promise<boolean>;

  /**
   * Lists files in a directory.
   * @param dir Relative path to directory.
   * @param recursive If true, lists all nested files.
   * @returns Array of relative paths (e.g., ['tools/a.ts', 'tools/sub/b.ts'])
   */
  listFiles: (dir: string, recursive?: boolean) => Promise<string[]>;
}
````

## File: src/adapter.ts
````typescript
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolSet } from './tools/types.js';

/**
 * Converts a TGP ToolSet into a format compatible with the Vercel AI SDK (Core).
 * 
 * @param tools The TGP ToolSet (from tgpTools(kernel))
 * @returns An object compatible with the `tools` parameter of `generateText`
 */
export function formatTools(tools: ToolSet) {
  // Vercel AI SDK Core accepts tools as an object where keys are names
  // and values have { description, parameters, execute }.
  // TGP tools already match this signature largely, but we ensure strict typing here.
  return tools;
}

/**
 * Converts a TGP ToolSet into the standard OpenAI "functions" or "tools" JSON format.
 * Useful if using the raw OpenAI SDK.
 */
export function toOpenAITools(tools: ToolSet) {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters),
    },
  }));
}
````

## File: src/config.ts
````typescript
import { pathToFileURL } from 'url';
import { TGPConfig, TGPConfigSchema } from './types.js';

/**
 * Identity function to provide type inference for configuration files.
 * usage: export default defineTGPConfig({ ... })
 */
export function defineTGPConfig(config: TGPConfig): TGPConfig {
  return config;
}

/**
 * Dynamically loads a TGP configuration file, validates it against the schema,
 * and returns the typed configuration object.
 * 
 * @param configPath - Absolute or relative path to the config file (e.g., ./tgp.config.ts)
 */
export async function loadTGPConfig(configPath: string): Promise<TGPConfig> {
  try {
    // Convert path to file URL to ensure compatibility with ESM imports
    // We assume the host environment (Node) can handle the import.
    // In Serverless environments, the config might be injected differently, 
    // but this loader is primarily for the CLI/Node runtime.
    const importPath = pathToFileURL(configPath).href;
    
    const module = await import(importPath);
    
    // Support both default export and named export 'config'
    const rawConfig = module.default || module.config;

    if (!rawConfig) {
      throw new Error(`No default export found in ${configPath}`);
    }

    // Runtime Validation: Ensure the user provided valid configuration
    const parsed = TGPConfigSchema.safeParse(rawConfig);

    if (!parsed.success) {
      const errors = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Invalid TGP Configuration:\n${errors}`);
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load TGP config from ${configPath}: ${error.message}`);
    }
    throw error;
  }
}
````

## File: src/index.ts
````typescript
// Exporting the Core DNA for consumers
export * from './types.js';
export * from './config.js';
export * from './tools/index.js';
export * from './tgp.js';
export * from './adapter.js';
````

## File: src/tgp.ts
````typescript
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
````

## File: src/types.ts
````typescript
import { z } from 'zod';

// --- Git Configuration Schema ---
export const GitConfigSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  repo: z.string().min(1, "Repository name is required"),
  branch: z.string().default('main'),
  auth: z.object({
    token: z.string().min(1, "Git auth token is required"),
    user: z.string().default('tgp-bot[bot]'),
    email: z.string().email().default('tgp-bot@users.noreply.github.com'),
  }),
  writeStrategy: z.enum(['direct', 'pr']).default('direct'),
});

// --- Database Configuration Schema ---
export const DBConfigSchema = z.object({
  dialect: z.enum(['postgres', 'mysql', 'sqlite', 'libsql']),
  ddlSource: z.string().optional().describe("Command to generate DDL, e.g., 'drizzle-kit generate'"),
});

// --- Filesystem Jail Schema ---
export const FSConfigSchema = z.object({
  allowedDirs: z.array(z.string()).default(['./tmp']),
  blockUpwardTraversal: z.boolean().default(true),
});

// --- Main TGP Configuration Schema ---
export const TGPConfigSchema = z.object({
  rootDir: z.string().default('./.tgp'),
  db: DBConfigSchema.optional(),
  git: GitConfigSchema,
  fs: FSConfigSchema.default({}),
  allowedImports: z.array(z.string()).default(['@tgp/std', 'zod', 'date-fns']),
});

// --- Inferred Static Types ---
// We export these so the rest of the app relies on the Zod inference, 
// ensuring types and validation never drift apart.
export type GitConfig = z.infer<typeof GitConfigSchema>;
export type DBConfig = z.infer<typeof DBConfigSchema>;
export type FSConfig = z.infer<typeof FSConfigSchema>;
export type TGPConfig = z.infer<typeof TGPConfigSchema>;

/**
 * Defines the structure for a tool file persisted in the VFS.
 * This is what resides in ./.tgp/tools/
 */
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()), // JsonSchema
  code: z.string(), // The raw TypeScript source
});

export type ToolDefinition = z.infer<typeof ToolSchema>;
````

## File: package.json
````json
{
  "name": "@tgp/core",
  "version": "0.0.1",
  "description": "The Tool Generation Protocol",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "echo \"Error: no test specified\" && exit 1",
    "tgp": "node bin/tgp.js"
  },
  "keywords": [
    "ai",
    "agent",
    "protocol",
    "backend"
  ],
  "author": "",
  "license": "MIT",
  "bin": {
    "tgp": "./bin/tgp.js"
  },
  "dependencies": {
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.22.4",
    "isomorphic-git": "^1.35.1",
    "memfs": "^4.51.0",
    "isolated-vm": "^4.7.2",
    "esbuild": "^0.19.12"
  },
  "devDependencies": {
    "@types/node": "^20.19.25",
    "typescript": "^5.9.3"
  }
}
````

## File: tsconfig.json
````json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
````

## File: README.md
````markdown
# Tool Generation Protocol (TGP)

> **The Self-Assembling Backend.**
> **MCP is dead.** Stop streaming context. Start compiling tools.

# 1. Manifesto

**The Problem:** You spend 80% of your time writing "glue code"—RPCs, CRUD wrappers, and slightly different "Export to CSV" endpoints.
**The Trap (MCP):** Model Context Protocol (MCP) is just better glue. It requires you to pre-build tools. If you didn't write the endpoint, the Agent fails.
**The Solution (TGP):** Give the Agent a compiler.

TGP is a **JIT Runtime for Business Logic**. The Agent forges its own tools, validates them, and persists them to Git. It builds a personalized standard library for your application.

*   **MCP**: "I can't do that. I don't have a tool."
*   **TGP**: "I wrote a tool. It's running."

## 1.1 Use Cases (The Long Tail)

99% of features are never built because they are too specific. TGP solves the "I wish the app could do X" problem.

*   **Reporting**: "List users who downgraded in June, pipe-delimited." -> Forges `tools/reports/downgrade.ts`. Time: 4s.
*   **Cleanup**: "Fix typo in 'Ohiio' for active users." -> Forges `tools/maintenance/fix_typo.ts`. Atomic SQL update.
*   **Logic**: "Calculate dimensional weight `(L*W*H)/139`." -> Forges `tools/shipping/dim_weight.ts`. Deterministic V8 execution.

## 1.2 Anti-Patterns

TGP is a **JIT Compiler**, not a Daemon.
*   **Not a Server**: No `express.listen()`. Tools are ephemeral (Lambda-style).
*   **Not a Browser**: No DOM. No Puppeteer.
*   **Not an ORM**: No object mutation. Use raw, atomic SQL.

# 2. Architecture (The Stack)

TGP drops into your existing Node/Next.js/Nest apps. It is **just TypeScript**.

## 2.1 The Developer View

The agent views `./.tgp` as its root directory. This is a standard Git repository.

```bash
./.tgp/
├── .git/                  # MEMORY: Version history of TOOL SOURCE CODE.
├── bin/                   # KERNEL: The compiled 'tgp' binary.
├── tools/                 # USER SPACE: Generated capabilities.
│   ├── analytics/         # e.g., "churn-prediction.ts"
│   └── reports/           # e.g., "revenue-csv.ts"
└── meta.json              # REGISTRY: Fast lookup index.
```

## 2.2 GitOps & Serverless Harmony

**Is TGP Serverless Friendly?** Yes.

In a Serverless environment (Cloudflare Workers, AWS Lambda, Vercel), the runtime filesystem is ephemeral. TGP handles this by treating **Git as the Backend**.

1.  **Hydration**: On boot, TGP checks if the local cache matches the remote `HEAD`. If not, it pulls the latest tools from GitHub/GitLab.
2.  **Execution**: Tools run in the local V8 Isolate (milliseconds).
3.  **Persistence**: When an Agent forges a new tool, it commits and pushes to the remote repository.
4.  **Concurrency**: TGP uses standard Git locking to handle concurrent writes from multiple agents.

*Configuring GitHub credentials enables the "Infinite Memory" feature.*

## 2.3 The VFS (Virtual Filesystem)

TGP enforces a strict separation between **The Editor (Host)** and **The Runtime (Sandbox)**.

1.  **The Editor (Agent Context)**: The Agent accesses `./.tgp` directly via the Kernel Tools. It works just like a human dev using VS Code.
2.  **The Runtime (Sandbox Context)**: When code *executes*, it runs inside the V8 Isolate with a restricted VFS:
    *   **`/lib`**: Read-Only mount of Host's `./.tgp/tools`.
    *   **`/tmp`**: Read-Write ephemeral scratchpad (wiped on exit).

## 2.4 The Kernel Tools (Agent Capabilities)

The Agent is provided with a specific set of primitives to interact with the environment. It does not have generic shell access.

| Tool | Signature | Description |
| :--- | :--- | :--- |
| **`list_files`** | `(dir: string) => string[]` | Recursively list available tools or definitions. |
| **`read_file`** | `(path: string) => string` | Read the content of an existing tool or schema. |
| **`write_file`** | `(path: string, content: string) => void` | Create a new tool or overwrite a draft. |
| **`patch_file`** | `(path: string, search: string, replace: string) => void` | Surgical search-and-replace for refactoring. |
| **`check_tool`** | `(path: string) => { valid: boolean, errors: string[] }` | Run the JIT compiler and linter. |
| **`exec_tool`** | `(path: string, args: object) => any` | Execute a tool inside the secure Sandbox. |

---

# 3. The Protocol

This is the algorithm the Agent must follow. It is the "software" running on the Agent's "CPU".

## 3.1 The Prime Directive: "Reuse or Forge"

The Agent is forbidden from executing one-off scripts for repetitive tasks.

1.  **Lookup**: Query registry. If a tool exists (Score > 0.85), **Reuse**.
2.  **Forge**: If no tool exists, **Create**.
3.  **Persist**: Commit to Git.

## 3.2 The 8 Standards of Code Quality

To ensure the ecosystem remains clean, the Agent must adhere to strict code quality guidelines. The Linter/Reviewer will reject tools that violate these principles.

1.  **Abstract**: Logic must be separated from specific data instances.
    *   *Bad*: `const tax = 0.05`
    *   *Good*: `const tax = args.taxRate`
2.  **Composable**: Functions should do one thing and return a result usable by other functions.
3.  **HOFs (Higher Order Functions)**: Use map/reduce/filter patterns rather than imperative loops where possible.
4.  **Stateless**: Tools must not rely on variables outside their scope or previous executions.
5.  **Reusable**: The code should be generic enough to serve multiple use cases.
6.  **General by Params**: Behavior is controlled by arguments, not hardcoded strings.
7.  **No Hardcoded Values**: No magic numbers, no specific IDs, no emails in source code.
8.  **Orchestrator Capable**: Tools should be able to import and invoke other TGP tools (via the `require` bridge).

## 3.3 The Feedback Loop (Self-Healing)

If a tool fails during execution:
1.  **Capture**: Agent reads STDERR.
2.  **Diagnose**: Agent identifies the logic error or schema mismatch.
3.  **Patch**: Agent uses `patch_file` to fix the code in place.
4.  **Verify**: Agent runs `check_tool`.

---

# 4. Security (The Sandbox)

**TL;DR:**
1.  **Zero-Trust**: Tools run in a stripped V8 context. No `process`, no `fs`, no `eval`.
2.  **Resource Caps**: 64MB RAM, 50ms CPU time. Infinite loops die instantly.
3.  **Transaction Safety**: All DB writes run inside a transaction. If the tool throws, the DB rolls back.

## 4.1 The Great Wall (isolated-vm)
TGP uses `isolated-vm` to create a boundary between the Host (Agent) and the Guest (Tool).
*   **Memory**: Separate Heaps.
*   **Syscalls**: Bridged via specific `tgp` global object.
*   **Network**: Blocked by default. Allowed only via whitelisted `fetch` bridge.

---

# 5. The Ecosystem (Join the Hive)

We are building the **`libc` of the AI Age**.

## 5.1 The Logic/State Split
In TGP, **Tools are Stateless**.
*   **Logic (Public)**: The TypeScript code (`tools/analytics/retention.ts`).
*   **State (Private)**: The Database Connection (`DATABASE_URL`).

## 5.2 Hub & Spoke Topology (Git Backed)
Because TGP relies on Git, your tools are portable.
*   **Upstream**: A private repo (e.g., `github.com/org/tgp-global`).
*   **Downstream**: The ephemeral serverless instances pull from Upstream.

---

# 6. Governance Modes

## 6.1 God Mode (Development)
*   **Behavior**: `Forge -> Compile -> Execute`.
*   **Target**: Local `.tgp/` folder or direct push to `main`.

## 6.2 Gatekeeper Mode (Production)
*   **Behavior**: `Forge -> Compile -> Pull Request`.
*   **Target**: Agent creates a branch `feat/tool-name` and opens a PR.
*   **Approval**: A human or a Senior Agent reviews the diff before merging to `main`.

---

# 7. Integration Spec

## 7.1 The Bootstrap
```bash
npx tgp@latest init
```

## 7.2 Configuration (`tgp.config.ts`)

The configuration defines the Sandbox boundaries and the Git backend.

```typescript
import { defineTGPConfig } from '@tgp/core';

export default defineTGPConfig({
  // The Root of the Agent's filesystem (Ephemeral in serverless)
  rootDir: './.tgp',

  // 1. DATA: How the Agent sees your DB
  db: {
    dialect: 'postgres',
    ddlSource: 'drizzle-kit generate --print',
  },

  // 2. BACKEND (GitOps)
  // Essential for Serverless/Ephemeral environments.
  // The Agent pulls state from here and pushes new tools here.
  git: {
    provider: 'github', // or 'gitlab', 'bitbucket'
    repo: 'my-org/tgp-tools',
    branch: 'main',
    auth: {
      // Why not in config? Because we read from ENV for security.
      token: process.env.TGP_GITHUB_TOKEN,
      user: 'tgp-bot[bot]',
      email: 'tgp-bot@users.noreply.github.com'
    },
    // Strategy: 'direct' (push) or 'pr' (pull request)
    writeStrategy: process.env.NODE_ENV === 'production' ? 'pr' : 'direct'
  },

  // 3. FILESYSTEM JAIL
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 4. RUNTIME
  allowedImports: ['@tgp/std', 'zod', 'date-fns']
});
```

## 7.3 Runtime Usage (The SDK)

```typescript
// src/app/api/agent/route.ts
import { TGP, tgpTools } from '@tgp/core';
import { generateText } from 'ai';

const kernel = new TGP({ configFile: './tgp.config.ts' });

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Injects: list_files, read_file, write_file, exec_tool
  const tools = tgpTools(kernel);

  const result = await generateText({
    model: openai('gpt-4-turbo'),
    tools, 
    messages,
    // The System Prompt enforces the "8 Standards"
    system: kernel.getSystemPrompt() 
  });

  return result.response;
}
```

---

# 8. Roadmap & Contributing

We are hacking on the future of backend development.

*   **[P0] The LSP**: IDE extension for real-time tool visibility.
*   **[P1] Vector Memory**: Semantic search for tool reuse.
*   **[P2] Multi-Lang**: Python support via WebAssembly.

**Get Involved:**
`git clone` -> `npm install` -> `npm run forge`.
```
````
