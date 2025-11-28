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
    registry.ts
  sandbox/
    bridge.ts
    bundler.ts
    execute.ts
    isolate.ts
  tools/
    exec.ts
    fs.ts
    index.ts
    sql.ts
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
test/
  integration/
    bridge.test.ts
    gitops.test.ts
    sql.test.ts
test-docs/
  e2e.test-plan.md
  integration.test-plan.md
  unit.test-plan.md
eslint.config.js
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

## File: test/integration/bridge.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, createTgpConfig, cleanupDir, initBareRepo } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools } from '../../src/tools/index.js';

describe('Integration: Kernel <-> Sandbox Bridge', () => {
  let tempDir: string;
  let remoteRepo: string;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-bridge-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('Host Filesystem Access: Tool can read files allowed by config', async () => {
    // 1. Setup
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    // 2. Create a data file in the "Host" VFS (using kernel.vfs directly to simulate existing state)
    const dataPath = 'data.json';
    const dataContent = JSON.stringify({ secret: 42 });
    await kernel.vfs.writeFile(dataPath, dataContent);

    // 3. Create a tool that reads it using tgp.read_file
    const toolName = 'tools/reader.ts';
    await tools.write_file.execute({
      path: toolName,
      content: `
        export default async function() {
          const content = await tgp.read_file('data.json');
          return JSON.parse(content);
        }
      `
    });

    // 4. Execute
    const result = await tools.exec_tool.execute({ path: toolName, args: {} });
    
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ secret: 42 });
  });

  it('Recursive Tool Execution: Tools can import other tools', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    // 1. Create a Library Tool (Dependency)
    // Note: The VFS resolver looks for .ts extensions
    await tools.write_file.execute({
      path: 'tools/lib/math.ts',
      content: `
        export function double(n: number) { return n * 2; }
        export const PI = 3.14;
      `
    });

    // 2. Create Main Tool (Consumer)
    // Uses 'require' shim injected by sandbox
    await tools.write_file.execute({
      path: 'tools/calc.ts',
      content: `
        const { double, PI } = require('./lib/math');
        
        export default function(args: { val: number }) {
          return double(args.val) + PI;
        }
      `
    });

    // 3. Execute
    const result = await tools.exec_tool.execute({ path: 'tools/calc.ts', args: { val: 10 } });

    expect(result.success).toBe(true);
    expect(result.result).toBe(23.14); // (10 * 2) + 3.14
  });
});
````

## File: test/integration/gitops.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { createTempDir, initBareRepo, createTgpConfig, cleanupDir } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools } from '../../src/tools/index.js';

describe('Integration: GitOps & Persistence', () => {
  let tempDir: string;
  let remoteRepo: string;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-git-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('Hydration: Should clone existing tools from remote on boot', async () => {
    // 1. Setup Remote with a tool manually
    const cloneDir = await createTempDir('tgp-setup-');
    execSync(`git clone ${remoteRepo} .`, { cwd: cloneDir, stdio: 'ignore' });
    
    const toolContent = 'export default () => "hydrated"';
    const toolRelPath = 'tools/hydrated.ts';
    await fs.mkdir(path.join(cloneDir, 'tools'), { recursive: true });
    await fs.writeFile(path.join(cloneDir, toolRelPath), toolContent);
    
    execSync('git add .', { cwd: cloneDir, stdio: 'ignore' });
    execSync('git commit -m "Add tool"', { cwd: cloneDir, stdio: 'ignore' });
    execSync('git push origin main', { cwd: cloneDir, stdio: 'ignore' });
    
    await cleanupDir(cloneDir);

    // 2. Boot Kernel in fresh dir
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    
    // Assert file doesn't exist yet
    const localToolPath = path.join(tempDir, toolRelPath); // Note: .tgp root is inside tempDir based on utils logic, actually config sets rootDir
    // wait, createTgpConfig sets rootDir to tempDir/.tgp
    const tgpRoot = path.join(tempDir, '.tgp');
    const localFile = path.join(tgpRoot, toolRelPath);

    expect(await fs.access(localFile).then(() => true).catch(() => false)).toBe(false);

    await kernel.boot();

    // 3. Verify Hydration
    expect(await fs.access(localFile).then(() => true).catch(() => false)).toBe(true);
    const content = await fs.readFile(localFile, 'utf-8');
    expect(content).toBe(toolContent);
  });

  it('Fabrication: Should persist new tools to remote', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();

    const tools = tgpTools(kernel);
    const newToolPath = 'tools/fabrication.ts';
    const msg = 'Forge: tools/fabrication.ts';

    // 1. Write Tool (triggers persist)
    await tools.write_file.execute({
      path: newToolPath,
      content: 'export default "new"'
    });

    // 2. Verify Remote
    const verifyDir = await createTempDir('tgp-verify-');
    execSync(`git clone ${remoteRepo} .`, { cwd: verifyDir, stdio: 'ignore' });
    
    const exists = await fs.access(path.join(verifyDir, newToolPath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // Verify Commit Message
    const lastCommit = execSync('git log -1 --pretty=%B', { cwd: verifyDir }).toString().trim();
    expect(lastCommit).toBe(msg);

    await cleanupDir(verifyDir);
  });

  it('Concurrency: Should handle simultaneous pushes', async () => {
    // Setup two agents
    const dirA = await createTempDir('tgp-agent-a-');
    const dirB = await createTempDir('tgp-agent-b-');

    const kernelA = new TGP({ configFile: await createTgpConfig(dirA, remoteRepo) });
    const kernelB = new TGP({ configFile: await createTgpConfig(dirB, remoteRepo) });

    await kernelA.boot();
    await kernelB.boot();

    const toolsA = tgpTools(kernelA);
    const toolsB = tgpTools(kernelB);

    // Trigger race condition
    // A writes, B writes different file. Both sync.
    // The git backend should handle the non-fast-forward on the slower one by pulling/merging.
    await Promise.all([
      toolsA.write_file.execute({ path: 'tools/A.ts', content: 'export const a = 1;' }),
      toolsB.write_file.execute({ path: 'tools/B.ts', content: 'export const b = 2;' })
    ]);

    // Verify Remote has both
    const verifyDir = await createTempDir('tgp-verify-race-');
    execSync(`git clone ${remoteRepo} .`, { cwd: verifyDir, stdio: 'ignore' });
    
    const hasA = await fs.access(path.join(verifyDir, 'tools/A.ts')).then(() => true).catch(() => false);
    const hasB = await fs.access(path.join(verifyDir, 'tools/B.ts')).then(() => true).catch(() => false);

    expect(hasA).toBe(true);
    expect(hasB).toBe(true);

    await cleanupDir(dirA);
    await cleanupDir(dirB);
    await cleanupDir(verifyDir);
  });
});
````

## File: test/integration/sql.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTempDir, createTgpConfig, cleanupDir, initBareRepo } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools, createSqlTools } from '../../src/tools/index.js';

describe('Integration: SQL Adapter (Real SQLite)', () => {
  let tempDir: string;
  let remoteRepo: string;
  let db: Database.Database;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-sql-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
    
    // Setup Real SQLite DB (In-memory for speed/isolation)
    db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO users (name) VALUES ('Alice')");
    db.exec("INSERT INTO users (name) VALUES ('Bob')");
  });

  afterEach(async () => {
    if (db) db.close();
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('Query Execution: Tool can query real database', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    
    // Executor that bridges TGP -> Real DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = async (sql: string, params: any[]) => {
      const stmt = db.prepare(sql);
      if (sql.trim().toLowerCase().startsWith('select')) {
        return stmt.all(params);
      }
      return stmt.run(params);
    };

    const kernel = new TGP({ 
      configFile: configPath,
      sandboxAPI: { exec_sql: executor } // Inject for internal usage if needed
    });
    await kernel.boot();

    // Compose tools
    const tools = { ...tgpTools(kernel), ...createSqlTools(executor) };

    const toolName = 'tools/get_users.ts';
    await tools.write_file.execute({
      path: toolName,
      content: `
        export default async function() {
          return await tgp.exec_sql('SELECT name FROM users ORDER BY name', []);
        }
      `
    });

    const res = await tools.exec_tool.execute({ path: toolName, args: {} });
    
    expect(res.success).toBe(true);
    expect(res.result).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });

  it('Transaction Rollback: Host can rollback if tool throws', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    
    // Executor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = async (sql: string, params: any[]) => {
      return db.prepare(sql).run(params);
    };

    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = { ...tgpTools(kernel), ...createSqlTools(executor) };

    // Create a buggy tool that writes then crashes
    const buggyTool = 'tools/buggy_insert.ts';
    await tools.write_file.execute({
      path: buggyTool,
      content: `
        export default async function() {
           // 1. Write
           await tgp.exec_sql("INSERT INTO users (name) VALUES ('Charlie')", []);
           // 2. Crash
           throw new Error('Logic Bomb');
        }
      `
    });

    // Emulate Host Application Transaction Wrapper
    // Since better-sqlite3 is synchronous, we manage transaction via raw SQL commands
    // surrounding the async tool execution.
    
    db.exec('BEGIN');
    let errorCaught = false;
    
    try {
      const res = await tools.exec_tool.execute({ path: buggyTool, args: {} });
      if (!res.success) {
        throw new Error(res.error);
      }
      db.exec('COMMIT');
    } catch (e) {
      errorCaught = true;
      db.exec('ROLLBACK');
    }

    expect(errorCaught).toBe(true);

    // Verify 'Charlie' was NOT added
    const rows = db.prepare('SELECT * FROM users WHERE name = ?').all('Charlie');
    expect(rows.length).toBe(0);
    
    // Verify existing data remains
    const count = db.prepare('SELECT count(*) as c FROM users').get() as { c: number };
    expect(count.c).toBe(2);
  });
});
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

