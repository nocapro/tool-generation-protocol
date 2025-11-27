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
    db.ts
    git.ts
    registry.ts
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
eslint.config.js
export interface Kernel {
package.json
README.md
tsconfig.json
```

# Files

## File: export interface Kernel {
````
boot(): Promise<void>;
  shutdown(): Promise<void>;
  config: TGPConfig;
  vfs: VFSAdapter;
  git: GitBackend;
  db: DBBackend;
  registry: Registry;
}
````

## File: bin/tgp.js
````javascript
#!/usr/bin/env node

import { cli } from '../dist/cli/index.js';

cli().catch((err) => {
  console.error('TGP CLI Error:', err);
  process.exit(1);
});
````

## File: src/kernel/registry.ts
````typescript
/* eslint-disable no-console */
import { VFSAdapter } from '../vfs/types.js';
import { RegistryState, ToolMetadata } from '../types.js';
import * as path from 'path';

export interface Registry {
  hydrate(): Promise<void>;
  register(filePath: string, code: string): Promise<void>;
  list(): ToolMetadata[];
  sync(): Promise<void>;
}

export function createRegistry(vfs: VFSAdapter): Registry {
  let state: RegistryState = { tools: {} };
  const META_PATH = 'meta.json';

  // Helper to parse JSDoc
  function extractMetadata(filePath: string, code: string): ToolMetadata {
    const name = path.basename(filePath, path.extname(filePath));
    
    // Simple JSDoc Regex: /** ... */
    const jsDocMatch = code.match(/\/\*\*([\s\S]*?)\*\//);
    let description = "No description provided.";
    
    if (jsDocMatch) {
      const content = jsDocMatch[1];
      // Clean up stars and whitespace
      description = content
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .filter(line => !line.startsWith('@') && line.length > 0) // Remove param tags and empty lines
        .join(' ');
    }

    return {
      name,
      description: description || "No description provided.",
      path: filePath
    };
  }

  return {
    async hydrate() {
      if (await vfs.exists(META_PATH)) {
        try {
          const content = await vfs.readFile(META_PATH);
          state = JSON.parse(content);
        } catch (err) {
          console.warn('[TGP] Failed to parse meta.json, starting fresh.', err);
          state = { tools: {} };
        }
      }
    },

    async register(filePath: string, code: string) {
      // Ignore non-tool files (e.g. config or hidden files)
      if (!filePath.startsWith('tools/') && !filePath.startsWith('tools\\')) return;

      const metadata = extractMetadata(filePath, code);
      state.tools[filePath] = metadata;
      
      // We don't sync on every register to avoid IO storm if called in loop, 
      // but for write_file it is fine.
      await this.sync();
    },

    list() {
      return Object.values(state.tools);
    },

    async sync() {
      await vfs.writeFile(META_PATH, JSON.stringify(state, null, 2));
    }
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
import { TGPConfigSchema, TGPConfig } from './types.js';
import { VFSAdapter } from './vfs/types.js';
import { GitBackend } from './kernel/git.js';
import { DBBackend } from './kernel/db.js';
import { Registry } from './kernel/registry.js';

export interface TGPOptions {
  /**
   * Path to the configuration file.
   * @default "./tgp.config.ts"
   */
  configFile?: string;
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
  
  private _isBooted = false;

  constructor(private opts: TGPOptions = {}) {
    // 1. Initialize with Defaults (Sync)
    // We use the default schema to ensure the kernel is usable immediately (e.g. for tooling)
    // even before the async config load completes.
    this.config = TGPConfigSchema.parse({});
    
    // 2. Setup Default VFS
    // This allows tgpTools(kernel) to be called immediately.
    this.vfs = createNodeVFS(this.config.rootDir);

    // 3. Initialize Kernel Components
    // We use the underlying factory to wire up Git, DB, and Registry
    const kernel = createKernel({
      config: this.config,
      vfs: this.vfs,
      fs // Pass raw node:fs for isomorphic-git
    });

    this.git = kernel.git;
    this.db = kernel.db;
    this.registry = kernel.registry;
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

      // 2. Re-initialize VFS if RootDir changed
      // If the user configured a different rootDir, we must update the VFS.
      this.vfs = createNodeVFS(this.config.rootDir);

      // 3. Re-initialize Kernel Components with new Config/VFS
      const kernel = createKernel({
        config: this.config,
        vfs: this.vfs,
        fs
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
````

## File: eslint.config.js
````javascript
import typescriptESLint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptESLint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-unused-expressions': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js'],
  },
];
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

## File: src/cli/index.ts
````typescript
/* eslint-disable no-console */
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
/* eslint-disable no-console */
import * as fs from 'fs/promises';
import * as path from 'path';

export async function initCommand() {
  const cwd = process.cwd();
  console.log(`[TGP] Initializing in ${cwd}...`);

  const configPath = path.join(cwd, 'tgp.config.ts');
  const gitIgnorePath = path.join(cwd, '.gitignore');
  const tgpDir = path.join(cwd, '.tgp');
  const toolsDir = path.join(tgpDir, 'tools');
  const metaPath = path.join(tgpDir, 'meta.json');

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

  // 4. Scaffold Tools directory
  await fs.mkdir(toolsDir, { recursive: true });
  console.log(`[TGP] Created .tgp/tools directory`);

  // 5. Initialize Registry (meta.json)
  if (!await exists(metaPath)) {
    await fs.writeFile(metaPath, JSON.stringify({ tools: {} }, null, 2));
    console.log(`[TGP] Created .tgp/meta.json`);
  }

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

## File: src/kernel/db.ts
````typescript
/* eslint-disable no-console */
/**
 * The Database Kernel Interface.
 * 
 * TGP guarantees that all tool executions happen within a transaction.
 * If the tool throws, the transaction is rolled back.
 */
export interface DBBackend {
  /**
   * Executes a raw SQL query.
   * @param sql The SQL query string.
   * @param params Parameter substitutions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<any[]>;

  /**
   * Wraps a function in a database transaction.
   * @param fn The function to execute. It receives a transactional DB instance.
   */
  transaction<T>(fn: (trx: DBBackend) => Promise<T>): Promise<T>;
}

/**
 * A No-Op Database Backend used when no DB is configured.
 * It logs operations to the console to verify behavior.
 */
export function createNoOpDB(): DBBackend {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params: any[] = []) {
      console.log(`[TGP-DB] Query: ${sql}`, params);
      return [];
    },

    async transaction<T>(fn: (trx: DBBackend) => Promise<T>): Promise<T> {
      console.log(`[TGP-DB] Begin Transaction`);
      try {
        // In a real DB, we would start a trx here.
        // We pass 'this' as the transactional client (NoOp doesn't distinguish)
        const result = await fn(this);
        console.log(`[TGP-DB] Commit Transaction`);
        return result;
      } catch (err) {
        console.log(`[TGP-DB] Rollback Transaction`);
        throw err;
      }
    }
  };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compileAndRun: (code: string, context: Record<string, any>) => Promise<any>;
  dispose: () => void;
}

/**
 * Creates a secure V8 Isolate.
 */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const memoryLimit = opts.memoryLimitMb ?? 128;
  const timeout = opts.timeoutMs ?? 5000;

  // Create the heavy V8 Isolate (The Virtual Machine)
  const isolate = new ivm.Isolate({ memoryLimit });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        // Inject Context
        for (const [key, value] of Object.entries(context)) {
            // Special handling for the 'tgp' namespace object
            if (key === 'tgp' && typeof value === 'object' && value !== null) {
                // Initialize the namespace in the guest
                await isolate.compileScript('global.tgp = {}').then(s => s.run(ivmContext));
                const tgpHandle = await jail.get('tgp');
                
                // Populate the namespace
                for (const [subKey, subValue] of Object.entries(value)) {
                    if (typeof subValue === 'function') {
                       // Functions must be passed by Reference
                       await tgpHandle.set(subKey, new ivm.Reference(subValue));
                    } else {
                       // Values are copied
                       await tgpHandle.set(subKey, new ivm.ExternalCopy(subValue).copyInto());
                    }
                }
            } 
            // Handle top-level functions (like __tgp_load_module)
            else if (typeof value === 'function') {
              await jail.set(key, new ivm.Reference(value));
            } 
            // Handle standard values
            else {
              await jail.set(key, new ivm.ExternalCopy(value).copyInto());
            }
        }

        // 4. Compile the Script inside the Isolate
        const script = await isolate.compileScript(jsCode);

        // 5. Execute
        const result = await script.run(ivmContext, { timeout });
        
        // 6. Return result (Unwrap from IVM)
        if (typeof result === 'object' && result !== null && 'copy' in result) {
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
        
        // Register the new tool in the Registry (updates meta.json)
        await kernel.registry.register(path, content);

        // Persist to Git (Tool + meta.json)
        await kernel.git.persist(`Forge: ${path}`, [path, 'meta.json']);

        return { success: true, path, persisted: true };
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

        // Update registry in case descriptions changed
        await kernel.registry.register(path, newContent);

        await kernel.git.persist(`Refactor: ${path}`, [path, 'meta.json']);

        return { success: true, path, persisted: true };
      },
    } as AgentTool<typeof PatchFileParams, { success: boolean; path: string }>,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // esbuild errors are usually descriptive
          const msg = error.message ?? String(error);
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

    readSync(target: string): string {
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
   * Synchronously reads the content of a file.
   * Required for 'require' (synchronous module loading) in the Sandbox.
   */
  readSync: (path: string) => string;

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

export interface ToolMetadata {
  name: string;
  description: string;
  path: string;
}

export interface RegistryState {
  tools: Record<string, ToolMetadata>;
}
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
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
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
    "esbuild": "^0.19.12",
    "isolated-vm": "^4.7.2",
    "isomorphic-git": "^1.35.1",
    "memfs": "^4.51.0",
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.19.25",
    "@typescript-eslint/eslint-plugin": "^8.48.0",
    "@typescript-eslint/parser": "^8.48.0",
    "eslint": "^9.39.1",
    "typescript": "^5.9.3"
  }
}
````

## File: src/kernel/core.ts
````typescript
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
````

## File: src/kernel/git.ts
````typescript
/* eslint-disable no-console */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const gitDirExists = (await fs.promises.stat(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false)) as boolean;

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
        try {
           // check if file exists before adding (might be deleted, though not in this context)
           await git.add({ ...gitOpts, filepath });
        } catch (e) {
           // If file doesn't exist, maybe it was a deletion? 
           // For TGP v1 we assume add/update.
           console.warn(`[TGP] Git Add failed for ${filepath}`, e);
        }
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
/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import { DBBackend } from '../kernel/db.js';

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * We expose a structured 'tgp' object to the guest.
 */
export function createSandboxBridge(kernel: Kernel, db: DBBackend) {
  const { vfs } = kernel;

  return {
    tgp: {
      // --- Filesystem Bridge (Jailed) ---
      read_file: async (path: string) => {
        return vfs.readFile(path);
      },

      write_file: async (path: string, content: string) => {
        return vfs.writeFile(path, content);
      },

      list_files: async (dir: string) => {
        return vfs.listFiles(dir, false);
      },

      // --- Network Bridge (Allowed Only) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: async (url: string, init?: any) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: any[]) => {
        console.log('[TGP-TOOL]', ...args);
      },

      // --- Database (Transactional) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db_query: async (sql: string, params: any[] = []) => {
        return db.query(sql, params);
      }
    }
  };
}
````

## File: src/sandbox/execute.ts
````typescript
/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';
import { transformSync } from 'esbuild';
import * as path from 'path';

/**
 * Executes a tool script within a secure sandbox.
 * 
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 * @param filePath Optional path of the tool being executed (used for relative imports)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeTool(kernel: Kernel, code: string, args: Record<string, any> = {}, filePath: string = 'root.ts'): Promise<any> {
  const sandbox = createSandbox({
    memoryLimitMb: 128,
    timeoutMs: 5000 // 5s hard limit
  });

  try {
    // 1. Transactional Safety
    // All tool execution happens within a DB transaction.
    return await kernel.db.transaction(async (trx) => {
      const bridge = createSandboxBridge(kernel, trx);

      // 2. Module Orchestration (The 'require' Bridge)
      // This host function is called synchronously from the Guest.
      const __tgp_load_module = (baseDir: string, importId: string) => {
        // Security: Ensure we don't traverse out of sandbox (handled by VFS)
        // Resolution Logic:
        // - Starts with '.': Relative to baseDir
        // - Otherwise: Absolute from root (or relative to root)
        
        let targetPath = '';
        if (importId.startsWith('.')) {
          targetPath = path.join(baseDir, importId);
        } else {
          targetPath = importId;
        }

        // Normalize extension (assume .ts if missing)
        if (!targetPath.endsWith('.ts') && !targetPath.endsWith('.js')) {
           // Check if it exists with .ts
           // We can't easily check existence sync in VFS without try/catch read
           // Let's assume .ts for TGP tools
           targetPath += '.ts';
        }

        try {
          const raw = kernel.vfs.readSync(targetPath);
          const transformed = transformSync(raw, {
            loader: 'ts',
            format: 'cjs',
            target: 'es2020',
          });
          
          return {
            code: transformed.code,
            path: targetPath,
            dirname: path.dirname(targetPath)
          };
        } catch (err: any) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          throw new Error(`Failed to load module '${importId}' from '${baseDir}': ${err.message}`);
        }
      };

      // 3. Shim Injection
      // We prepend a CommonJS loader shim to the user code.
      // This allows 'require' to work by calling back to __tgp_load_module.
      const shim = `
        const __moduleCache = {};

