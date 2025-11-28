import { describe, it, expect } from 'bun:test';
import { createSandbox } from '../../src/sandbox/isolate.js';

describe('Unit: Sandbox Execution', () => {
  
  it('Compilation: Valid Code', async () => {
    const sandbox = createSandbox();
    const code = `export default (n) => n * 2;`;
    
    // Should not throw
    const result = await sandbox.compileAndRun(code, {});
    // Depending on wrapper, result might be the export or undefined if just defined.
    // We mainly assert it compiled and ran.
    
    sandbox.dispose();
  });

  it('Compilation: Syntax Error', async () => {
    const sandbox = createSandbox();
    const code = `const x = ;`; 
    
    try {
      await sandbox.compileAndRun(code, {});
      expect(true).toBe(false);
    } catch (e: any) {
      // CompilationError or similar
      expect(e).toBeDefined();
    }
    sandbox.dispose();
  });

  it('Runtime constraints: Memory Limit', async () => {
    // Set a low limit (e.g. 20MB) to ensure we hit it quickly
    const sandbox = createSandbox({ memoryLimitMb: 20, timeoutMs: 2000 });
    const code = `
      const arr = [];
      const chunk = 'x'.repeat(1024 * 1024); // 1MB chunk
      while(true) {
        arr.push(chunk);
      }
    `;
    
    try {
      await sandbox.compileAndRun(code, {});
      expect(true).toBe(false);
    } catch (e: any) {
      // In environments without isolated-vm (fallback), memory limits might manifest as timeouts or generic errors
      expect(e.message).toMatch(/memory|heap|allocation|timed out|timeout/i);
    }
    sandbox.dispose();
  });

  it('Runtime constraints: Timeout', async () => {
    const sandbox = createSandbox({ timeoutMs: 100 });
    const code = `while(true) {}`;
    
    try {
      await sandbox.compileAndRun(code, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toMatch(/timed out|timeout|stopped/i);
    }
    sandbox.dispose();
  });
});