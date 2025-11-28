import { spawn, spawnSync, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Creates an NPM tarball from the current project directory.
 * Ensures a fresh build is present before packing.
 * Returns the absolute path to the generated .tgz file.
 */
export async function createTarball(cwd: string): Promise<string> {
  // Ensure we have a clean build. 'npm pack' relies on the presence of dist/ 
  // if 'dist' is in the 'files' list in package.json.
  try {
      // Use 'inherit' so we see the build output
      execSync('npm run build', { cwd, stdio: 'inherit' });
  } catch (e) {
      throw new Error('Build failed before packing');
  }

  const res = spawnSync('npm', ['pack'], { cwd, encoding: 'utf-8' });
  
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`npm pack failed: ${res.stderr}`);
  
  // npm pack outputs the filename on stdout (e.g., tool-generation-protocol-0.0.1.tgz)
  const filename = res.stdout.trim().split('\n').pop()?.trim();
  if (!filename) throw new Error('Could not determine tarball filename from npm pack output');
  
  return path.resolve(cwd, filename);
}

/**
 * A simple wrapper around Docker CLI to manage a test container.
 */
export class Container {
  id: string | null = null;

  constructor(public image: string) {}

  /**
   * Ensures the image exists locally. If not, pulls it with visibility.
   */
  async ensureImage(): Promise<void> {
    const inspect = spawnSync('docker', ['inspect', '--type=image', this.image], { stdio: 'ignore' });
    if (inspect.status === 0) return; // Image exists

    console.log(`[Docker] Pulling image ${this.image}... (this may take a while)`);
    // Use inherit to show progress bars
    const pull = spawnSync('docker', ['pull', this.image], { stdio: 'inherit' });
    if (pull.status !== 0) {
      throw new Error(`Failed to pull image ${this.image}`);
    }
  }

  /**
   * Starts the container in detached mode with TTY to keep it alive.
   */
  async start(): Promise<void> {
    await this.ensureImage();

    const res = spawnSync('docker', ['run', '-d', '--rm', '-t', this.image, 'bash'], { encoding: 'utf-8' });
    if (res.status !== 0) {
        throw new Error(`Failed to start container: ${res.stderr}`);
    }
    this.id = res.stdout.trim();
  }

  /**
   * Executes a command inside the container.
   */
  async exec(cmd: string[], opts: { cwd?: string, env?: Record<string, string> } = {}): Promise<{ stdout: string, stderr: string, exitCode: number }> {
    if (!this.id) throw new Error('Container not started');
    
    const args = ['exec'];
    if (opts.cwd) {
        args.push('-w', opts.cwd);
    }
    if (opts.env) {
        for (const [k, v] of Object.entries(opts.env)) {
            args.push('-e', `${k}=${v}`);
        }
    }
    args.push(this.id);
    args.push(...cmd);

    return new Promise((resolve, reject) => {
        const proc = spawn('docker', args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', (code) => {
            resolve({ stdout, stderr, exitCode: code ?? -1 });
        });
        
        proc.on('error', (err) => reject(err));
    });
  }

  /**
   * Copies a file or directory from the host to the container.
   */
  async cp(src: string, dest: string): Promise<void> {
      if (!this.id) throw new Error('Container not started');
      try {
          execSync(`docker cp "${src}" "${this.id}:${dest}"`);
      } catch (e: any) {
          throw new Error(`Failed to copy ${src} to ${dest}: ${e.message}`);
      }
  }

  /**
   * Stops the container (which auto-removes it due to --rm).
   */
  async stop(): Promise<void> {
    if (this.id) {
        try {
            execSync(`docker stop -t 0 ${this.id}`, { stdio: 'ignore' });
        } catch {}
        this.id = null;
    }
  }
}