        function __makeRequire(baseDir) {
          return function(id) {
            // Check Cache (Global)
            // In a real system, cache keys should be absolute paths.
            // Here we rely on the host to return consistent paths if we wanted perfect caching.
            // For now, we skip cache or use simple ID (flawed for relatives).
            // Let's implement correct caching by asking Host for absolute path first?
            // Simpler: Just reload for now (Stateless).
            
            // Call Host Sync
            const mod = __tgp_load_module.applySync(undefined, [baseDir, id]);
            
            if (__moduleCache[mod.path]) return __moduleCache[mod.path];

            // Wrap in CommonJS Function
            const fun = new Function('exports', 'require', 'module', '__filename', '__dirname', mod.code);
            const newModule = { exports: {} };
            
            // Execute
            fun(newModule.exports, __makeRequire(mod.dirname), newModule, mod.path, mod.dirname);
            
            __moduleCache[mod.path] = newModule.exports;
            return newModule.exports;
          };
        }
        
        // Setup Global Require for the entry point
        // We assume the entry point is at 'filePath'
        global.require = __makeRequire('${path.dirname(filePath)}');
      `;

      const context = {
        ...bridge, // { tgp: { ... } }
        args,
        __tgp_load_module // Injected as Reference
      };

      // Combine Shim + User Code
      // We wrap user code to provide top-level CommonJS variables if needed, 
      // but standard TGP tools are just scripts. 
      // We append the code. The 'shim' sets up 'global.require'.
      const fullScript = shim + '\n' + code;

      const result = await sandbox.compileAndRun(fullScript, context);
      return result;
    });

  } catch (error) {
    console.error(`[TGP] Tool Execution Failed:`, error);
    throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    sandbox.dispose();
  }
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
        const result = await executeTool(kernel, code, args, path);
        return result;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as AgentTool<typeof ExecToolParams, any>,
  };
}
````

## File: src/vfs/node.ts
````typescript
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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

    readSync(target: string): string {
      const fullPath = resolvePath(target);
      return readFileSync(fullPath, 'utf-8');
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
      // eslint-disable-next-line @typescript-eslint/no-empty-function
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
