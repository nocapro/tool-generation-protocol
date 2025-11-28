import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM Polyfills
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

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
  // Set default branch to main to avoid 'master' vs 'main' confusion
  execSync(`git symbolic-ref HEAD refs/heads/main`, { cwd: dir, stdio: 'ignore' });
}

/**
 * Generates a tgp.config.ts file in the test directory pointing to the local bare repo.
 * We use an absolute path for rootDir to ensure tests don't pollute the project root.
 */
export async function createTgpConfig(workDir: string, remoteRepo: string, fileName: string = 'tgp.config.ts'): Promise<string> {
    const rootDir = path.join(workDir, '.tgp').split(path.sep).join('/');
    const remotePath = remoteRepo.split(path.sep).join('/');
    const allowedDir = workDir.split(path.sep).join('/');

    const configModulePath = path.join(projectRoot, 'src/config.ts').split(path.sep).join('/');

    const configContent = `
import { defineTGPConfig } from '${configModulePath}';

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
        const tgpBin = path.resolve(__dirname, '../../bin/tgp.js');
        
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