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