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