## File: src/sandbox/bundler.ts
````typescript
import { buildSync } from 'esbuild';

// In-memory cache to avoid redundant bundling of the same dependency within the kernel's lifetime.
const bundleCache = new Map<string, string>();

/**
 * Synchronously bundles a node module into a single CommonJS string.
 * This is used by the sandbox's 'require' shim to provide whitelisted dependencies.
 * 
 * @param dependency The name of the package to bundle (e.g., 'zod').
 * @returns The bundled JavaScript code as a string.
 */
export function bundleDependencySync(dependency: string): string {
  if (bundleCache.has(dependency)) {
    return bundleCache.get(dependency) as string;
  }

  try {
    const result = buildSync({
      entryPoints: [dependency],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      write: false, // Return the output in memory
      logLevel: 'silent', // Suppress esbuild warnings in production logs
    });

    if (result.outputFiles !== undefined && result.outputFiles.length > 0) {
      const bundledCode = result.outputFiles[0].text;
      bundleCache.set(dependency, bundledCode);
      return bundledCode;
    }

    throw new Error(`esbuild did not produce an output file for '${dependency}'.`);

  } catch (error) {
    // Re-throw with a more informative message for the host application logs
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to resolve or bundle dependency '${dependency}': ${msg}`);
  }
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
export * from './sql.js';

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

## File: src/tools/sql.ts
````typescript
import { z } from 'zod';
import { AgentTool, ToolSet } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DBExecutor = (sql: string, params: any[]) => Promise<any>;

export const ExecSqlParams = z.object({
  sql: z.string().describe('The raw SQL query to execute.'),
  params: z.array(z.any()).optional().describe('An array of parameters to substitute into the query.'),
});

/**
 * Creates a ToolSet containing the `exec_sql` tool.
 * This function allows the host application to inject its own database connection
 * and execution logic into the TGP agent.
 *
 * @param executor A function that takes a SQL string and parameters and returns the result.
 * @returns A ToolSet containing the `exec_sql` tool.
 */
export function createSqlTools(executor: DBExecutor): ToolSet {
  return {
    exec_sql: {
      description: 'Executes a raw SQL query against the database. Returns an array of rows.',
      parameters: ExecSqlParams,
      execute: async ({ sql, params }) => {
        return executor(sql, params ?? []);
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as AgentTool<typeof ExecSqlParams, any>,
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

## File: test-docs/e2e.test-plan.md
````markdown
# End-to-End Test Plan (Real Implementation)

**Rules:**
1.  **No Mock, No Spy**: Tests run against the built `bin/tgp.js` or the public API entry point using real dependencies (Git, SQLite, V8).
2.  **Real Implementation**: Verification involves checking the actual effects on the filesystem, git history, and database state.
3.  **Isolated**: Each test runs in a unique, ephemeral directory (`/tmp/tgp-e2e-${uuid}`).
4.  **Idempotent**: Tests can be re-run without manual cleanup (handled by isolation), and operations within tests should handle existing state gracefully.
5.  **Clean on SIGTERM**: Test harness must ensure child processes and temp files are cleaned up if the test process is interrupted.

## 1. The "Cold Start" Lifecycle (GitOps + Compilation)
**Story**: An agent wakes up in a serverless environment, connects to a repo, builds a tool, uses it, and shuts down.

1.  **Setup Environment**:
    -   Create `bare-repo.git` (The Remote).
    -   Create `config.ts` pointing to `bare-repo.git`.
2.  **Agent Boot**:
    -   Initialize TGP Kernel.
    -   **Assert**: Local filesystem is clean (except for `.git` hydration).
3.  **Task**: "Create a fibonacci tool".
    -   Agent calls `write_file('tools/math/fib.ts', ...)` (Real TS code).
    -   Agent calls `check_tool('tools/math/fib.ts')`. **Assert**: Valid.
4.  **Execution**:
    -   Agent calls `exec_tool('tools/math/fib.ts', { n: 10 })`.
    -   **Assert**: Result is `55`.
5.  **Shutdown & Persist**:
    -   Kernel calls `sync()`.
    -   Process exits.
6.  **Verification (The "Next" Agent)**:
    -   Clone `bare-repo.git` to a **new** directory.
    -   Check file existence: `tools/math/fib.ts`.
    -   **Assert**: File content matches exactly.

## 2. Multi-Agent Concurrency (The "Merge" Test)
**Story**: Two agents forge tools simultaneously. TGP must handle Git locking and merging without human intervention.

1.  **Setup**:
    -   Initialize `bare-repo.git`.
    -   Instantiate **Agent A** in `dir_A` and **Agent B** in `dir_B` (both pointing to `bare-repo.git`).
2.  **Parallel Action**:
    -   Agent A creates `tools/math/add.ts`.
    -   Agent B creates `tools/math/subtract.ts`.
3.  **Race Condition**:
    -   Agent A calls `sync()` (Push succeeds).
    -   Agent B calls `sync()` immediately after.
        -   **Expect**: Git push rejected (non-fast-forward).
        -   **Auto-Resolution**: TGP kernel catches error, pulls (rebase/merge), and pushes again.
4.  **Verification**:
    -   Inspect `bare-repo.git` history.
    -   **Assert**: Both `add.ts` and `subtract.ts` exist in HEAD.
    -   **Assert**: Commit history is linear or cleanly merged.

## 3. The "Refactor" Scenario (Search & Replace)
**Story**: An existing tool is broken/outdated. Agent must patch it.

1.  **Pre-condition**: `tools/legacy.ts` exists with `console.log("old")`.
2.  **Agent Action**:
    -   Agent reads file.
    -   Agent calls `patch_file('tools/legacy.ts', ...)` to replace `console.log` with `return`.
3.  **Verification**:
    -   Run `exec_tool`.
    -   **Assert**: Output is returned value, not undefined.
    -   Read file from disk. **Assert**: Content is updated.
    -   **Git Verify**: Change is staged/committed in local repo (if auto-commit is on).

## 4. The "Infinite Loop" Self-Defense (Resilience)
**Story**: Agent generates malicious/buggy code that freezes.

1.  **Action**: Agent creates `tools/freeze.ts` (`while(true){}`).
2.  **Execution**: Agent calls `exec_tool('tools/freeze.ts')`.
3.  **Observation**:
    -   Function call throws exception `ERR_ISOLATE_TIMEOUT`.
    -   Exception is caught by Kernel.
    -   **Assert**: Main process (The Agent) remains alive and responsive.
    -   **Assert**: Memory usage of Main process is stable (V8 isolate disposed).

## 5. Security & Sandbox Jailbreak
**Story**: Malicious tool attempts to access host resources.

1.  **Filesystem Escape**:
    -   Create tool `tools/hack.ts` attempting `read_file('../../../etc/passwd')`.
    -   Execute. **Assert**: Throws `SecurityViolation`.
2.  **Environment Theft**:
    -   Create tool `tools/env.ts` attempting to access `process.env`.
    -   Execute. **Assert**: Throws `ReferenceError` (process is not defined).
3.  **Network Exfiltration**:
    -   Create tool `tools/curl.ts` attempting `fetch('http://evil.com')`.
    -   Execute. **Assert**: Throws `NetworkError` or `SecurityViolation` (not in whitelist).

## 6. Database Transaction Safety (SQL)
**Story**: A tool performs SQL operations. Logic error triggers rollback.

1.  **Setup**:
    -   Initialize real SQLite DB `test.db` with table `logs`.
2.  **Success Path**:
    -   Tool executes `INSERT INTO logs VALUES ('ok')`.
    -   **Assert**: Row count = 1.
3.  **Failure Path (Rollback)**:
    -   Tool executes:
        ```typescript
        sql('INSERT INTO logs VALUES ("bad")');
        throw new Error("Logic Crash");
        ```
    -   Kernel catches error.
    -   **Assert**: Row count = 1 (The "bad" row was rolled back).

## 7. The "SIGTERM" Cleanliness Test
**Story**: Deployment platform kills the pod while tool is running.

1.  **Setup**:
    -   Start TGP process that writes to a database loop or holds a file lock.
2.  **Action**:
    -   Send `SIGTERM` to process.
3.  **Verification**:
    -   Check Database locks. **Assert**: Released (WAL file clean).
    -   Check Temporary Files (`/tmp/tgp-*`). **Assert**: Deleted/Cleaned up.
    -   Check Git Lock files (`index.lock`). **Assert**: Cleared.

## 8. CLI Bootstrap Test
**Story**: Developer initializes project.

1.  **Action**: Exec `node bin/tgp.js init` in empty dir.
2.  **Assert**:
    -   `tgp.config.ts` created.
    -   `.tgp` folder structure created.
    -   `package.json` updated (if applicable).
    -   Run `node bin/tgp.js check`. **Assert**: Passes with no tools.
````

## File: test-docs/integration.test-plan.md
````markdown
# Integration Test Plan (Real Implementation)

**Rules:**
1.  **No Mock, No Spy**: Tests use real Git binaries, real SQLite drivers, and real V8 isolates.
2.  **Real Implementation**: Verification involves checking the actual effects on the filesystem, git history, and database state.
3.  **Isolated**: Each test runs in a unique, ephemeral directory (`/tmp/tgp-integration-${uuid}`).
4.  **Idempotent**: Tests can be re-run without manual cleanup.
5.  **Clean on SIGTERM**: Test harness cleans up temp files if interrupted.

## 1. GitOps & Persistence
**Target**: `src/kernel/git.ts`
**Setup**:
1.  Create `REMOTE_DIR` (init bare repo).
2.  Create `AGENT_DIR` (configured as TGP root).

- [ ] **Hydration (Clone/Pull)**
    - [ ] Commit a tool `tools/hello.ts` to `REMOTE_DIR` using standard `git` CLI commands.
    - [ ] Initialize `TGP Kernel` in `AGENT_DIR`.
    - [ ] **Assert**: `tools/hello.ts` exists in `AGENT_DIR` and is readable.
- [ ] **Fabrication (Commit/Push)**
    - [ ] Use Kernel to write `tools/new.ts` in `AGENT_DIR`.
    - [ ] Trigger Kernel persistence (sync).
    - [ ] Verify in `REMOTE_DIR` (using `git log`) that a new commit exists with the expected message.
- [ ] **Concurrency (Locking)**
    - [ ] Instantiate **two** Kernels pointing to the same `REMOTE_DIR` but different local dirs.
    - [ ] Agent A writes `toolA.ts`. Agent B writes `toolB.ts`.
    - [ ] Both sync simultaneously.
    - [ ] **Assert**: `REMOTE_DIR` contains both files. No merge conflicts (assuming distinct files).

## 2. Kernel <-> Sandbox Bridge
**Target**: `src/sandbox/bridge.ts`

- [ ] **Host Filesystem Access**
    - [ ] Create file `data.json` in Host VFS.
    - [ ] Create tool that uses `tgp.read_file('data.json')`.
    - [ ] Execute tool.
    - [ ] **Assert**: Tool returns parsed JSON.
- [ ] **Recursive Tool Execution**
    - [ ] Create `tools/multiplier.ts` (returns `a * b`).
    - [ ] Create `tools/calculator.ts` that imports/calls `multiplier`.
    - [ ] Execute `calculator`.
    - [ ] **Assert**: Returns correct result. Verifies internal module resolution works in V8.

## 3. SQL Adapter (Real SQLite)
**Target**: `src/tools/sql.ts`
**Setup**: Create `test.db` (SQLite). Run migration to create table `users`.

- [ ] **Query Execution**
    - [ ] Tool executes `SELECT * FROM users`.
    - [ ] **Assert**: Returns real rows.
- [ ] **Transaction Rollback**
    - [ ] Tool executes:
        1. `INSERT INTO users ...`
        2. `throw new Error('Boom')`
    - [ ] Catch error in test.
    - [ ] Query `users` table.
    - [ ] **Assert**: Count is 0 (Rollback successful).
````

## File: test-docs/unit.test-plan.md
````markdown
# Unit Test Plan (Real Implementation)

**Rules:**
1.  **No Mock, No Spy**: Use real file systems (node:fs), real V8 isolates (isolated-vm).
2.  **Real Implementation**: Verify logic by observing real output/exceptions.
3.  **Isolated**: Each test suite creates a unique temporary directory (`/tmp/tgp-unit-${uuid}`).
4.  **Idempotent**: No shared global state between tests.
5.  **Clean on SIGTERM**: Register `process.on('SIGTERM')` handlers to wipe temp dirs.

## 1. VFS (Virtual Filesystem) - Node Adapter
**Target**: `src/vfs/node.ts`
**Setup**: Create a temporary directory `TEST_ROOT`.

- [ ] **Real I/O Operations**
    - [ ] `write('deep/nested/file.txt')`: Verify it creates physical directories on disk.
    - [ ] `read('deep/nested/file.txt')`: Verify it returns exact byte content written.
    - [ ] `list('deep')`: Verify it returns structure matching OS `ls -R`.
- [ ] **Path Security (Jail)**
    - [ ] Attempt `write('../outside.txt')`. **Assert**: Throws specific `SecurityViolation` error. File **must not** exist outside `TEST_ROOT`.
    - [ ] Attempt symlink traversal. Create a symlink in `TEST_ROOT` pointing to `/etc/passwd`. Attempt `read()`. **Assert**: Throws or resolves to empty/null (depending on config).

## 2. Sandbox Execution (V8)
**Target**: `src/sandbox/isolate.ts`, `src/sandbox/bundler.ts`
**Setup**: Instantiate real `isolated-vm`.

- [ ] **Compilation**
    - [ ] Feed raw TypeScript: `export default (a: number) => a * 2;`.
    - [ ] **Assert**: Returns a callable function handle.
    - [ ] Feed Syntax Error: `const x = ;`.
    - [ ] **Assert**: Throws `CompilationError` with line number.
- [ ] **Runtime constraints**
    - [ ] **Memory**: Execute script that allocates 100MB buffer. **Assert**: Throws `ERR_ISOLATE_MEMORY`.
    - [ ] **Timeout**: Execute `while(true){}`. **Assert**: Throws `ERR_ISOLATE_TIMEOUT` after 50ms (or configured limit).
- [ ] **Determinism**
    - [ ] Run `Math.random()`. **Assert**: If seed is configurable, output is constant. (If not, verify output format).

## 3. Tool Validation logic
**Target**: `src/tools/validation.ts`

- [ ] **Static Analysis**
    - [ ] Input source code with `process.exit()`.
    - [ ] **Assert**: Validation fails with "Global 'process' is forbidden".
    - [ ] Input source code with `import fs from 'fs'`.
    - [ ] **Assert**: Validation fails if import is not in whitelist.
````

## File: eslint.config.js
````javascript
import typescriptESLint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
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
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
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
        await kernel.git.persist(`Forge: ${path}`, [path]);

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

        await kernel.git.persist(`Refactor: ${path}`, [path]);

        return { success: true, path, persisted: true };
      },
    } as AgentTool<typeof PatchFileParams, { success: boolean; path: string }>,
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
    "declaration": true
  },
  "include": ["src/**/*", "test/**/*"]
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
      description: 'Execute a tool inside the secure Sandbox. Returns { result, logs, error }.',
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
        const { result, logs, error } = await executeTool(kernel, code, args, path);
        
        if (error !== undefined) {
           return { success: false, error, logs };
        }
        return { success: true, result, logs };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as AgentTool<typeof ExecToolParams, any>,
  };
}
````

## File: src/tools/validation.ts
````typescript
import { z } from 'zod';
import * as ts from 'typescript';
import { Kernel } from '../kernel/core.js';
import { AgentTool } from './types.js';

export const CheckToolParams = z.object({
  path: z.string().describe('The relative path of the tool to validate'),
});

export function createValidationTools(kernel: Kernel) {
  return {
    check_tool: {
      description: 'Run JIT compilation and AST-based static analysis on a tool.',
      parameters: CheckToolParams,
      execute: async ({ path }) => {
        try {
          const code = await kernel.vfs.readFile(path);
          
          // 1. Parse AST
          // We use ES2020 as target to match the sandbox environment
          const sourceFile = ts.createSourceFile(
            path,
            code,
            ts.ScriptTarget.ES2020,
            true
          );

          const errors: string[] = [];

          // 2. Recursive AST Visitor
          const visit = (node: ts.Node) => {
            // [Standard 3] Strict Typing: No 'any'
            if (node.kind === ts.SyntaxKind.AnyKeyword) {
               errors.push("Violation [Standard 3]: Usage of 'any' is prohibited. Use specific types or generic constraints.");
            }

            // [Safety] No 'eval'
            if (ts.isCallExpression(node)) {
                if (ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
                    errors.push("Violation [Safety]: Dynamic code execution ('eval') is prohibited.");
                }
            }

            // [Safety] No 'new Function(...)'
            if (ts.isNewExpression(node)) {
                if (ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
                    errors.push("Violation [Safety]: Dynamic code execution ('Function' constructor) is prohibited.");
                }
            }

            // [Standard 4] Stateless: No process global access (except process.env.NODE_ENV)
            if (ts.isIdentifier(node) && node.text === 'process') {
                // Check context to see if allowed.
                // We allow strict access to `process.env.NODE_ENV`.
                // AST Structure: PropertyAccess(NODE_ENV) -> PropertyAccess(env) -> Identifier(process)
                
                let isAllowed = false;
                
                // Ensure parent is property access 'env'
                if (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === 'env') {
                     // Ensure grandparent is property access 'NODE_ENV'
                     if (ts.isPropertyAccessExpression(node.parent.parent) && node.parent.parent.expression === node.parent && node.parent.parent.name.text === 'NODE_ENV') {
                         isAllowed = true;
                     }
                }
                
                if (!isAllowed) {
                     // We check if this identifier is being used as a property access base or standalone.
                     // To avoid noise, we only report if it's the base of a property access OR used standalone.
                     // If it's a property of something else (e.g. myObj.process), parent is PropertyAccess but expression is NOT node.
                     if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
                         // This is something.process - Allowed
                     } else {
                         errors.push("Violation [Standard 4]: Direct access to 'process' is prohibited. Use 'args' for inputs to ensure statelessness.");
                     }
                }
            }

            // [Standard 1] No Magic Numbers
            if (ts.isNumericLiteral(node)) {
                const val = parseFloat(node.text);
                const allowed = [0, 1, 2, -1, 100, 1000]; 
                if (!allowed.includes(val)) {
                    // Filter out array indices? Hard to detect without type checker.
                    // We enforce strictness: abstract data to args.
                    errors.push(`Violation [Standard 1]: Found potential magic number '${node.text}'. Abstract logic from data.`);
                }
            }

            // [Standard 7] No Hardcoded Secrets
            if (ts.isStringLiteral(node)) {
                const text = node.text;
                // Emails
                if (/\b[\w.-]+@[\w.-]+\.\w{2,4}\b/.test(text)) {
                     errors.push("Violation [Standard 7]: Hardcoded email address detected. Pass this as an argument.");
                }
                // Long Alphanumeric Strings (potential IDs/Keys) - strict heuristic
                // Must be 24+ chars, alphanumeric mixed, no spaces.
                if (/[a-zA-Z0-9-]{24,}/.test(text) && !text.includes(' ')) {
                     errors.push("Violation [Standard 7]: Potential hardcoded ID or Secret detected. Pass this as an argument.");
                }
            }

            ts.forEachChild(node, visit);
          };

          visit(sourceFile);

          return { valid: errors.length === 0, errors };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          const msg = error.message ?? String(error);
          return { valid: false, errors: [msg] };
        }
      },
    } as AgentTool<typeof CheckToolParams, { valid: boolean; errors: string[] }>,
  };
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
  const binDir = path.join(tgpDir, 'bin');
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
      await fs.appendFile(gitIgnorePath, '\n# TGP\n.tgp\n.tgp/meta.json\n');
      console.log(`[TGP] Added .tgp to .gitignore`);
    }
  } else {
    await fs.writeFile(gitIgnorePath, '# TGP\n.tgp\n.tgp/meta.json\n');
    console.log(`[TGP] Created .gitignore`);
  }

  // 3. Create .tgp directory (just to be nice)
  await fs.mkdir(tgpDir, { recursive: true });

  // 4. Scaffold Tools directory
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });
  console.log(`[TGP] Created .tgp/tools and .tgp/bin directories`);

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
  // The Root of the Agent's filesystem (Ephemeral in serverless)
  rootDir: './.tgp',

  // 1. BACKEND (GitOps)
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

  // 2. FILESYSTEM JAIL
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 3. RUNTIME
  allowedImports: ['@tgp/std', 'zod', 'date-fns'],

  // 4. NETWORKING
  // Whitelist of URL prefixes the sandbox fetch can access.
  // e.g. allowedFetchUrls: ['https://api.stripe.com', 'https://api.github.com']
  allowedFetchUrls: []
});
`;
````

## File: src/kernel/registry.ts
````typescript
/* eslint-disable no-console */
import { VFSAdapter } from '../vfs/types.js';
import { RegistryState, ToolMetadata } from '../types.js';
import * as path from 'path';
import * as ts from 'typescript';

export interface Registry {
  hydrate(): Promise<void>;
  register(filePath: string, code: string): Promise<void>;
  list(): ToolMetadata[];
  rebuild(): Promise<void>;
  sync(): Promise<void>;
}

export function createRegistry(vfs: VFSAdapter): Registry {
  let state: RegistryState = { tools: {} };
  const META_PATH = 'meta.json';

  // Helper to parse JSDoc
  function extractMetadata(filePath: string, code: string): ToolMetadata {
    const name = path.basename(filePath, path.extname(filePath));
    let description = "No description provided.";

    try {
      // Use TypeScript AST to safely locate comments (avoids matching inside strings/templates)
      const sourceFile = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.ES2020,
        true
      );

      const cleanJSDoc = (comment: string) => {
        return comment
          .replace(/^\/\*\*/, '')
          .replace(/\*\/$/, '')
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, '').trim())
          .filter(line => !line.startsWith('@') && line.length > 0)
          .join(' ');
      };

      const findComment = (pos: number) => {
        const ranges = ts.getLeadingCommentRanges(code, pos);
        if (ranges && ranges.length > 0) {
          const range = ranges[ranges.length - 1]; // Closest to the node
          if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
            const text = code.substring(range.pos, range.end);
            if (text.startsWith('/**')) return cleanJSDoc(text);
          }
        }
        return null;
      };

      // 1. Try attached to first statement (e.g. export const...)
      if (sourceFile.statements.length > 0) {
        const extracted = findComment(sourceFile.statements[0].getFullStart());
        if (extracted !== null) description = extracted;
      }
      
      // 2. Fallback: Try top of file (detached)
      if (description === "No description provided.") {
        const extracted = findComment(0);
        if (extracted !== null) description = extracted;
      }

    } catch (err) {
      console.warn(`[TGP] Failed to parse AST for ${filePath}. Falling back to default.`, err);
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
          state = content.trim().length > 0 ? JSON.parse(content) : { tools: {} };
          return;
        } catch (err) {
          console.warn('[TGP] Failed to parse meta.json, rebuilding cache.', err);
        }
      }
      await this.rebuild();
    },

    async register(filePath: string, code: string) {
      // Ignore non-tool files (e.g. config or hidden files)
      if (!filePath.startsWith('tools/') && !filePath.startsWith('tools\\')) return;

      const metadata = extractMetadata(filePath, code);
      state.tools[filePath] = metadata;
      
      // We sync immediately to ensure data integrity, prioritizing safety over raw IO performance
      // during tool creation.
      await this.sync();
    },

    async rebuild() {
      state = { tools: {} };
      // Scan for tools recursively
      const files = await vfs.listFiles('tools', true);
      for (const file of files) {
        if (file.endsWith('.ts')) {
          try {
            const code = await vfs.readFile(file);
            const metadata = extractMetadata(file, code);
            state.tools[file] = metadata;
          } catch (err) {
            console.warn(`[TGP] Failed to index ${file}`, err);
          }
        }
      }
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

## File: src/sandbox/isolate.ts
````typescript
import type * as IVM from 'isolated-vm';
import { transform } from 'esbuild';
import * as vm from 'node:vm';

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
 * Falls back to Node.js 'vm' module if 'isolated-vm' is unavailable.
 */
export function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const memoryLimit = opts.memoryLimitMb ?? 128;
  const timeout = opts.timeoutMs ?? 5000;

  let isolate: IVM.Isolate | undefined;
  let useFallback = false;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async compileAndRun(tsCode: string, context: Record<string, any>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ivm: any;
      try {
        // Dynamic import to prevent crash on module load if native bindings are missing or incompatible
        ivm = (await import('isolated-vm')).default;
      } catch {
        useFallback = true;
      }

      // 1. JIT Compile (TypeScript -> JavaScript)
      // We use esbuild for speed.
      const transformed = await transform(tsCode, {
        loader: 'ts',
        format: 'cjs', // CommonJS ensures simple execution in V8
        target: 'es2020',
      });

      const jsCode = transformed.code;

      if (useFallback) {
         // --- Node.js VM Fallback ---
         const sandboxContext = vm.createContext({ ...context });
         // Setup global self-reference
         sandboxContext.global = sandboxContext;
         
         try {
             const script = new vm.Script(jsCode);
             return script.runInContext(sandboxContext, { timeout });
         } catch (e) {
             throw e;
         }
      }

      // Initialize isolate if not already created (reuse across executions)
      const currentIsolate = isolate ?? new ivm.Isolate({ memoryLimit });
      // Update state
      isolate = currentIsolate;

      // 2. Create a fresh Context for this execution
      // We use currentIsolate which is guaranteed to be defined
      const ivmContext = await currentIsolate.createContext();

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
                const initScript = await currentIsolate.compileScript('global.tgp = {}');
                await initScript.run(ivmContext);
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
        const script = await currentIsolate.compileScript(jsCode);

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
      if (isolate && !isolate.isDisposed) {
        isolate.dispose();
      }
    }
  };
}
````

