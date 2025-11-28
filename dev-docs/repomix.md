# Directory Structure
```
test/
  e2e/
    scenarios.test.ts
    utils.ts
  integration/
    bridge.test.ts
    gitops.test.ts
    sql.test.ts
test-docs/
  e2e.test-plan.md
```

# Files

## File: test/integration/bridge.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createTempDir, createTgpConfig, cleanupDir, initBareRepo } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools, createSqlTools } from '../../src/tools/index.js';

// Abstraction for DB differences between Node (better-sqlite3) and Bun (bun:sqlite)
// This ensures tests run natively in Bun without 'better-sqlite3' ABI issues,
// while maintaining Node compatibility.
interface TestDB {
  exec(sql: string): void;
  prepare(sql: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all(...params: any[]): any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(...params: any[]): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run(...params: any[]): any;
  };
  close(): void;
}

async function createTestDB(): Promise<TestDB> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isBun = typeof process !== 'undefined' && (process.versions as any).bun;

  if (isBun) {
    // Dynamic import to avoid build-time errors/resolutions in Node
    const { Database } = await import('bun:sqlite'); 
    const db = new Database(':memory:');
    return {
      exec: (sql: string) => db.run(sql),
      prepare: (sql: string) => {
        const query = db.query(sql);
        return {
          all: (...params: any[]) => query.all(...params),
          get: (...params: any[]) => query.get(...params),
          run: (...params: any[]) => query.run(...params),
        };
      },
      close: () => db.close(),
    };
  } else {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        return {
          all: (...params: any[]) => stmt.all(...params),
          get: (...params: any[]) => stmt.get(...params),
          run: (...params: any[]) => stmt.run(...params),
        };
      },
      close: () => db.close(),
    };
  }
}

describe('Integration: SQL Adapter (Real SQLite)', () => {
  let tempDir: string;
  let remoteRepo: string;
  let db: TestDB;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-sql-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
    
    // Setup Real SQLite DB (In-memory for speed/isolation)
    db = await createTestDB();
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
        return stmt.all(...params);
      }
      return stmt.run(...params);
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
      return db.prepare(sql).run(...params);
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
    // Since we manage transaction via raw SQL commands
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

## File: test/e2e/scenarios.test.ts
````typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, initBareRepo, createTgpConfig, runTgpCli, cleanupDir } from './utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools } from '../../src/tools/index.js';
import { createSqlTools } from '../../src/tools/sql.js';

