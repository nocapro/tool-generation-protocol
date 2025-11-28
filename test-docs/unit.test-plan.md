# Unit Test Plan (Real Implementation)

**Rules:**
1.  **No Mock, No Spy**: Use real file systems (node:fs), real V8 isolates (isolated-vm).
2.  **Real Implementation**: Verify logic by observing real output/exceptions.
3.  **Isolated**: Each test suite creates a unique temporary directory (`/tmp/tgp-unit-${uuid}`).
4.  **Idempotent**: No shared global state between tests.
5.  **Clean on SIGTERM**: Register `process.on('SIGTERM')` handlers to wipe temp dirs.

## 1. VFS (Virtual Filesystem) - Node Adapter
**Target**: `src/vfs/node.ts`
**Setup**: Create a temporary directory `TEST_ROOT`.

- [ ] **Real I/O Operations**
    - [ ] `write('deep/nested/file.txt')`: Verify it creates physical directories on disk.
    - [ ] `read('deep/nested/file.txt')`: Verify it returns exact byte content written.
    - [ ] `list('deep')`: Verify it returns structure matching OS `ls -R`.
- [ ] **Path Security (Jail)**
    - [ ] Attempt `write('../outside.txt')`. **Assert**: Throws specific `SecurityViolation` error. File **must not** exist outside `TEST_ROOT`.
    - [ ] Attempt symlink traversal. Create a symlink in `TEST_ROOT` pointing to `/etc/passwd`. Attempt `read()`. **Assert**: Throws or resolves to empty/null (depending on config).

## 2. Sandbox Execution (V8)
**Target**: `src/sandbox/isolate.ts`, `src/sandbox/bundler.ts`
**Setup**: Instantiate real `isolated-vm`.

- [ ] **Compilation**
    - [ ] Feed raw TypeScript: `export default (a: number) => a * 2;`.
    - [ ] **Assert**: Returns a callable function handle.
    - [ ] Feed Syntax Error: `const x = ;`.
    - [ ] **Assert**: Throws `CompilationError` with line number.
- [ ] **Runtime constraints**
    - [ ] **Memory**: Execute script that allocates 100MB buffer. **Assert**: Throws `ERR_ISOLATE_MEMORY`.
    - [ ] **Timeout**: Execute `while(true){}`. **Assert**: Throws `ERR_ISOLATE_TIMEOUT` after 50ms (or configured limit).
- [ ] **Determinism**
    - [ ] Run `Math.random()`. **Assert**: If seed is configurable, output is constant. (If not, verify output format).

## 3. Tool Validation logic
**Target**: `src/tools/validation.ts`

- [ ] **Static Analysis**
    - [ ] Input source code with `process.exit()`.
    - [ ] **Assert**: Validation fails with "Global 'process' is forbidden".
    - [ ] Input source code with `import fs from 'fs'`.
    - [ ] **Assert**: Validation fails if import is not in whitelist.