## File: src/sandbox/bridge.ts
````typescript
/* eslint-disable no-console */
import { Kernel } from '../kernel/core.js';
import * as path from 'path';
import { TGPConfig } from '../types.js';

export interface SandboxBridgeOptions {
  kernel: {
    vfs: Kernel['vfs'];
    config: TGPConfig;
    sandboxAPI: Kernel['sandboxAPI'];
  };
  onLog?: (message: string) => void;
}

/**
 * Creates the Bridge Object exposed to the Sandbox.
 * This maps secure Kernel methods to the Guest environment.
 * 
 * We expose a structured 'tgp' object to the guest.
 */
export function createSandboxBridge({ kernel, onLog }: SandboxBridgeOptions) {
  const { vfs, config } = kernel;
  const { allowedDirs } = config.fs;
  const { allowedFetchUrls } = config;

  const isAllowedWrite = (target: string): boolean => {
    // Normalize target to ensure clean comparison (remove leading ./, etc)
    const normalizedTarget = path.normalize(target).replace(/^(\.\/)/, '');
    
    return allowedDirs.some(dir => {
      const normalizedDir = path.normalize(dir).replace(/^(\.\/)/, '');
      // Check if target is inside the allowed dir
      return normalizedTarget.startsWith(normalizedDir);
    });
  };

  return {
    tgp: {
      // --- Filesystem Bridge (Jailed) ---
      read_file: async (path: string) => {
        return vfs.readFile(path);
      },

      write_file: async (path: string, content: string) => {
        if (!isAllowedWrite(path)) {
          throw new Error(`Security Violation: Write access denied for '${path}'. Allowed directories: ${allowedDirs.join(', ')}`);
        }
        return vfs.writeFile(path, content);
      },

      list_files: async (dir: string) => {
        return vfs.listFiles(dir, false);
      },

      // --- Network Bridge (Allowed Only) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: async (url: string, init?: any) => {
        // Security: Enforce URL allow-list
        if (!allowedFetchUrls || allowedFetchUrls.length === 0) {
          throw new Error(`Security Violation: Network access is disabled. No URLs are whitelisted in tgp.config.ts.`);
        }
        const isAllowed = allowedFetchUrls.some(prefix => url.startsWith(prefix));
        if (!isAllowed) {
          throw new Error(`Security Violation: URL "${url}" is not in the allowed list.`);
        }

        const response = await fetch(url, init);

        // Return a serializable, safe subset of the Response object.
        // The methods must be wrapped to be transferred correctly.
        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          text: () => response.text(),
          json: () => response.json(),
        };
      },

      // --- Logger ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        if (onLog) {
            onLog(msg);
        } else {
            console.log('[TGP-TOOL]', msg);
        }
      },

      // --- Dynamic API Injection ---
      ...kernel.sandboxAPI
    }
  };
}
````

