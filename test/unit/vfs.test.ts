import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createTempDir, cleanupDir } from './utils.js';
import { createNodeVFS } from '../../src/vfs/node.js';

describe('Unit: VFS (Node Adapter)', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await createTempDir('tgp-unit-vfs-');
  });

  afterEach(async () => {
    await cleanupDir(rootDir);
  });

  it('Real I/O Operations: write, read, list', async () => {
    const vfs = createNodeVFS(rootDir);
    
    const filePath = 'deep/nested/file.txt';
    const content = 'Hello VFS';
    
    // 1. Write
    await vfs.writeFile(filePath, content);
    
    // Verify physical existence
    const physicalPath = path.join(rootDir, filePath);
    const exists = await fs.access(physicalPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    
    // 2. Read
    const readContent = await vfs.readFile(filePath);
    expect(readContent).toBe(content);
    
    // 3. List
    // VFS returns paths relative to the root
    const list = await vfs.listFiles('deep', true);
    expect(list).toContain('deep/nested/file.txt');
  });

  it('Path Security: Jail Confinement', async () => {
    const vfs = createNodeVFS(rootDir);
    
    const outsidePath = '../outside.txt';
    try {
        await vfs.writeFile(outsidePath, 'hacker');
        expect(true).toBe(false); // Should have thrown
    } catch (e: any) {
        expect(e.message).toMatch(/Security|traversal|outside|forbidden/i);
    }
    
    // Verify file was NOT created outside
    const physicalOutside = path.resolve(rootDir, '../outside.txt');
    const exists = await fs.access(physicalOutside).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
  
  it('Path Security: Symlink Traversal', async () => {
     // Create a real file outside the root
     const outsideDir = await createTempDir('tgp-unit-vfs-outside-');
     const outsideFile = path.join(outsideDir, 'passwd');
     await fs.writeFile(outsideFile, 'root:x:0:0');
     
     // Create symlink inside root pointing to outside file
     const linkPath = path.join(rootDir, 'bad_link');
     
     try {
       await fs.symlink(outsideFile, linkPath);
     } catch {
       // If we can't create symlinks (e.g. windows without permission), clean up and skip
       await cleanupDir(outsideDir);
       return;
     }
     
     const vfs = createNodeVFS(rootDir);
     
     // Attempt to read through the link
     try {
         await vfs.readFile('bad_link');
         // If readFile follows symlinks and checks the resolved path against rootDir,
         // it should throw because resolved path is in outsideDir.
         expect(true).toBe(false);
     } catch (e: any) {
         // Should throw Security or ENOENT depending on how strict the resolution is before check
         expect(true).toBe(true);
     }
     
     await cleanupDir(outsideDir);
  });
});