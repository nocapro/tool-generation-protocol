 
import * as git from 'isomorphic-git';
import { TGPConfig, Logger } from '../types.js';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * The Git Interface required by the Kernel.
 * We rely on the 'fs' interface compatible with isomorphic-git.
 */
export interface GitBackend {
  hydrate(): Promise<void>;
  persist(message: string, files: string[]): Promise<void>;
}

export interface GitDependencies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fs: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  http: any;
}

/**
 * Strategy interface for persisting changes to the upstream repository.
 */
interface GitWriteStrategy {
  persist(message: string, files: string[]): Promise<void>;
}

/**
 * Adapter interface for Git Hosting Platforms.
 * Handles platform-specific API calls like creating Pull Requests.
 */
interface GitPlatformAdapter {
  createPullRequest(opts: {
    title: string;
    branch: string;
    base: string;
    body: string;
  }): Promise<void>;
}

class GitHubAdapter implements GitPlatformAdapter {
  constructor(
    private repo: string,
    private token: string,
    private apiBaseUrl: string,
    private logger: Logger
  ) {}

  async createPullRequest(opts: { title: string; branch: string; base: string; body: string }): Promise<void> {
    const [owner, repoName] = this.repo.split('/');
    const url = new URL(`/repos/${owner}/${repoName}/pulls`, this.apiBaseUrl).href;

    this.logger.info(`Creating Pull Request on ${this.repo}...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: opts.title,
          head: opts.branch,
          base: opts.base,
          body: opts.body,
        }),
      });

      const result = await response.json();
      if (response.ok) {
        this.logger.info(`Successfully created Pull Request: ${result.html_url}`);
      } else if (response.status === 422) {
        this.logger.warn(`Could not create PR (it may already exist): ${JSON.stringify(result.errors)}`);
      } else {
        this.logger.error(`GitHub API Error: ${response.status} ${response.statusText}`, result);
      }
    } catch (e) {
      this.logger.error('Failed to create pull request via API.', e);
      throw e;
    }
  }
}

class NotImplementedAdapter implements GitPlatformAdapter {
  constructor(private provider: string) {}
  async createPullRequest(): Promise<void> {
    throw new Error(`Git Provider '${this.provider}' is not yet implemented.`);
  }
}

// --- Local Git Implementation (Shell-based) ---
// Used for E2E testing and Air-gapped environments
async function execGit(args: string[], cwd: string, logger: Logger): Promise<void> {
  logger.debug(`[Local] Executing: git ${args.join(' ')} in ${cwd}`);
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: 'pipe' });
    let output = '';
    proc.stdout.on('data', d => output += d.toString());
    proc.stderr.on('data', d => output += d.toString());
    
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Git command failed: git ${args.join(' ')} in ${cwd}\nOutput: ${output}`));
    });
  });
}

function createLocalGitBackend(config: TGPConfig, logger: Logger): GitBackend {
  const dir = config.rootDir;
  const { repo, branch } = config.git;

  return {
    async hydrate() {
      const fs = await import('node:fs/promises');
      const gitDirExists = await fs.stat(path.join(dir, '.git')).then(() => true).catch(() => false);
      
      if (!gitDirExists) {
        logger.info(`[Local] Cloning ${repo} into ${dir}...`);
        await fs.mkdir(path.dirname(dir), { recursive: true });
        // Clone needs to happen in parent dir
        // We assume 'repo' is an absolute path to a bare repo
        await execGit(['clone', repo, path.basename(dir)], path.dirname(dir), logger);
        
        // Ensure we are on correct branch
        try {
            await execGit(['checkout', branch], dir, logger);
        } catch {
            logger.warn(`[Local] Failed to checkout ${branch}, assuming default.`);
        }
      } else {
        logger.info(`[Local] Pulling latest from ${repo}...`);
        await execGit(['pull', 'origin', branch], dir, logger);
      }
    },

    async persist(message: string, files: string[]) {
      if (files.length === 0) return;
      logger.info(`[Local] Persisting ${files.length} files...`);
      
      for (const f of files) {
        await execGit(['add', f], dir, logger);
      }
      
      try {
        await execGit(['commit', '-m', message], dir, logger);
      } catch(e) {
         // Commit might fail if no changes
         logger.warn(`[Local] Commit failed (empty?):`, String(e));
         return;
      }

      try {
          await execGit(['push', 'origin', branch], dir, logger);
      } catch (_e) {
          // Handle non-fast-forward by pulling first (simple auto-merge)
          logger.warn(`[Local] Push failed. Attempting merge...`);
          // We use standard merge (no-rebase) as it handles 'meta.json' append conflicts slightly better 
          // in automated scenarios than rebase, which can get stuck.
          await execGit(['pull', '--no-rebase', 'origin', branch], dir, logger);
          await execGit(['push', 'origin', branch], dir, logger);
      }
    }
  };
}

