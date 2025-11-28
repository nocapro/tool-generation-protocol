import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTempDir, createTgpConfig, cleanupDir, initBareRepo } from '../e2e/utils.js';
import { TGP } from '../../src/tgp.js';
import { tgpTools, createSqlTools } from '../../src/tools/index.js';

describe('Integration: SQL Adapter (Real SQLite)', () => {
  let tempDir: string;
  let remoteRepo: string;
  let db: Database.Database;

  beforeEach(async () => {
    tempDir = await createTempDir('tgp-int-sql-');
    remoteRepo = await createTempDir('tgp-remote-');
    await initBareRepo(remoteRepo);
    
    // Setup Real SQLite DB (In-memory for speed/isolation)
    db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    db.exec("INSERT INTO users (name) VALUES ('Alice')");
    db.exec("INSERT INTO users (name) VALUES ('Bob')");
  });

  afterEach(async () => {
    db.close();
    await cleanupDir(tempDir);
    await cleanupDir(remoteRepo);
  });

  it('Query Execution: Tool can query real database', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    
    // Executor that bridges TGP -> Real DB
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = async (sql: string, params: any[]) => {
      const stmt = db.prepare(sql);
      if (sql.trim().toLowerCase().startsWith('select')) {
        return stmt.all(params);
      }
      return stmt.run(params);
    };

    const kernel = new TGP({ 
      configFile: configPath,
      sandboxAPI: { exec_sql: executor } // Inject for internal usage if needed
    });
    await kernel.boot();

    // Compose tools
    const tools = { ...tgpTools(kernel), ...createSqlTools(executor) };

    const toolName = 'tools/get_users.ts';
    await tools.write_file.execute({
      path: toolName,
      content: `
        export default async function() {
          return await tgp.exec_sql('SELECT name FROM users ORDER BY name', []);
        }
      `
    });

    const res = await tools.exec_tool.execute({ path: toolName, args: {} });
    
    expect(res.success).toBe(true);
    expect(res.result).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });

  it('Transaction Rollback: Host can rollback if tool throws', async () => {
    const configPath = await createTgpConfig(tempDir, remoteRepo);
    
    // Executor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const executor = async (sql: string, params: any[]) => {
      return db.prepare(sql).run(params);
    };

    const kernel = new TGP({ configFile: configPath });
    await kernel.boot();
    const tools = { ...tgpTools(kernel), ...createSqlTools(executor) };

    // Create a buggy tool that writes then crashes
    const buggyTool = 'tools/buggy_insert.ts';
    await tools.write_file.execute({
      path: buggyTool,
      content: `
        export default async function() {
           // 1. Write
           await tgp.exec_sql("INSERT INTO users (name) VALUES ('Charlie')", []);
           // 2. Crash
           throw new Error('Logic Bomb');
        }
      `
    });

    // Emulate Host Application Transaction Wrapper
    // Since better-sqlite3 is synchronous, we manage transaction via raw SQL commands
    // surrounding the async tool execution.
    
    db.exec('BEGIN');
    let errorCaught = false;
    
    try {
      const res = await tools.exec_tool.execute({ path: buggyTool, args: {} });
      if (!res.success) {
        throw new Error(res.error);
      }
      db.exec('COMMIT');
    } catch (e) {
      errorCaught = true;
      db.exec('ROLLBACK');
    }

    expect(errorCaught).toBe(true);

    // Verify 'Charlie' was NOT added
    const rows = db.prepare('SELECT * FROM users WHERE name = ?').all('Charlie');
    expect(rows.length).toBe(0);
    
    // Verify existing data remains
    const count = db.prepare('SELECT count(*) as c FROM users').get() as { c: number };
    expect(count.c).toBe(2);
  });
});