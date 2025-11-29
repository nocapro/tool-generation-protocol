import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createValidationTools } from '../../src/tools/validation.js';
import { createNodeVFS } from '../../src/vfs/node.js';
import { createTempDir, cleanupDir } from './utils.js';
import { Kernel } from '../../src/kernel/core.js';

describe('Unit: Tool Validation Logic', () => {
  let tempDir: string;
  let kernel: Kernel;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-unit-validation-');
    const vfs = createNodeVFS(tempDir);
    // Stub Kernel with Real VFS
    kernel = {
        vfs,
        config: { allowedImports: ['zod'] }
    } as unknown as Kernel;
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  // Helper to run validation
  async function check(code: string) {
      const path = 'test_tool.ts';
      await kernel.vfs.writeFile(path, code);
      const tools = createValidationTools(kernel);
      return await tools.check_tool.execute({ path });
  }

  it('Static Analysis: Global Process Forbidden', async () => {
    const code = `export default function() { process.exit(0); }`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes('process'))).toBe(true);
  });

  it('Static Analysis: Restricted Imports', async () => {
    const code = `import fs from 'fs'; export default () => {};`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes('import'))).toBe(true);
  });

  it('Static Analysis: Magic Numbers', async () => {
    const code = `export default (n: number) => n * 99;`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes('Magic Number'))).toBe(true);
  });

  it('Static Analysis: Any Keyword Forbidden', async () => {
    const code = `export default (x: any) => x;`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes("any' is prohibited"))).toBe(true);
  });

  it('Static Analysis: Eval Forbidden', async () => {
    const code = `export default () => eval("1+1");`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes("'eval') is prohibited"))).toBe(true);
  });

  it('Static Analysis: Function Constructor Forbidden', async () => {
    const code = `export default () => new Function("return 1");`;
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes("'Function' constructor) is prohibited"))).toBe(true);
  });
  
  it('Static Analysis: Hardcoded Secrets', async () => {
    const code = `export default () => "sk-live-1234567890abcdef12345678";`; // >24 chars, alphanumeric
    const res = await check(code);
    
    expect(res.valid).toBe(false);
    expect(res.errors.some((e: string) => e.includes("Secret detected"))).toBe(true);
  });

  it('Static Analysis: Valid Code', async () => {
    const code = `export default (args: { n: number }) => args.n * 2;`;
    const res = await check(code);
    
    expect(res.valid).toBe(true);
  });
});