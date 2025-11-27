// Simple path normalizer for environments where 'path' module might be limited
// or to ensure consistent behavior across platforms.
function normalizePath(p) {
    // Remove leading ./ and leading /
    return p.replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '');
}
/**
 * Creates an ephemeral, in-memory VFS.
 * Used for Serverless execution or Unit Testing.
 */
export function createMemoryVFS(initialFiles = {}) {
    // Key: Normalized Path, Value: File Content
    const store = new Map();
    // Initialize with seed data
    for (const [p, content] of Object.entries(initialFiles)) {
        store.set(normalizePath(p), content);
    }
    return {
        async readFile(target) {
            const key = normalizePath(target);
            const content = store.get(key);
            if (content === undefined) {
                throw new Error(`File not found: ${target}`);
            }
            return content;
        },
        readSync(target) {
            const key = normalizePath(target);
            const content = store.get(key);
            if (content === undefined) {
                throw new Error(`File not found: ${target}`);
            }
            return content;
        },
        async writeFile(target, content) {
            const key = normalizePath(target);
            store.set(key, content);
        },
        async remove(target) {
            const key = normalizePath(target);
            store.delete(key);
        },
        async exists(target) {
            const key = normalizePath(target);
            return store.has(key);
        },
        async listFiles(dir, recursive = false) {
            const normalizedDir = normalizePath(dir);
            const results = [];
            for (const key of store.keys()) {
                // Check if file is inside dir
                // We add a trailing slash to dir to ensure we match directory boundaries
                // e.g. dir="tools", key="tools/a.ts" -> match
                // e.g. dir="tool", key="tools/a.ts" -> no match
                // Handle root listing case
                const prefix = normalizedDir === '' ? '' : normalizedDir + '/';
                if (key.startsWith(prefix)) {
                    const relativePart = key.slice(prefix.length);
                    if (recursive) {
                        results.push(key);
                    }
                    else {
                        // If not recursive, ensure no more slashes in the remainder
                        if (!relativePart.includes('/')) {
                            results.push(key);
                        }
                    }
                }
            }
            return results;
        }
    };
}
