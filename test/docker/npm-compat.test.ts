import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { createTarball, Container } from './utils.js';

// Define the root of the project
const projectRoot = path.resolve(__dirname, '../../');

// Modified utils.ts to be injected into the container
// This ensures tests use the installed package 'tool-generation-protocol' 
// instead of trying to resolve local paths or dist/ folders.
const CONTAINER_UTILS_TS = `
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, execSync } from 'node:child_process';

const tempDirs: string[] = [];

export async function createTempDir(prefix: string = 'tgp-e2e-'): Promise<string> {
  const tmpDir = os.tmpdir();
  const dir = await fs.mkdtemp(path.join(tmpDir, prefix));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function initBareRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  execSync(\`git init --bare\`, { cwd: dir, stdio: 'ignore' });
  const initDir = await createTempDir('tgp-init-');
  execSync(\`git init\`, { cwd: initDir, stdio: 'ignore' });
  await fs.writeFile(path.join(initDir, 'README.md'), '# Remote Root');
  execSync(\`git add .\`, { cwd: initDir, stdio: 'ignore' });
  execSync(\`git commit -m "Initial commit"\`, { cwd: initDir, stdio: 'ignore' });
  execSync(\`git remote add origin \${dir}\`, { cwd: initDir, stdio: 'ignore' });
  execSync(\`git push origin master:main\`, { cwd: initDir, stdio: 'ignore' });
  await cleanupDir(initDir);
  execSync(\`git symbolic-ref HEAD refs/heads/main\`, { cwd: dir, stdio: 'ignore' });
}

export async function createTgpConfig(workDir: string, remoteRepo: string, fileName: string = 'tgp.config.ts'): Promise<string> {
    const rootDir = path.join(workDir, '.tgp').split(path.sep).join('/');
    const remotePath = remoteRepo.split(path.sep).join('/');
    const allowedDir = workDir.split(path.sep).join('/');

    // OVERRIDE: Use the package name directly for imports
    const configContent = \`
import { defineTGPConfig } from 'tool-generation-protocol';

export default defineTGPConfig({
  rootDir: '\${rootDir}',
  git: {
    provider: 'local',
    repo: '\${remotePath}',
    branch: 'main',
    auth: { token: 'mock', user: 'test', email: 'test@example.com' }
  },
  fs: {
    allowedDirs: ['\${allowedDir}', '\${os.tmpdir().split(path.sep).join('/')}'],
    blockUpwardTraversal: false
  },
  allowedImports: ['zod', 'date-fns']
});
\`;
    const configPath = path.join(workDir, fileName);
    await fs.writeFile(configPath, configContent);
    return configPath;
}

export function runTgpCli(args: string[], cwd: string): Promise<{ stdout: string, stderr: string, code: number }> {
    return new Promise(async (resolve) => {
        // OVERRIDE: Use bunx tgp to execute the installed binary
        const proc = spawn('bunx', ['tgp', ...args], {
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

process.on('exit', () => {
    tempDirs.forEach(d => {
        try { execSync(\`rm -rf \${d}\`); } catch {}
    });
});
`;

describe('Docker: NPM Compatibility', () => {
  let tarballPath: string;
  let container: Container;
  
  // High timeout for Docker operations
  const TIMEOUT = 120000; 

  beforeAll(async () => {
    // 1. Build the Tarball from source
    console.log('[Docker] Building NPM Tarball...');
    tarballPath = await createTarball(projectRoot);
    console.log(`[Docker] Tarball created at: ${tarballPath}`);
  });

  beforeEach(async () => {
    // 2. Start a fresh container
    container = new Container('oven/bun:1');
    await container.start();
    console.log(`[Docker] Container started: ${container.id}`);
  });

  afterEach(async () => {
    if (container) await container.stop();
  });

  afterAll(async () => {
    // Cleanup the local tarball
    if (tarballPath) await fs.rm(tarballPath, { force: true });
  });

  it('installs and runs E2E scenarios correctly', async () => {
    // 3. Prepare Environment inside Container
    console.log('[Docker] Installing dependencies (git)...');
    await container.exec(['apt-get', 'update']);
    await container.exec(['apt-get', 'install', '-y', 'git']);
    
    // Configure Git (required for TGP tests)
    await container.exec(['git', 'config', '--global', 'user.email', 'test@example.com']);
    await container.exec(['git', 'config', '--global', 'user.name', 'Test User']);

    // 4. Setup Test Project
    await container.exec(['mkdir', '-p', '/app']);
    
    // Copy tarball
    console.log('[Docker] Copying artifacts...');
    await container.cp(tarballPath, '/app/tgp.tgz');
    
    // Copy tests (We only copy e2e as those are the consumer-facing tests)
    await container.exec(['mkdir', '-p', '/app/test']);
    await container.cp(path.join(projectRoot, 'test/e2e'), '/app/test/e2e');

    // Initialize Project & Install Package
    console.log('[Docker] Installing package...');
    await container.exec(['bun', 'init', '-y'], { cwd: '/app' });
    await container.exec(['bun', 'add', './tgp.tgz'], { cwd: '/app' });
    // Install dev dependencies needed for the tests themselves
    await container.exec(['bun', 'add', '-d', 'bun-types'], { cwd: '/app' });

    // 5. Patch Test Files
    console.log('[Docker] Patching tests to use installed package...');
    
    // Inject the Utils Override
    const utilsOverridePath = path.join(os.tmpdir(), 'utils_override.ts');
    await fs.writeFile(utilsOverridePath, CONTAINER_UTILS_TS);
    await container.cp(utilsOverridePath, '/app/test/e2e/utils.ts');
    
    // Patch scenarios.test.ts to import from 'tool-generation-protocol' instead of relative paths
    // Regex matches ../../src/... paths
    const sedCmd = `sed -i "s|\\.\\./\\.\\./src/[a-zA-Z0-9/._-]*|tool-generation-protocol|g" /app/test/e2e/scenarios.test.ts`;
    await container.exec(['bash', '-c', sedCmd]);

    // 6. Run Tests
    console.log('[Docker] Running Tests...');
    const res = await container.exec(['bun', 'test', 'test/e2e/scenarios.test.ts'], { cwd: '/app' });
    
    if (res.exitCode !== 0) {
        console.error('STDOUT:', res.stdout);
        console.error('STDERR:', res.stderr);
    }

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('passed');
  }, TIMEOUT);
});