## File: src/tgp.ts
````typescript
import * as fs from 'node:fs';
import * as http from 'isomorphic-git/http/node';
import { createKernel, Kernel, KernelEnvironment } from './kernel/core.js';
import { loadTGPConfig } from './config.js';
import { createNodeVFS } from './vfs/node.js';
import { TGPConfigSchema, TGPConfig, Logger } from './types.js';
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

  /**
   * Custom functions to inject into the Sandbox global 'tgp' object.
   * e.g. { exec_sql: (sql) => db.query(sql) }
   */
  sandboxAPI?: Record<string, any>;
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
  public registry: Registry;
  public logger: Logger;
  public sandboxAPI: Record<string, any>;
  
  private _isBooted = false;

  constructor(private opts: TGPOptions = {}) {
    // 1. Initialize with Defaults (Sync)
    // We use the default schema to ensure the kernel is usable immediately (e.g. for tooling)
    // even before the async config load completes.
    this.config = TGPConfigSchema.parse({});
    
    // 2. Setup VFS
    // Use injected VFS or default to Node VFS
    this.vfs = opts.vfs || createNodeVFS(this.config.rootDir);

    // 3. Setup Sandbox API
    this.sandboxAPI = opts.sandboxAPI || {};

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
      sandboxAPI: this.sandboxAPI
    });

    this.git = kernel.git;
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
        sandboxAPI: this.sandboxAPI
      });
      
      this.git = kernel.git;
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
4.  **Database Interaction**: You MUST use the 'exec_sql' tool to interact with the database. Do not write tools that attempt to connect to a database themselves.

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
````

