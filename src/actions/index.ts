'use server';

import { revalidatePath } from 'next/cache';
import { Target, LogResult } from '../lib/db';
import { mockDB } from '../lib/db/mock';

interface DashboardTarget extends Target {
    latestLog?: LogResult;
}

function getDB() {
    try {
        // Vercel / Local Development -> Use Mock DB
        // Cloudflare Pages -> Use D1
        if (process.env.NODE_ENV === 'development' || !process.env.DB) {
            // In Vercel, we don't have D1 binding unless configured.
            // For now, fall back to Mock DB to allow deployment.
            // If user wants persistence on Vercel, they need Postgres/KV.
            return mockDB as unknown as D1Database;
        }

        // Dynamic import to avoid build error on Vercel/Next.js 16
        // This part will only work if @cloudflare/next-on-pages is present and compatible
        // But since we are removing it to fix build, we must strictly use MockDB or another adapter.
        return mockDB as unknown as D1Database;
    } catch (e) {
        return mockDB as unknown as D1Database;
    }
}

export async function getDashboardData(): Promise<DashboardTarget[]> {
    try {
        const db = getDB();

        // Fetch active targets
        const { results: targets } = await db
            .prepare("SELECT * FROM Targets WHERE is_active = 1 ORDER BY id ASC")
            .all<Target>();

        if (!targets || targets.length === 0) return [];

        // Fetch latest log for each target (This N+1 is okay for low volume, optimization needed later)
        // Better approach: Window function in SQL or simple latest log aggregation
        const targetsWithLogs = await Promise.all(targets.map(async (target) => {
            const { results } = await db
                .prepare("SELECT * FROM Logs WHERE target_id = ? ORDER BY checked_at DESC LIMIT 1")
                .bind(target.id)
                .all<LogResult>();

            return {
                ...target,
                latestLog: results && results.length > 0 ? results[0] : undefined
            };
        }));

        return targetsWithLogs;
    } catch (e) {
        console.error("Failed to fetch dashboard data:", e);
        return [];
    }
}

