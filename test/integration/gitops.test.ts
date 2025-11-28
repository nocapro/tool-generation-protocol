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