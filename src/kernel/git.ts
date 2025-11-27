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

/**
 * Strategy interface for persisting changes to the upstream repository.
 */
interface GitWriteStrategy {
  persist(message: string, files: string[]): Promise<void>;
}

/**
 * Factory to create the Git Backend based on configuration.
 */
export function createGitBackend(deps: GitDependencies, config: TGPConfig): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy } = config.git;
  const { fs, http } = deps;

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
           console.warn(`[TGP] Git Add failed for ${filepath}`, e);
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
        console.log(`[TGP] Committed ${sha.slice(0, 7)}: ${message}`);

        // 3. Push
        console.log(`[TGP] Pushing to ${branch}...`);
        await git.push({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
        });
      } catch (e) {
        console.error(`[TGP] Git Commit/Push failed:`, e);
        throw new Error(`Failed to persist changes to Git: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  const prStrategy: GitWriteStrategy = {
    async persist(message: string, files: string[]) {
      // TODO: Implement PR creation logic for 'pr' strategy using Octokit or similar.
      // For now, we fallback to direct commit but without push (or simulate it), 
      // OR we just warn and do nothing to prevent unauthorized pushes in prod.
      
      console.warn(`[TGP] 'pr' Strategy selected but not fully implemented. Committing locally.`);
      
      // We reuse the add/commit logic but skip the push
      if (files.length === 0) return;

      for (const filepath of files) {
        await git.add({ ...gitOpts, filepath }).catch(e => console.warn(`[TGP] Git Add failed ${filepath}`, e));
      }

      await git.commit({
        ...gitOpts,
        message: `[PR-Draft] ${message}`,
        author,
      });
      
      console.log(`[TGP] Changes committed locally. PR logic pending.`);
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
      } catch (error) {
        console.error(`[TGP] Git Hydration Failed:`, error);
        // We might want to throw here to stop boot, but for now we log.
        throw error;
      }
    },

    async persist(message: string, filesToAdd: string[]) {
      return strategy.persist(message, filesToAdd);
    }
  };
}
