import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const tempDirs: string[] = [];

/**
 * Creates a unique temporary directory for a unit test.
 * Registers it for auto-cleanup.
 */
export async function createTempDir(prefix: string = 'tgp-unit-'): Promise<string> {
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

function cleanupAll() {
    tempDirs.forEach(d => {
        try { execSync(`rm -rf ${d}`); } catch {}
    });
}

// Ensure cleanup on various exit conditions
process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(1); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(1); });