describe('E2E Scenarios', () => {
  let tempDir: string;
  let remoteRepo: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('Scenario 1: Cold Start (Hydration, Fabrication, Execution)', async () => {
    // 1. Setup Config
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    
    // 2. Boot Kernel
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    
    const tools = tgpTools(kernel);

    // 3. Create a Tool (Fibonacci)
    const fibPath = 'tools/math/fib.ts';
    const fibCode = `
      export default function fib(args: { n: number }) {
        const n = args.n;
        if (n <= 1) return n;
        let a = 0, b = 1;
        for (let i = 2; i <= n; i++) {
          const temp = a + b;
          a = b;
          b = temp;
        }
        return b;
      }
    `;

    const writeRes = await tools.write_file.execute({ path: fibPath, content: fibCode });
    expect(writeRes.success).toBe(true);

    // 4. Validate Tool
    const checkRes = await tools.check_tool.execute({ path: fibPath });
    expect(checkRes.valid).toBe(true);

    // 5. Execute Tool
    const execRes = await tools.exec_tool.execute({ path: fibPath, args: { n: 10 } });
    expect(execRes.success).toBe(true);
    expect(execRes.result).toBe(55);

    // 6. Verify Persistence
    // Clone remote repo to a new dir and check file existence
    const verifyDir = await createTempDir('tgp-verify-');
    const { execSync } = await import('node:child_process');
    execSync(`git clone ${remoteRepo} .`, { cwd: verifyDir, stdio: 'ignore' });
    
    const exists = await fs.access(path.join(verifyDir, fibPath)).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await cleanupDir(verifyDir);
  });

  it('Scenario 2: Concurrency (The Merge Test)', async () => {
    // Agent A
    const dirA = await createTempDir('tgp-agent-a-');
    const configA = await createTgpConfig(dirA, remoteRepo);
    const kernelA = new TGP({ configFile: configA });
    await kernelA.boot();

    // Agent B
    const dirB = await createTempDir('tgp-agent-b-');
    const configB = await createTgpConfig(dirB, remoteRepo);
    const kernelB = new TGP({ configFile: configB });
    await kernelB.boot();

    const toolsA = tgpTools(kernelA);
    const toolsB = tgpTools(kernelB);

    // Both agents create different tools simultaneously
    // This forces one to fail the push, auto-rebase, and push again.
    await Promise.all([
      toolsA.write_file.execute({ 
        path: 'tools/tool_A.ts', 
        content: 'export default () => "A"' 
      }),
      toolsB.write_file.execute({ 
        path: 'tools/tool_B.ts', 
        content: 'export default () => "B"' 
      })
    ]);
    
    // Verify using a fresh Agent C
    const dirC = await createTempDir('tgp-agent-c-');
    const configC = await createTgpConfig(dirC, remoteRepo);
    const kernelC = new TGP({ configFile: configC });
    await kernelC.boot();
    
    const files = await kernelC.vfs.listFiles('tools');
    expect(files).toContain('tools/tool_A.ts');
    expect(files).toContain('tools/tool_B.ts');

    await cleanupDir(dirA);
    await cleanupDir(dirB);
    await cleanupDir(dirC);
  });

  it('Scenario 3: Refactor (Search & Replace)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    const toolName = 'tools/greet.ts';
    await tools.write_file.execute({ 
      path: toolName, 
      content: `export default function(args: { name: string }) { return "hello " + args.name; }`
    });

    let res = await tools.exec_tool.execute({ path: toolName, args: { name: 'world' } });
    expect(res.result).toBe('hello world');

    await tools.patch_file.execute({
      path: toolName,
      search: 'return "hello " + args.name;',
      replace: 'return "greetings " + args.name;'
    });

    res = await tools.exec_tool.execute({ path: toolName, args: { name: 'world' } });
    expect(res.result).toBe('greetings world');
  });

  it('Scenario 4: Resilience (Infinite Loop)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    const badTool = 'tools/freeze.ts';
    await tools.write_file.execute({
      path: badTool,
      content: `export default function() { while(true) {} }`
    });

    const res = await tools.exec_tool.execute({ path: badTool, args: {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out/i);
  });

  it('Scenario 5: Security (Jailbreak)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    const hackTool = 'tools/hack.ts';
    await tools.write_file.execute({
      path: hackTool,
      content: `
        export default async function() {
           return await tgp.read_file('../../package.json');
        }
      `
    });

    const res = await tools.exec_tool.execute({ path: hackTool, args: {} });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Security Violation/i);
  });

  it('Scenario 6: SQL Error Propagation', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);

    // Mock DB executor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockExecutor = async (sql: string, _params: any[] = []) => {
      if (sql.includes('fail')) {
        throw new Error('Database Error');
      }
      return [];
    };

    const kernel = new TGP({ 
      configFile: configPath,
      sandboxAPI: { exec_sql: mockExecutor }
    });
    await kernel.boot();

    const tools = { ...tgpTools(kernel), ...createSqlTools(mockExecutor) };

    const dbTool = 'tools/db_ops.ts';
    await tools.write_file.execute({
      path: dbTool,
      content: `
        export default async function(args: { crash: boolean }) {
           if (args.crash) {
              await tgp.exec_sql('SELECT * FROM users WHERE name = "fail"', []);
           }
        }
      `
    });

    const res = await tools.exec_tool.execute({ path: dbTool, args: { crash: true } });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Database Error');
  });

  it('Scenario 9: Tool Composition (Orchestrator)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    // 1. Create the Library Tool (The Dependency)
    const libPath = 'tools/lib/multiplier.ts';
    await tools.write_file.execute({
      path: libPath,
      content: `
        export default function multiply(a: number, b: number) {
          return a * b;
        }
      `
    });

    // 2. Create the Consumer Tool (The Orchestrator)
    const consumerPath = 'tools/calc.ts';
    // Note: We use require() because the sandbox environment uses CommonJS shim for inter-tool dependencies.
    await tools.write_file.execute({
      path: consumerPath,
      content: `
        const multiplier = require('./lib/multiplier').default;

        export default function calculate(args: { a: number, b: number }) {
          // Logic: (a * b) + 100
          const product = multiplier(args.a, args.b);
          return product + 100;
        }
      `
    });

    // 3. Execute
    const res = await tools.exec_tool.execute({ 
      path: consumerPath, 
      args: { a: 5, b: 5 } 
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe(125); // (5 * 5) + 100
  });

  it('Scenario 10: Registry Integrity (Meta.json)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    const docTool = 'tools/docs/roi.ts';
    const description = 'Calculates the Return on Investment based on cost and revenue.';
    
    // Write tool with JSDoc
    await tools.write_file.execute({
      path: docTool,
      content: `
        /**
         * ${description}
         */
        export default function roi(args: { cost: number, revenue: number }) {
          return (args.revenue - args.cost) / args.cost;
        }
      `
    });

    // Verify meta.json in the VFS backing store (on disk)
    // Note: The VFS root is at .tgp inside the tempDir
    const metaPath = path.join(tempDir, '.tgp/meta.json');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent);

    expect(meta.tools[docTool]).toBeDefined();
    expect(meta.tools[docTool].description).toBe(description);
  });

  it('Scenario 11: Standards Enforcement (Linter)', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = tgpTools(kernel);

    // Test 1: Magic Number
    const magicTool = 'tools/bad/magic.ts';
    await tools.write_file.execute({
      path: magicTool,
      content: `export default function(args: { x: number }) { return args.x * 9999; }`
    });

    let check = await tools.check_tool.execute({ path: magicTool });
    expect(check.valid).toBe(false);
    expect(check.errors.some(e => e.includes('Magic Number'))).toBe(true);

    // Test 2: Hardcoded Secret
    const secretTool = 'tools/bad/secret.ts';
    await tools.write_file.execute({
      path: secretTool,
      content: `
        export default function() { 
          const apiKey = "sk-live-1234567890abcdef12345678"; 
          return apiKey;
        }
      `
    });

    check = await tools.check_tool.execute({ path: secretTool });
    expect(check.valid).toBe(false);
    expect(check.errors.some(e => e.includes('Secret'))).toBe(true);

    // Test 3: Valid Tool (Control)
    const validTool = 'tools/good/clean.ts';
    await tools.write_file.execute({
      path: validTool,
      content: `export default function(args: { factor: number }) { return args.factor * 100; }` // 100 is allowed
    });

    check = await tools.check_tool.execute({ path: validTool });
    expect(check.valid).toBe(true);
  });

  // Note: Scenario 7 (SIGTERM) is skipped as the CLI currently does not have a long-running 'serve' mode to test against.

  it('Scenario 8: CLI Bootstrap', async () => {
    // We assume the project has been built via 'npm run build' for bin/tgp.js to work
    // If not, this test might fail if dist/ doesn't exist.
    const { code } = await runTgpCli(['init'], tempDir);
    expect(code).toBe(0);
    
    const configExists = await fs.access(path.join(tempDir, 'tgp.config.ts')).then(() => true).catch(() => false);
    expect(configExists).toBe(true);
    
    const metaExists = await fs.access(path.join(tempDir, '.tgp/meta.json')).then(() => true).catch(() => false);
    expect(metaExists).toBe(true);
  });
});
````

