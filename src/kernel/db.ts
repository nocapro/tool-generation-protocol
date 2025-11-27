/* eslint-disable no-console */
import { TGPConfig } from '../types.js';

/**
 * The Database Kernel Interface.
 * 
 * TGP guarantees that all tool executions happen within a transaction.
 * If the tool throws, the transaction is rolled back.
 */
export interface DBBackend {
  /**
   * Executes a raw SQL query.
   * @param sql The SQL query string.
   * @param params Parameter substitutions.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<any[]>;

  /**
   * Wraps a function in a database transaction.
   * @param fn The function to execute. It receives a transactional DB instance.
   */
  transaction<T>(fn: (trx: DBBackend) => Promise<T>): Promise<T>;
}

/**
 * Factory to create the Database Backend based on configuration.
 * Loads the appropriate driver or falls back to NoOp.
 */
export function createDBBackend(config: TGPConfig): DBBackend {
  const dbConfig = config.db;

  if (dbConfig) {
    // In a real implementation, we would perform a dynamic import here based on the dialect.
    // e.g. if (dbConfig.dialect === 'postgres') return new PostgresBackend(dbConfig);
    
    if (dbConfig.dialect === 'postgres' || dbConfig.dialect === 'mysql' || dbConfig.dialect === 'sqlite' || dbConfig.dialect === 'libsql') {
       console.warn(`[TGP-DB] Dialect '${dbConfig.dialect}' configured. NoOp driver active (Drivers not bundled in Core).`);
    } else {
      throw new Error(`[TGP-DB] Unsupported dialect: ${dbConfig.dialect}`);
    }
  }

  return createNoOpDB();
}

/**
 * A No-Op Database Backend used when no DB is configured.
 * It logs operations to the console to verify behavior.
 */
export function createNoOpDB(): DBBackend {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query(sql: string, params: any[] = []) {
      console.log(`[TGP-DB] Query: ${sql}`, params);
      return [];
    },

    async transaction<T>(fn: (trx: DBBackend) => Promise<T>): Promise<T> {
      console.log(`[TGP-DB] Begin Transaction`);
      try {
        // In a real DB, we would start a trx here.
        // We pass 'this' as the transactional client (NoOp doesn't distinguish)
        const result = await fn(this);
        console.log(`[TGP-DB] Commit Transaction`);
        return result;
      } catch (err) {
        console.log(`[TGP-DB] Rollback Transaction`);
        throw err;
      }
    }
  };
}