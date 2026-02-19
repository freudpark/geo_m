import { Target } from './index';

// Use FS for persistence in Node environment (Dev)
// NOTE: This requires removing 'edge' runtime from page.tsx in dev
let fs: any;
let path: any;
let DB_PATH = '';

// Helper to lazy load Node.js modules
function ensureNodeEnv() {
    if (process.env.NODE_ENV !== 'development') return false;
    try {
        if (!fs) {
            fs = require('fs');
            path = require('path');
            DB_PATH = path.join(process.cwd(), 'mock-db.json');
            console.log('[MockDB] DB Path resolved to:', DB_PATH);
        }
        return true;
    } catch (e) {
        console.warn('[MockDB] Failed to load Node modules:', e);
        return false;
    }
}

const DEFAULT_TARGETS: Target[] = [];

function loadDB(): Target[] {
    if (!ensureNodeEnv()) {
        if (process.env.NODE_ENV === 'development') {
            console.warn('[MockDB] Node environment check failed or not in dev');
        }
        return DEFAULT_TARGETS;
    }

    try {
        if (!fs.existsSync(DB_PATH)) {
            console.log('[MockDB] DB file does not exist, creating new one.');
            // Avoid infinite loop if saveDB also fails
            if (fs) {
                fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_TARGETS, null, 2), 'utf-8');
            }
            return DEFAULT_TARGETS;
        }
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        console.log(`[MockDB] Loaded ${parsed.length} targets from disk.`);
        return parsed;
    } catch (e) {
        console.error('[MockDB] Failed to load DB', e);
        return DEFAULT_TARGETS;
    }
}

function saveDB(data: Target[]) {
    if (!ensureNodeEnv()) return;
    try {
        console.log(`[MockDB] Saving ${data.length} targets to disk...`);
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
        console.log('[MockDB] Save successful.');
    } catch (e) {
        console.error('[MockDB] Failed to save DB', e);
    }
}

export const mockDB = {
    prepare: (query: string) => {
        const runQuery = async (args: any[] = []) => {
            // console.log(`[MockDB] Run: ${query}`, args);
            let targets = loadDB();

            if (query.includes('INSERT INTO Targets')) {
                const newTarget = {
                    id: (targets.length > 0 ? Math.max(...targets.map(t => t.id)) : 0) + 1,
                    name: args[0],
                    url: args[1],
                    was_cnt: args[2] || 0,
                    web_cnt: args[3] || 0,
                    db_info: args[4] || '',
                    keyword: args[5],
                    interval: args[6] || 5,
                    is_active: args[7] || 1,
                    category: args[8] || '교육지원청',
                    created_at: new Date().toISOString()
                };
                targets.push(newTarget);
                saveDB(targets);
                return { success: true };
            }
            if (query.includes('UPDATE Targets')) {
                const id = args[1];
                const isActive = args[0];
                targets = targets.map(t => t.id === id ? { ...t, is_active: isActive } : t);
                saveDB(targets);
                return { success: true };
            }
            if (query.includes('DELETE FROM Targets')) {
                if (query.includes('WHERE id =')) {
                    const id = args[0];
                    targets = targets.filter(t => t.id !== id);
                } else {
                    // Delete All
                    console.log('[MockDB] Deleting ALL targets');
                    targets = [];
                }
                saveDB(targets);
                return { success: true };
            }
            // Logs
            if (query.includes('INSERT INTO Logs')) {
                const newLog = {
                    id: global._mockLogs ? global._mockLogs.length + 1 : 1,
                    target_id: args[0],
                    status: args[1],
                    latency: args[2],
                    result: args[3],
                    checked_at: args[4] ? new Date(args[4]).toISOString() : new Date().toISOString()
                };
                if (!global._mockLogs) global._mockLogs = [];
                global._mockLogs.push(newLog);
                return { success: true };
            }
            return { success: true };
        };

        const allQuery = async <T>(args: any[] = []) => {
            // console.log(`[MockDB] Query: ${query}`, args);
            const targets = loadDB();

            if (query.includes('SELECT * FROM Targets')) {
                if (query.includes('WHERE id =')) {
                    const id = args[0];
                    const target = targets.find(t => t.id === id);
                    return { results: target ? [target] : [] };
                }
                // Handle ORDER BY if needed, currently passing as is
                return { results: targets };
            }
            if (query.includes('SELECT * FROM Logs')) {
                const targetId = args[0];
                if (!global._mockLogs) global._mockLogs = [];

                // Sort by checked_at DESC and LIMIT 1
                const logs = global._mockLogs
                    .filter((l: any) => l.target_id === targetId)
                    .sort((a: any, b: any) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime());

                return { results: logs.length > 0 ? [logs[0]] : [] };
            }
            return { results: [] };
        };

        const stmt = {
            bind: (...args: any[]) => ({
                all: async <T>() => allQuery<T>(args),
                run: async () => runQuery(args),
                first: async <T>() => (await allQuery<T>(args)).results?.[0] || null,
                raw: async () => [],
            }),
            all: async <T>() => allQuery<T>(),
            run: async () => runQuery(),
            first: async <T>() => (await allQuery<T>()).results?.[0] || null,
            raw: async () => [],
        };
        return stmt;
    },
    batch: async (statements: any[]) => {
        console.log(`[MockDB] Batch execution of ${statements.length} items`);
        const results = [];
        for (const stmt of statements) {
            if (stmt && typeof stmt.run === 'function') {
                results.push(await stmt.run());
            }
        }
        return results;
    }
};

// Global augmentation for logs to persist across hot reloads in dev
declare global {
    var _mockLogs: any[];
}
