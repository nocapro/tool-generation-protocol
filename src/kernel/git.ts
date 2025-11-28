 
import * as git from 'isomorphic-git';
import { TGPConfig, Logger } from '../types.js';
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
export function createGitBackend(deps: GitDependencies, config: TGPConfig, logger: Logger): GitBackend {
  const dir = config.rootDir;
  const { repo, auth, branch, writeStrategy, apiBaseUrl } = config.git;
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

      const createPullRequest = async () => {
        const [owner, repoName] = repo.split('/');
        const url = new URL(`/repos/${owner}/${repoName}/pulls`, apiBaseUrl).href;
        
        logger.info(`Creating Pull Request on ${repo}...`);

        try {
          // We use native fetch here, which is available in modern Node.
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `token ${auth.token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: message,
              head: targetBranch,
              base: branch,
              body: `Forged by TGP.\nCommit Message: ${message}`,
            }),
          });
          
          const result = await response.json();
          if (response.ok) {
            logger.info(`Successfully created Pull Request: ${result.html_url}`);
          } else if (response.status === 422) { // Unprocessable Entity - often means PR exists
            logger.warn(`Could not create PR (it may already exist): ${JSON.stringify(result.errors)}`);
          }
        } catch (e) {
          logger.error('Failed to create pull request via API.', e);
        }
      };

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
          await createPullRequest();
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