## File: src/types.ts
````typescript
import { z } from 'zod';

// --- Git Configuration Schema ---
export const GitConfigSchema = z.object({
  provider: z.enum(['github', 'gitlab', 'bitbucket', 'local']),
  repo: z.string().min(1, "Repository name is required"),
  branch: z.string().default('main'),
  apiBaseUrl: z.string().url().default('https://api.github.com'),
  auth: z.object({
    token: z.string().min(1, "Git auth token is required"),
    user: z.string().default('tgp-bot[bot]'),
    email: z.string().email().default('tgp-bot@users.noreply.github.com'),
  }),
  writeStrategy: z.enum(['direct', 'pr']).default('direct'),
});

// --- Filesystem Jail Schema ---
export const FSConfigSchema = z.object({
  allowedDirs: z.array(z.string()).default(['./tmp']),
  blockUpwardTraversal: z.boolean().default(true),
});

// --- Main TGP Configuration Schema ---
export const TGPConfigSchema = z.object({
  rootDir: z.string().default('./.tgp'),
  git: GitConfigSchema.default({
    provider: 'local',
    repo: 'local',
    auth: { token: 'local' },
  }),
  fs: FSConfigSchema.default({}),
  allowedImports: z.array(z.string()).default(['@tgp/std', 'zod', 'date-fns']),
  allowedFetchUrls: z.array(z.string()).optional().describe('Whitelist of URL prefixes the sandbox fetch can access.'),
});

