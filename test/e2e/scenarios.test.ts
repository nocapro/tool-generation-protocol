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
    expect(check.errors.some((e: string) => e.includes('Magic Number'))).toBe(true);

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
    expect(check.errors.some((e: string) => e.includes('Secret'))).toBe(true);

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