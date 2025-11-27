/* eslint-disable no-console */
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