// --- Inferred Static Types ---
// We export these so the rest of the app relies on the Zod inference, 
// ensuring types and validation never drift apart.
export type GitConfig = z.infer<typeof GitConfigSchema>;
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

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
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
| **`exec_sql`**   | `(sql: string, params: object) => any` | Executes a raw SQL query against the host database. |

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

  // 1. BACKEND (GitOps)
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

  // 2. FILESYSTEM JAIL
  fs: {
    allowedDirs: ['./public/exports', './tmp'],
    blockUpwardTraversal: true
  },

  // 3. RUNTIME
  allowedImports: ['@tgp/std', 'zod', 'date-fns'],

  // 4. NETWORKING
  // Whitelist of URL prefixes the sandbox fetch can access.
  allowedFetchUrls: ['https://api.stripe.com']
});
```

## 7.3 Runtime Usage (The SDK)

```typescript
// src/app/api/agent/route.ts
import { TGP, tgpTools, createSqlTools } from '@tgp/core';
import { generateText } from 'ai';
import { myDbExecutor } from '@/lib/db'; // Your DB connection

const kernel = new TGP({ configFile: './tgp.config.ts' });

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Injects: list_files, read_file, write_file, exec_tool
  const systemTools = tgpTools(kernel);
  // Injects the `exec_sql` tool, powered by your database
  const dataTools = createSqlTools(myDbExecutor);

  const result = await generateText({
    model: openai('gpt-4-turbo'),
    tools: { ...systemTools, ...dataTools },
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

## File: src/kernel/core.ts
````typescript
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
  sandboxAPI?: Record<string, unknown>;
}

export interface Kernel {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  config: TGPConfig;
  vfs: VFSAdapter;
  git: GitBackend;
  registry: Registry;
  logger: Logger;
  sandboxAPI: Record<string, unknown>;
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
  const { config, vfs, env, sandboxAPI } = opts;
  const logger = opts.logger ?? defaultLogger;
  
  const git = createGitBackend(env, config, logger);
  const registry = createRegistry(vfs);
  const api = sandboxAPI ?? {};

  let isBooted = false;

  return {
    config,
    vfs,
    git,
    registry,
    logger,
    sandboxAPI: api,

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
````

## File: package.json
````json
{
  "name": "@tgp/core",
  "version": "0.0.1",
  "description": "The Tool Generation Protocol",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "pretest": "npm run build",
    "test": "vitest run --passWithNoTests",
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
    "isolated-vm": "^6.0.2",
    "isomorphic-git": "^1.35.1",
    "zod": "^3.25.76",
    "zod-to-json-schema": "^3.22.4",
    "typescript": "^5.9.3"
  },
  "devDependencies": {
    "@types/node": "^20.19.25",
    "@types/better-sqlite3": "^7.6.9",
    "@typescript-eslint/eslint-plugin": "^8.48.0",
    "@typescript-eslint/parser": "^8.48.0",
    "better-sqlite3": "^9.4.3",
    "eslint": "^9.39.1",
    "tsx": "^4.16.2",
    "vitest": "^1.6.0"
  }
}
````

## File: src/sandbox/execute.ts
````typescript
import { Kernel } from '../kernel/core.js';
import { createSandbox } from './isolate.js';
import { createSandboxBridge } from './bridge.js';
import { bundleDependencySync } from './bundler.js';
import { transformSync } from 'esbuild';
import * as path from 'path';

export interface ExecutionResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  logs: string[];
  error?: string;
}

/**
 * Resolves a module path within the VFS using standard Node.js resolution logic.
 * Checks: path, path.ts, path.js, path/index.ts, path/index.js
 */
function resolveVfsPath(vfs: Kernel['vfs'], baseDir: string, importPath: string): string | null {
  const candidates: string[] = [];
  
  // Resolve absolute path based on import type
  // If it starts with '/', it's absolute (from VFS root).
  // Otherwise, it's relative to baseDir.
  const target = importPath.startsWith('/') 
    ? importPath 
    : path.join(baseDir, importPath);

  // 1. Exact match (e.g. require('./foo.ts'))
  candidates.push(target);
  
  // 2. Extensions (e.g. require('./foo'))
  candidates.push(`${target}.ts`);
  candidates.push(`${target}.js`);
  
  // 3. Directory Indices
  candidates.push(path.join(target, 'index.ts'));
  candidates.push(path.join(target, 'index.js'));

  for (const c of candidates) {
    try {
      // Synchronous check is required for the sync require shim
      vfs.readSync(c);
      return c;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Executes a tool script within a secure sandbox.
 * 
 * @param kernel The TGP Kernel instance
 * @param code The TypeScript source code of the tool
 * @param args The arguments object to pass to the tool (as 'args' global)
 * @param filePath Optional path of the tool being executed (used for relative imports)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeTool(kernel: Kernel, code: string, args: Record<string, any> = {}, filePath: string = 'root.ts'): Promise<ExecutionResult> {
  const sandbox = createSandbox({
    memoryLimitMb: 128,
    timeoutMs: 5000 // 5s hard limit
  });
  
  const logs: string[] = [];

  try {
    // 1. Setup Bridge
    // We pass the kernel directly.
    const bridge = createSandboxBridge({
      kernel,
      onLog: (msg) => logs.push(msg)
    });

    // 2. Module Orchestration (The 'require' Bridge)
    // This host function is called synchronously from the Guest.
    const __tgp_load_module = (baseDir: string, importId: string) => {
      // 1. Handle whitelisted node modules (bare specifiers)
      if (!importId.startsWith('.') && !importId.startsWith('/')) {
        if (!kernel.config.allowedImports.includes(importId)) {
          throw new Error(`Security Violation: Import of module '${importId}' is not allowed. Allowed modules are: ${kernel.config.allowedImports.join(', ')}`);
        }
        try {
          const bundledCode = bundleDependencySync(importId);
          return {
            code: bundledCode,
            path: `/__node_modules__/${importId}`, // Virtual path for caching
            dirname: `/__node_modules__`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to bundle allowed module '${importId}': ${msg}`);
        }
      }

      // 2. Resolve Local Modules (VFS)
      const resolvedPath = resolveVfsPath(kernel.vfs, baseDir, importId);

      if (resolvedPath === null) {
        throw new Error(`Cannot find module '${importId}' from '${baseDir}'`);
      }

      try {
        const raw = kernel.vfs.readSync(resolvedPath);
        const transformed = transformSync(raw, {
          loader: 'ts',
          format: 'cjs',
          target: 'es2020',
        });
        
        return {
          code: transformed.code,
          path: resolvedPath,
          dirname: path.dirname(resolvedPath)
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load module '${importId}' from '${baseDir}': ${msg}`);
      }
    };

    // 3. Shim Injection
    // We prepend a CommonJS loader shim to the user code.
    // This allows 'require' to work by calling back to the host via __tgp_load_module.
    // It includes a cache to prevent reloading the same module within a single execution.
    const shim = `
      const __moduleCache = {};

      function __makeRequire(baseDir) {
        return function(id) {
          // HOST INTERACTION: Resolve module path and get its source code from the host.
          // This is a synchronous call to the Node.js environment.
          
          let mod;
          if (typeof __tgp_load_module.applySync === 'function') {
             mod = __tgp_load_module.applySync(undefined, [baseDir, id]);
          } else {
             mod = __tgp_load_module(baseDir, id);
          }

          // CACHE CHECK: If the module has already been loaded, return it from the cache.
          if (__moduleCache[mod.path]) {
            return __moduleCache[mod.path].exports;
          }

          // MODULE EXECUTION: If it's a new module, execute its code.
          const newModule = { exports: {} };

          // Before executing, store the module object in the cache to handle circular dependencies.
          __moduleCache[mod.path] = newModule;

          // We provide the module with its own 'exports' object, a 'require' function
          // scoped to its own directory, and other CommonJS globals.
          const fun = new Function('exports', 'require', 'module', '__filename', '__dirname', mod.code);

          // Execute the module's code.
          fun(newModule.exports, __makeRequire(mod.dirname), newModule, mod.path, mod.dirname);

          // The 'newModule.exports' object is now populated.
          return newModule.exports;
        };
      }
    `;

    const context = {
      ...bridge, // { tgp: { ... } }
      args,
      __tgp_load_module // Injected as Reference
    };

    // 1. Transform user code to CJS explicitly
    // We do this to ensure we can wrap it safely without worrying about top-level imports in the final string
    const { code: cjsCode } = transformSync(code, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2020',
    });

    // 2. Construct the Execution Harness
    const script = `
      ${shim}

      // Setup CJS Environment for the entry point
      global.exports = {};
      global.module = { exports: global.exports };
      global.require = __makeRequire('${path.dirname(filePath)}');

      // Execute User Code
      (function() {
        ${cjsCode}
      })();

      // Run Default Export
      const __main = global.module.exports.default || global.module.exports;
      if (typeof __main === 'function') {
         __main(global.args);
      } else {
         __main;
      }
    `;

    const result = await sandbox.compileAndRun(script, context);
    return { result, logs };

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    kernel.logger.error(`Tool Execution Failed:`, error);
    return { result: null, logs, error: errMsg };
  } finally {
    sandbox.dispose();
  }
}
````

## File: src/kernel/git.ts
````typescript
import * as git from 'isomorphic-git';
import { TGPConfig, Logger } from '../types.js';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * The Git Interface required by the Kernel.
 * We rely on the 'fs' interface compatible with isomorphic-git.
 */
export interface GitBackend {
  hydrate(): Promise<void>;
  persist(message: string, files: string[]): Promise<void>;
}

export interface GitDependencies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http: any;
}

/**
 * Strategy interface for persisting changes to the upstream repository.
 */
interface GitWriteStrategy {
  persist(message: string, files: string[]): Promise<void>;
}

/**
 * Adapter interface for Git Hosting Platforms.
 * Handles platform-specific API calls like creating Pull Requests.
 */
interface GitPlatformAdapter {
  createPullRequest(opts: {
    title: string;
    branch: string;
    base: string;
    body: string;
  }): Promise<void>;
}

class GitHubAdapter implements GitPlatformAdapter {
  constructor(
    private repo: string,
    private token: string,
    private apiBaseUrl: string,
    private logger: Logger
  ) {}

  async createPullRequest(opts: { title: string; branch: string; base: string; body: string }): Promise<void> {
    const [owner, repoName] = this.repo.split('/');
    const url = new URL(`/repos/${owner}/${repoName}/pulls`, this.apiBaseUrl).href;

    this.logger.info(`Creating Pull Request on ${this.repo}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: opts.title,
          head: opts.branch,
          base: opts.base,
          body: opts.body,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        this.logger.info(`Successfully created Pull Request: ${result.html_url}`);
      } else if (response.status === 422) {
        this.logger.warn(`Could not create PR (it may already exist): ${JSON.stringify(result.errors)}`);
      } else {
        this.logger.error(`GitHub API Error: ${response.status} ${response.statusText}`, result);
      }
    } catch (e) {
      this.logger.error('Failed to create pull request via API.', e);
      throw e;
    }
  }
}

class NotImplementedAdapter implements GitPlatformAdapter {
  constructor(private provider: string) {}
  async createPullRequest(): Promise<void> {
    throw new Error(`Git Provider '${this.provider}' is not yet implemented.`);
  }
}

// --- Local Git Implementation (Shell-based) ---
// Used for E2E testing and Air-gapped environments
async function execGit(args: string[], cwd: string, logger: Logger): Promise<void> {
  logger.debug(`[Local] Executing: git ${args.join(' ')} in ${cwd}`);
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Git command failed: git ${args.join(' ')} in ${cwd}\nOutput: ${output}`));
    });
  });
}

