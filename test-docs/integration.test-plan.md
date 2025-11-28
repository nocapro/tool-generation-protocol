# Integration Test Plan (Real Implementation)

**Rules:**
1.  **Git**: Use local "bare" repositories to simulate remotes.
2.  **Database**: Use local SQLite file or ephemeral Docker container for SQL tests.

## 1. GitOps & Persistence
**Target**: `src/kernel/git.ts`
**Setup**:
1.  Create `REMOTE_DIR` (init bare repo).
2.  Create `AGENT_DIR` (configured as TGP root).

- [ ] **Hydration (Clone/Pull)**
    - [ ] Commit a tool `tools/hello.ts` to `REMOTE_DIR` using standard `git` CLI commands.
    - [ ] Initialize `TGP Kernel` in `AGENT_DIR`.
    - [ ] **Assert**: `tools/hello.ts` exists in `AGENT_DIR` and is readable.
- [ ] **Fabrication (Commit/Push)**
    - [ ] Use Kernel to write `tools/new.ts` in `AGENT_DIR`.
    - [ ] Trigger Kernel persistence (sync).
    - [ ] Verify in `REMOTE_DIR` (using `git log`) that a new commit exists with the expected message.
- [ ] **Concurrency (Locking)**
    - [ ] Instantiate **two** Kernels pointing to the same `REMOTE_DIR` but different local dirs.
    - [ ] Agent A writes `toolA.ts`. Agent B writes `toolB.ts`.
    - [ ] Both sync simultaneously.
    - [ ] **Assert**: `REMOTE_DIR` contains both files. No merge conflicts (assuming distinct files).

## 2. Kernel <-> Sandbox Bridge
**Target**: `src/sandbox/bridge.ts`

- [ ] **Host Filesystem Access**
    - [ ] Create file `data.json` in Host VFS.
    - [ ] Create tool that uses `tgp.read_file('data.json')`.
    - [ ] Execute tool.
    - [ ] **Assert**: Tool returns parsed JSON.
- [ ] **Recursive Tool Execution**
    - [ ] Create `tools/multiplier.ts` (returns `a * b`).
    - [ ] Create `tools/calculator.ts` that imports/calls `multiplier`.
    - [ ] Execute `calculator`.
    - [ ] **Assert**: Returns correct result. Verifies internal module resolution works in V8.

## 3. SQL Adapter (Real SQLite)
**Target**: `src/tools/sql.ts`
**Setup**: Create `test.db` (SQLite). Run migration to create table `users`.

- [ ] **Query Execution**
    - [ ] Tool executes `SELECT * FROM users`.
    - [ ] **Assert**: Returns real rows.
- [ ] **Transaction Rollback**
    - [ ] Tool executes:
        1. `INSERT INTO users ...`
        2. `throw new Error('Boom')`
    - [ ] Catch error in test.
    - [ ] Query `users` table.
    - [ ] **Assert**: Count is 0 (Rollback successful).