export async function getAllTargets(): Promise<Target[]> {
    try {
        const db = getDB();
        const { results } = await db.prepare("SELECT * FROM Targets ORDER BY id DESC").all<Target>();
        return results || [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function uploadTargets(targets: Omit<Target, 'id' | 'created_at'>[]) {
    const db = getDB();
    const stmt = db.prepare("INSERT INTO Targets (name, url, was_cnt, web_cnt, db_info, keyword, interval, is_active, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

    try {
        const batch = targets.map(t => stmt.bind(
            t.name,
            t.url,
            t.was_cnt || 0,
            t.web_cnt || 0,
            t.db_info || '',
            t.keyword || null,
            t.interval || 5,
            1,
            t.category || '지역교육청'
        ));
        await db.batch(batch);
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to upload targets' };
    }
}

export async function toggleTarget(id: number, isActive: boolean) {
    try {
        const db = getDB();
        await db.prepare("UPDATE Targets SET is_active = ? WHERE id = ?")
            .bind(isActive ? 1 : 0, id)
            .run();
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false };
    }
}

export async function deleteTarget(id: number) {
    try {
        const db = getDB();
        await db.prepare("DELETE FROM Targets WHERE id = ?").bind(id).run();
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Failed to delete target' };
    }
}

export async function deleteAllTargets() {
    try {
        const db = getDB();
        await db.prepare("DELETE FROM Targets").run();
        // Optionally delete logs too? user didn't ask, but usually yes.
        // await db.prepare("DELETE FROM Logs").run(); 
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Failed to delete all targets' };
    }
}

import { checkTarget } from '../lib/monitor';

export async function manualCheck(id: number) {
    try {
        const db = getDB();
        // Fetch target
        const { results } = await db.prepare("SELECT * FROM Targets WHERE id = ?").bind(id).all<Target>();
        if (!results || results.length === 0) return { success: false, error: 'Target not found' };

        const target = results[0];
        const { status, latency, result } = await checkTarget(target);

        // Save log
        await db.prepare("INSERT INTO Logs (target_id, status, latency, result, checked_at) VALUES (?, ?, ?, ?, ?)")
            .bind(target.id, status, latency, result, Date.now())
            .run();

        revalidatePath('/');
        return { success: true, result, latency };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to manual check' };
    }
}

// Helper to parse CSV (Basic implementation)
function parseCSV(text: string): any[] {
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    // Clean headers: remove quotes and invisible characters
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').replace(/[\uFEFF\u200B]/g, ''));

    return lines.slice(1).map(line => {
        // Skip empty lines
        if (!line.trim()) return null;

        const values: string[] = [];
        let inQuotes = false;
        let currentValue = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') { // Handle escaped quotes
                    currentValue += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(currentValue.trim().replace(/^"|"$/g, ''));
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        values.push(currentValue.trim().replace(/^"|"$/g, ''));

        return headers.reduce((obj, header, index) => {
            // Map known headers (Korean) to English keys
            const key = header;
            obj[key] = values[index] !== undefined ? values[index] : '';
            return obj;
        }, {} as any);
    }).filter((row: any) => row !== null && Object.values(row).some(v => v));
}

// Helper to safely find a key in a row object ignoring whitespace
function findValue(row: any, ...keys: string[]) {
    const rowKeys = Object.keys(row);
    for (const searchKey of keys) {
        // 1. Exact match
        if (row[searchKey] !== undefined && row[searchKey] !== '') return row[searchKey];

        // 2. Trimmed match
        for (const rKey of rowKeys) {
            if (rKey.trim() === searchKey) return row[rKey];
        }

        // 3. Includes match (e.g. " 홈페이지명 " matches "홈페이지명")
        for (const rKey of rowKeys) {
            if (rKey.replace(/\s/g, '').includes(searchKey.replace(/\s/g, ''))) return row[rKey];
        }
    }
    return undefined;
}

export async function syncGoogleSheet(url: string) {
    try {
        let exportUrl = url;

        // Convert standard Google Sheet URL to CSV export URL
        if (url.includes('docs.google.com/spreadsheets/d/')) {
            const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
            }
        }

        console.log(`[Sync] Fetching: ${exportUrl}`);
        const response = await fetch(exportUrl);
        if (!response.ok) {
            throw new Error(`구글 시트에 접근할 수 없습니다. (HTTP ${response.status}). 시트가 '링크가 있는 모든 사용자에게 공개' 되어있는지 확인해주세요.`);
        }

        const csvText = await response.text();
        const rows = parseCSV(csvText);

        if (rows.length === 0) {
            return { success: false, error: 'CSV 데이터를 파싱할 수 없습니다.' };
        }

        console.log(`[Sync] Parsed Headers:`, Object.keys(rows[0]));
        console.log(`[Sync] First Row Sample:`, rows[0]);

        // Map columns with fuzzy matching
        const targets = rows.map((row: any) => {
            const name = findValue(row, '홈페이지명', '사이트명', '이름', 'Name', 'Site');
            const urlVal = findValue(row, 'URL', '주소', 'Address', 'Link');
            const ip = findValue(row, 'IP', '아이피', 'ip');
            const category = findValue(row, '구분', '분류', 'Category', 'Type');

            const wasVal = findValue(row, 'WAS', 'WAS수', 'was_cnt', 'WAS Count', 'WAS목록', 'WAS서버');
            const webVal = findValue(row, 'WEB', 'WEB수', 'web_cnt', 'WEB Count', 'WEB목록', 'WEB서버');

            // Debugging first row
            if (row === rows[0]) {
                console.log('[Sync Debug] Row Keys:', Object.keys(row));
                console.log('[Sync Debug] Found WAS:', wasVal);
                console.log('[Sync Debug] Found WEB:', webVal);
            }

            return {
                name: name || 'Unknown',
                url: urlVal,
                was_cnt: wasVal ? parseInt(wasVal, 10) : 0,
                web_cnt: webVal ? parseInt(webVal, 10) : 0,
                db_info: ip || '',
                keyword: undefined,
                interval: 5,
                is_active: 1,
                category: category || '교육지원청'
            };
        }).filter((t: any) => t.url && (t.url.startsWith('http') || t.url.startsWith('https')));

        if (targets.length === 0) {
            return { success: false, error: '유효한 URL을 가진 데이터가 없습니다. [URL] 컬럼을 확인해주세요.' };
        }

        // User Requirement: Replace all existing data with new data
        console.log(`[Sync] Replacing database with ${targets.length} targets.`);
        await deleteAllTargets();

        await uploadTargets(targets);
        return { success: true, count: targets.length };
    } catch (e: any) {
        console.error('Sync Error:', e);
        return { success: false, error: e.message || '동기화 중 오류가 발생했습니다.' };
    }
}