function createLocalGitBackend(config: TGPConfig, logger: Logger): GitBackend {
  const dir = config.rootDir;
  const { repo, branch } = config.git;

  return {
    async hydrate() {
      const fs = await import('node:fs/promises');
      const gitDirExists = await fs.stat(path.join(dir, '.git')).then(() => true).catch(() => false);
      
      if (!gitDirExists) {
        logger.info(`[Local] Cloning ${repo} into ${dir}...`);
        await fs.mkdir(path.dirname(dir), { recursive: true });
        // Clone needs to happen in parent dir
        // We assume 'repo' is an absolute path to a bare repo
        await execGit(['clone', repo, path.basename(dir)], path.dirname(dir), logger);
        
        // Ensure we are on correct branch
        try {
            await execGit(['checkout', branch], dir, logger);
        } catch {
            logger.warn(`[Local] Failed to checkout ${branch}, assuming default.`);
        }
      } else {
        logger.info(`[Local] Pulling latest from ${repo}...`);
        await execGit(['pull', 'origin', branch], dir, logger);
      }
    },

    async persist(message: string, files: string[]) {
      if (files.length === 0) return;
      logger.info(`[Local] Persisting ${files.length} files...`);
      
      for (const f of files) {
        await execGit(['add', f], dir, logger);
      }
      
      try {
        await execGit(['commit', '-m', message], dir, logger);
      } catch(e) {
         // Commit might fail if no changes
         logger.warn(`[Local] Commit failed (empty?):`, String(e));
         return;
      }

      try {
          await execGit(['push', 'origin', branch], dir, logger);
      } catch {
          // Handle non-fast-forward by pulling first (simple auto-merge)
          logger.warn(`[Local] Push failed. Attempting merge...`);
          // We use standard merge (no-rebase) as it handles 'meta.json' append conflicts slightly better 
          // in automated scenarios than rebase, which can get stuck.
          await execGit(['pull', '--no-rebase', 'origin', branch], dir, logger);
          await execGit(['push', 'origin', branch], dir, logger);
      }
    }
  };
}