## File: test/e2e/utils.ts
````typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM Polyfills
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust Project Root Detection
// If running from dist/test/e2e, we are 3 levels deep from root (dist/test/e2e -> dist/test -> dist -> root)
// If running from test/e2e, we are 2 levels deep (test/e2e -> test -> root)
const isRunningInDist = __dirname.includes(path.join('dist', 'test', 'e2e'));

const projectRoot = isRunningInDist 
  ? path.resolve(__dirname, '../../../') 
  : path.resolve(__dirname, '../../');

const distConfigPath = path.join(projectRoot, 'dist/src/config.js').split(path.sep).join('/');

// Track temp dirs for cleanup
const tempDirs: string[] = [];

/**
 * Creates a unique temporary directory for a test case.
 * Registers it for auto-cleanup on process exit.
 */
export async function createTempDir(prefix: string = 'tgp-e2e-'): Promise<string> {
  const tmpDir = os.tmpdir();
  const dir = await fs.mkdtemp(path.join(tmpDir, prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Recursively deletes a directory.
 */
export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Initializes a bare Git repository at the specified path.
 * This serves as the 'Remote' for the E2E tests.
 */
export async function initBareRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  execSync(`git init --bare`, { cwd: dir, stdio: 'ignore' });
  
  // Setup: Create an initial commit so all clones share a history.
  // This prevents "fatal: refusing to merge unrelated histories" during concurrent pushes.
  const initDir = await createTempDir('tgp-init-');
  execSync(`git init`, { cwd: initDir, stdio: 'ignore' });
  await fs.writeFile(path.join(initDir, 'README.md'), '# Remote Root');
  execSync(`git add .`, { cwd: initDir, stdio: 'ignore' });
  execSync(`git commit -m "Initial commit"`, { cwd: initDir, stdio: 'ignore' });
  execSync(`git remote add origin ${dir}`, { cwd: initDir, stdio: 'ignore' });
  execSync(`git push origin master:main`, { cwd: initDir, stdio: 'ignore' }); // push master to main
  await cleanupDir(initDir);

  execSync(`git symbolic-ref HEAD refs/heads/main`, { cwd: dir, stdio: 'ignore' });
}

/**
 * Generates a tgp.config.ts file in the test directory pointing to the local bare repo.
 * We use an absolute path for rootDir to ensure tests don't pollute the project root.
 */
export async function createTgpConfig(workDir: string, remoteRepo: string, fileName: string = 'tgp.config.js'): Promise<string> {
    const rootDir = path.join(workDir, '.tgp').split(path.sep).join('/');
    const remotePath = remoteRepo.split(path.sep).join('/');
    const allowedDir = workDir.split(path.sep).join('/');

    // We MUST import from the built distribution because:
    // 1. 'node bin/tgp.js' does not have a TS loader, so it cannot import .ts files.
    // 2. The generated config itself must be .js.
    // 3. The import path inside it must resolve to a .js file that Node can understand.
    
    // Verify dist exists
    try {
      await fs.access(path.join(projectRoot, 'dist/src/config.js'));
    } catch {
      // Fallback for dev/watch mode if dist doesn't exist (though E2E usually implies build)
      // console.warn("Warning: dist/src/config.js not found. E2E tests might fail if running via 'node bin/tgp.js'.");
    }

    const configContent = `
import { defineTGPConfig } from '${distConfigPath}';

export default defineTGPConfig({
  rootDir: '${rootDir}',
  git: {
    provider: 'local',
    repo: '${remotePath}',
    branch: 'main',
    auth: { token: 'mock', user: 'test', email: 'test@example.com' }
  },
  fs: {
    allowedDirs: ['${allowedDir}', '${os.tmpdir().split(path.sep).join('/')}'],
    blockUpwardTraversal: false
  },
  allowedImports: ['zod', 'date-fns']
});
`;
    const configPath = path.join(workDir, fileName);
    await fs.writeFile(configPath, configContent);
    return configPath;
}

/**
 * Executes the TGP CLI binary in the given directory.
 */
export function runTgpCli(args: string[], cwd: string): Promise<{ stdout: string, stderr: string, code: number }> {
    return new Promise((resolve) => {
        // Points to the source bin wrapper, which imports from dist/
        // Note: 'npm run build' must be run before testing CLI if using the bin script directly.
        // For development tests, we might want to run with tsx, but here we test the "production" bin behavior logic.
        const tgpBin = path.join(projectRoot, 'bin/tgp.js');
        
        const proc = spawn('node', [tgpBin, ...args], {
            cwd,
            env: { ...process.env, NODE_ENV: 'test' }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', (code) => {
            resolve({ stdout, stderr, code: code ?? -1 });
        });
    });
}

// Cleanup hook
process.on('exit', () => {
    tempDirs.forEach(d => {
        try { execSync(`rm -rf ${d}`); } catch {}
    });
});
````
