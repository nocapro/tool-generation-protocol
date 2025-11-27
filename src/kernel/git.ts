/* eslint-disable no-console */
import * as git from 'isomorphic-git';
import * as http from 'isomorphic-git/http/node';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGitBackend(fs: any, config: TGPConfig): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy } = config.git;

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
      // 1. Add files
      for (const filepath of filesToAdd) {
        try {
           // check if file exists before adding (might be deleted, though not in this context)
           await git.add({ ...gitOpts, filepath });
        } catch (e) {
           // If file doesn't exist, maybe it was a deletion? 
           // For TGP v1 we assume add/update.
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
      if (writeStrategy === 'direct') {
        console.log(`[TGP] Pushing to ${branch}...`);
        await git.push({
          ...gitOpts,
          remote: 'origin',
          ref: branch,
        });
      } else {
        // TODO: Implement PR creation logic for 'pr' strategy
        console.warn(`[TGP] PR Strategy not yet implemented. Changes committed locally.`);
      }
    }
  };
}