/**
 * Factory to create the Git Backend based on configuration.
 */
export function createGitBackend(deps: GitDependencies, config: TGPConfig, logger: Logger): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy, apiBaseUrl, provider } = config.git;
  const { fs, http } = deps;

  if (provider === 'local') {
    return createLocalGitBackend(config, logger);
  }

  // Configuration for isomorphic-git
  const gitOpts = {
    fs,
    dir,
    http,
    onAuth: () => ({ username: auth.token }),
  };

  const author = {
    name: auth.user,
    email: auth.email,
  };

  // Select Platform Adapter
  let platformAdapter: GitPlatformAdapter;
  if (provider === 'github') {
    platformAdapter = new GitHubAdapter(repo, auth.token, apiBaseUrl, logger);
  } else {
    platformAdapter = new NotImplementedAdapter(provider);
  }

  // --- Strategy Implementations ---

  const directStrategy: GitWriteStrategy = {
    async persist(message: string, filesToAdd: string[]) {
      if (filesToAdd.length === 0) return;

      // 1. Add files
      for (const filepath of filesToAdd) {
        try {
           // check if file exists before adding
           await git.add({ ...gitOpts, filepath });
        } catch (e) {
           logger.warn(`Git Add failed for ${filepath}`, e);
           throw new Error(`Failed to stage file ${filepath}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      try {
        // 2. Commit
        const sha = await git.commit({
          ...gitOpts,
          message,
          author,
        });
        logger.info(`Committed ${sha.slice(0, 7)}: ${message}`);

        // 3. Push
        logger.info(`Pushing to ${branch}...`);
        await git.push({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
        });
      } catch (e) {
        logger.error(`Git Commit/Push failed:`, e);
        throw new Error(`Failed to persist changes to Git: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const prStrategy: GitWriteStrategy = {
    async persist(message: string, files: string[]) {
      if (files.length === 0) return;
      
      // 1. Get current branch
      const currentBranch = await git.currentBranch({ ...gitOpts }) ?? 'HEAD';
      
      // 2. If we are on the protected branch (main/master), we must fork
      let targetBranch = currentBranch;
      
      if (currentBranch === branch) {
         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
         // Sanitize message for branch name
         const safeMsg = message.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 30);
         targetBranch = `tgp/feat-${timestamp}-${safeMsg}`;
         
         logger.info(`Switching to new branch: ${targetBranch}`);
         
         await git.branch({ ...gitOpts, ref: targetBranch });
         await git.checkout({ ...gitOpts, ref: targetBranch });
      } else {
         logger.info(`Already on feature branch: ${targetBranch}`);
      }

      for (const filepath of files) {
        await git.add({ ...gitOpts, filepath }).catch(e => logger.warn(`Git Add failed ${filepath}`, e));
      }

      await git.commit({
        ...gitOpts,
        message: message,
        author,
      });
      
      logger.info(`Changes committed to ${targetBranch}.`);
      
      // Try to push the feature branch if auth is present
      try {
          await git.push({
            ...gitOpts,
            remote: 'origin',
            ref: targetBranch,
          });
          logger.info(`Pushed ${targetBranch} to origin.`);
          await platformAdapter.createPullRequest({
            title: message,
            branch: targetBranch,
            base: branch,
            body: `Forged by TGP.\nCommit Message: ${message}`,
          });
      } catch (e) {
          logger.warn(`Failed to push feature branch. Changes are local only.`, e);
      }
    }
  };

  // Select Strategy
  const strategy = writeStrategy === 'pr' ? prStrategy : directStrategy;

  return {
    async hydrate() {
      try {
        // 1. Check if repo exists locally
        const gitDirExists = (await fs.promises.stat(path.join(dir, '.git'))
          .then(() => true)
          .catch(() => false)) as boolean;

        if (!gitDirExists) {
          // Clone
          logger.info(`Cloning ${repo} into ${dir}...`);
          await git.clone({
            ...gitOpts,
            url: `https://github.com/${repo}.git`,
            ref: branch,
            singleBranch: true,
            depth: 1,
          });
        } else {
          // Pull
          logger.info(`Pulling latest from ${repo}...`);
          await git.pull({
            ...gitOpts,
            remote: 'origin',
            ref: branch,
            singleBranch: true,
            author,
          });
        }
      } catch (error) {
        logger.error(`Git Hydration Failed:`, error);
        // Fail fast: The agent cannot operate without a consistent filesystem state.
        throw error;
      }
    },

    async persist(message: string, filesToAdd: string[]) {
      return strategy.persist(message, filesToAdd);
    }
  };
}
