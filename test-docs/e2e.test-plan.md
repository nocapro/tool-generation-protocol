# End-to-End Test Plan (Real Implementation)

**Rules:**
1.  **Full Stack**: Tests run against the built `bin/tgp.js` or the public API entry point.
2.  **Persistence**: Verification involves killing the process and starting a new one to ensure state matches.

## 1. The "Cold Start" Agent Scenario
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

## 2. The "Refactor" Scenario (Search & Replace)
**Story**: An existing tool is broken/outdated. Agent must patch it.

1.  **Pre-condition**: `tools/legacy.ts` exists with `console.log("old")`.
2.  **Agent Action**:
    -   Agent reads file.
    -   Agent calls `patch_file('tools/legacy.ts', ...)` to replace `console.log` with `return`.
3.  **Verification**:
    -   Run `exec_tool`.
    -   **Assert**: Output is returned value, not undefined.
    -   Read file from disk. **Assert**: Content is updated.

## 3. The "Infinite Loop" Self-Defense
**Story**: Agent generates malicious/buggy code that freezes.

1.  **Action**: Agent creates `tools/freeze.ts` (`while(true){}`).
2.  **Execution**: Agent calls `exec_tool('tools/freeze.ts')`.
3.  **Observation**:
    -   Function call throws exception.
    -   Exception is caught.
    -   **Assert**: Main process (The Agent) remains alive and responsive.
    -   **Assert**: Memory usage of Main process is stable (V8 isolate disposed).

## 4. The "SIGTERM" Cleanliness Test
**Story**: Deployment platform kills the pod while tool is running.

1.  **Setup**:
    -   Start TGP process that writes to a database loop.
2.  **Action**:
    -   Send `SIGTERM` to process.
3.  **Verification**:
    -   Check Database locks. **Assert**: Released.
    -   Check Temporary Files (`/tmp/tgp-*`). **Assert**: Deleted/Cleaned up.
    -   Check Git Lock files (`index.lock`). **Assert**: Cleared.

## 5. CLI Bootstrap Test
**Story**: Developer initializes project.

1.  **Action**: Exec `node bin/tgp.js init` in empty dir.
2.  **Assert**:
    -   `tgp.config.ts` created.
    -   `.tgp` folder structure created.
    -   `package.json` updated (if applicable).