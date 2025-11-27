/* eslint-disable no-console */
import * as git from 'isomorphic-git';
import { TGPConfig } from '../types.js';
import * as path from 'path';

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

interface GitWriteStrategy {
  persist(message: string, files: string[]): Promise<void>;
}

export function createGitBackend(deps: GitDependencies, config: TGPConfig): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy } = config.git;
  const { fs, http } = deps;

  // Helper to configure git options
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

  // --- Strategies ---

  const directStrategy: GitWriteStrategy = {
    async persist(message: string, filesToAdd: string[]) {
      // 1. Add files
      for (const filepath of filesToAdd) {
        try {
           // check if file exists before adding
           await git.add({ ...gitOpts, filepath });
        } catch (e) {
           console.warn(`[TGP] Git Add failed for ${filepath}`, e);
        }
      }

      // 2. Commit
      const sha = await git.commit({
        ...gitOpts,
        message,
        author,
      });
      console.log(`[TGP] Committed ${sha.slice(0, 7)}: ${message}`);

      // 3. Push
      console.log(`[TGP] Pushing to ${branch}...`);
      await git.push({
        ...gitOpts,
        remote: 'origin',
        ref: branch,
      });
    }
  };

  const prStrategy: GitWriteStrategy = {
    async persist(message: string, files: string[]) {
      // TODO: Implement PR creation logic for 'pr' strategy using Octokit or similar
      console.warn(`[TGP] 'pr' Strategy selected but not implemented. Falling back to local commit only.`);
      // We reuse the commit logic from direct strategy but skip push for now, or just warn.
      // Ideally, this creates a branch, pushes that branch, and opens a PR.
      await directStrategy.persist(message, files).catch(e => console.error("PR fallback failed", e));
    }
  };

  return {
    async hydrate() {
      // 1. Check if repo exists locally
      const gitDirExists = (await fs.promises.stat(path.join(dir, '.git'))
        .then(() => true)
        .catch(() => false)) as boolean;

      if (!gitDirExists) {
        // Clone
        console.log(`[TGP] Cloning ${repo} into ${dir}...`);
        await git.clone({
          ...gitOpts,
          url: `https://github.com/${repo}.git`,
          ref: branch,
          singleBranch: true,
          depth: 1,
        });
      } else {
        // Pull
        console.log(`[TGP] Pulling latest from ${repo}...`);
        await git.pull({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
          singleBranch: true,
          author,
        });
      }
    },

    async persist(message: string, filesToAdd: string[]) {
      if (writeStrategy === 'direct') {
        return directStrategy.persist(message, filesToAdd);
      } else if (writeStrategy === 'pr') {
        return prStrategy.persist(message, filesToAdd);
      } else {
        console.warn(`[TGP] Unknown write strategy: ${writeStrategy}. Defaulting to direct.`);
        return directStrategy.persist(message, filesToAdd);
      }
    }
  };
}