/**
 * Factory to create the Git Backend based on configuration.
 */
export function createGitBackend(deps: GitDependencies, config: TGPConfig, logger: Logger): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy, apiBaseUrl, provider } = config.git;
  const { fs, http } = deps;

  if (provider === 'local') {
    return createLocalGitBackend(config, logger);
  }

  // Configuration for isomorphic-git
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

  // Select Platform Adapter
  let platformAdapter: GitPlatformAdapter;
  if (provider === 'github') {
    platformAdapter = new GitHubAdapter(repo, auth.token, apiBaseUrl, logger);
  } else {
    platformAdapter = new NotImplementedAdapter(provider);
  }

  // --- Strategy Implementations ---

  const directStrategy: GitWriteStrategy = {
    async persist(message: string, filesToAdd: string[]) {
      if (filesToAdd.length === 0) return;

      // 1. Add files
      for (const filepath of filesToAdd) {
        try {
           // check if file exists before adding
           await git.add({ ...gitOpts, filepath });
        } catch (e) {
           logger.warn(`Git Add failed for ${filepath}`, e);
           throw new Error(`Failed to stage file ${filepath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      try {
        // 2. Commit
        const sha = await git.commit({
          ...gitOpts,
          message,
          author,
        });
        logger.info(`Committed ${sha.slice(0, 7)}: ${message}`);

        // 3. Push
        logger.info(`Pushing to ${branch}...`);
        await git.push({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
        });
      } catch (e) {
        logger.error(`Git Commit/Push failed:`, e);
        throw new Error(`Failed to persist changes to Git: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const prStrategy: GitWriteStrategy = {
    async persist(message: string, files: string[]) {
      if (files.length === 0) return;
      
      // 1. Get current branch
      const currentBranch = await git.currentBranch({ ...gitOpts }) ?? 'HEAD';
      
      // 2. If we are on the protected branch (main/master), we must fork
      let targetBranch = currentBranch;
      
      if (currentBranch === branch) {
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         // Sanitize message for branch name
         const safeMsg = message.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
         targetBranch = `tgp/feat-${timestamp}-${safeMsg}`;
         
         logger.info(`Switching to new branch: ${targetBranch}`);
         
         await git.branch({ ...gitOpts, ref: targetBranch });
         await git.checkout({ ...gitOpts, ref: targetBranch });
      } else {
         logger.info(`Already on feature branch: ${targetBranch}`);
      }

      for (const filepath of files) {
        await git.add({ ...gitOpts, filepath }).catch(e => logger.warn(`Git Add failed ${filepath}`, e));
      }

      await git.commit({
        ...gitOpts,
        message: message,
        author,
      });
      
      logger.info(`Changes committed to ${targetBranch}.`);
      
      // Try to push the feature branch if auth is present
      try {
          await git.push({
            ...gitOpts,
            remote: 'origin',
            ref: targetBranch,
          });
          logger.info(`Pushed ${targetBranch} to origin.`);
          await platformAdapter.createPullRequest({
            title: message,
            branch: targetBranch,
            base: branch,
            body: `Forged by TGP.\nCommit Message: ${message}`,
          });
      } catch (e) {
          logger.warn(`Failed to push feature branch. Changes are local only.`, e);
      }
    }
  };

  // Select Strategy
  const strategy = writeStrategy === 'pr' ? prStrategy : directStrategy;

  return {
    async hydrate() {
      try {
        // 1. Check if repo exists locally
        const gitDirExists = (await fs.promises.stat(path.join(dir, '.git'))
          .then(() => true)
          .catch(() => false)) as boolean;

        if (!gitDirExists) {
          // Clone
          logger.info(`Cloning ${repo} into ${dir}...`);
          await git.clone({
            ...gitOpts,
            url: `https://github.com/${repo}.git`,
            ref: branch,
            singleBranch: true,
            depth: 1,
          });
        } else {
          // Pull
          logger.info(`Pulling latest from ${repo}...`);
          await git.pull({
            ...gitOpts,
            remote: 'origin',
            ref: branch,
            singleBranch: true,
            author,
          });
        }
      } catch (error) {
        logger.error(`Git Hydration Failed:`, error);
        // Fail fast: The agent cannot operate without a consistent filesystem state.
        throw error;
      }
    },

    async persist(message: string, filesToAdd: string[]) {
      return strategy.persist(message, filesToAdd);
    }
  };
}
````
