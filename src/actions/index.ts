'use server';

import { revalidatePath } from 'next/cache';
import { Target, LogResult } from '../lib/db';
import { checkTarget } from '../lib/monitor';

// ============================================================
// In-Memory Data Store (Vercel Compatible)
// ============================================================
// Vercel Serverless Functions are stateless, so in-memory data
// is lost between invocations. We use global variables to persist
// data within a single warm instance. The primary data source
// is Google Sheets sync - data is re-fetched on each sync.
// ============================================================

interface DashboardTarget extends Target {
    latestLog?: LogResult;
}

// Global in-memory store (persists within warm serverless instance)
declare global {
    var _targets: Target[];
    var _logs: LogResult[];
    var _nextTargetId: number;
}

function getTargets(): Target[] {
    if (!globalThis._targets) globalThis._targets = [];
    return globalThis._targets;
}

function setTargets(targets: Target[]) {
    globalThis._targets = targets;
}

function getLogs(): LogResult[] {
    if (!globalThis._logs) globalThis._logs = [];
    return globalThis._logs;
}

function getNextId(): number {
    if (!globalThis._nextTargetId) {
        const targets = getTargets();
        globalThis._nextTargetId = targets.length > 0 ? Math.max(...targets.map(t => t.id)) + 1 : 1;
    }
    return globalThis._nextTargetId++;
}

// ============================================================
// Default Google Sheet URL (fallback for auto-sync)
// Can be overridden via GOOGLE_SHEET_URL environment variable
// ============================================================
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1ba41P8uZN0IM5cqSZTUD0bUPdEu4fPasOxG1Dog2xEg/edit?usp=sharing';

function getSheetUrl(): string {
    return process.env.GOOGLE_SHEET_URL || DEFAULT_SHEET_URL;
}

// Auto-load from Google Sheets if in-memory store is empty
// This handles Vercel cold starts and multi-instance isolation
async function ensureDataLoaded(): Promise<void> {
    const targets = getTargets();
    if (targets.length > 0) return; // Already loaded

    const sheetUrl = getSheetUrl();
    if (!sheetUrl) return;

    try {
        console.log('[AutoSync] Cold start detected - loading data from Google Sheets...');

        let exportUrl = sheetUrl;
        if (sheetUrl.includes('docs.google.com/spreadsheets/d/')) {
            const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
            }
        }

        const response = await fetch(exportUrl);
        if (!response.ok) {
            console.error(`[AutoSync] Failed to fetch sheet: HTTP ${response.status}`);
            return;
        }

        const csvText = await response.text();
        const rows = parseCSV(csvText);
        if (rows.length === 0) return;

        const newTargets = rows.map((row: any) => {
            const name = findValue(row, '홈페이지명', '사이트명', '이름', 'Name', 'Site');
            const urlVal = findValue(row, 'URL', '주소', 'Address', 'Link');
            const ip = findValue(row, 'IP', '아이피', 'ip');
            const category = findValue(row, '구분', '분류', 'Category', 'Type');
            const wasVal = findValue(row, 'WAS', 'WAS수', 'was_cnt', 'WAS Count', 'WAS목록', 'WAS서버');
            const webVal = findValue(row, 'WEB', 'WEB수', 'web_cnt', 'WEB Count', 'WEB목록', 'WEB서버');

            return {
                id: 0, // Will be assigned below
                name: name || 'Unknown',
                url: urlVal,
                was_cnt: wasVal ? parseInt(wasVal, 10) : 0,
                web_cnt: webVal ? parseInt(webVal, 10) : 0,
                db_info: ip || '',
                keyword: undefined,
                interval: 5,
                is_active: 1,
                category: category || '교육지원청',
                created_at: new Date().toISOString()
            };
        }).filter((t: any) => t.url && (t.url.startsWith('http') || t.url.startsWith('https')));

        // Assign IDs
        newTargets.forEach((t, i) => { t.id = i + 1; });
        setTargets(newTargets);
        globalThis._nextTargetId = newTargets.length + 1;

        console.log(`[AutoSync] Loaded ${newTargets.length} targets from Google Sheets.`);
    } catch (e) {
        console.error('[AutoSync] Error:', e);
    }
}

// ============================================================
// Server Actions
// ============================================================

export async function getDashboardData(): Promise<DashboardTarget[]> {
    try {
        // Auto-load from Google Sheets on cold start
        await ensureDataLoaded();

        const targets = getTargets().filter(t => t.is_active === 1);
        if (targets.length === 0) return [];

        const logs = getLogs();
        const targetsWithLogs = targets.map(target => {
            // Find latest log for this target
            const targetLogs = logs
                .filter(l => l.target_id === target.id)
                .sort((a, b) => {
                    const timeA = typeof a.checked_at === 'string' ? new Date(a.checked_at).getTime() : Number(a.checked_at) || 0;
                    const timeB = typeof b.checked_at === 'string' ? new Date(b.checked_at).getTime() : Number(b.checked_at) || 0;
                    return timeB - timeA;
                });

            return {
                ...target,
                latestLog: targetLogs.length > 0 ? targetLogs[0] : undefined
            };
        });

        // Sort by id ASC
        targetsWithLogs.sort((a, b) => a.id - b.id);
        return targetsWithLogs;
    } catch (e) {
        console.error("Failed to fetch dashboard data:", e);
        return [];
    }
}

export async function getAllTargets(): Promise<Target[]> {
    try {
        // Auto-load from Google Sheets on cold start
        await ensureDataLoaded();

        const targets = getTargets();
        // Sort by id DESC
        return [...targets].sort((a, b) => b.id - a.id);
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function uploadTargets(targets: Omit<Target, 'id' | 'created_at'>[]) {
    try {
        const currentTargets = getTargets();

        const newTargets = targets.map(t => ({
            id: getNextId(),
            name: t.name,
            url: t.url,
            was_cnt: t.was_cnt || 0,
            web_cnt: t.web_cnt || 0,
            db_info: t.db_info || '',
            keyword: t.keyword || undefined,
            interval: t.interval || 5,
            is_active: 1,
            category: t.category || '지역교육청',
            created_at: new Date().toISOString()
        }));

        setTargets([...currentTargets, ...newTargets]);
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
        const targets = getTargets();
        setTargets(targets.map(t => t.id === id ? { ...t, is_active: isActive ? 1 : 0 } : t));
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false };
    }
}

export async function deleteTarget(id: number) {
    try {
        const targets = getTargets();
        setTargets(targets.filter(t => t.id !== id));
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Failed to delete target' };
    }
}

export async function deleteAllTargets() {
    try {
        setTargets([]);
        globalThis._logs = [];
        globalThis._nextTargetId = 1;
        revalidatePath('/admin');
        revalidatePath('/');
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Failed to delete all targets' };
    }
}

export async function manualCheck(id: number) {
    try {
        const targets = getTargets();
        const target = targets.find(t => t.id === id);
        if (!target) return { success: false, error: 'Target not found' };

        const { status, latency, result } = await checkTarget(target);

        // Save log
        const logs = getLogs();
        logs.push({
            target_id: target.id,
            status,
            latency,
            result,
            checked_at: new Date().toISOString()
        });
        globalThis._logs = logs;

        revalidatePath('/');
        return { success: true, result, latency };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to manual check' };
    }
}

// ============================================================
// CSV Parsing Helpers
// ============================================================

function parseCSV(text: string): any[] {
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').replace(/[\uFEFF\u200B]/g, ''));

    return lines.slice(1).map(line => {
        if (!line.trim()) return null;

        const values: string[] = [];
        let inQuotes = false;
        let currentValue = '';

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
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
            const key = header;
            obj[key] = values[index] !== undefined ? values[index] : '';
            return obj;
        }, {} as any);
    }).filter((row: any) => row !== null && Object.values(row).some(v => v));
}

function findValue(row: any, ...keys: string[]) {
    const rowKeys = Object.keys(row);
    for (const searchKey of keys) {
        if (row[searchKey] !== undefined && row[searchKey] !== '') return row[searchKey];

        for (const rKey of rowKeys) {
            if (rKey.trim() === searchKey) return row[rKey];
        }

        for (const rKey of rowKeys) {
            if (rKey.replace(/\s/g, '').includes(searchKey.replace(/\s/g, ''))) return row[rKey];
        }
    }
    return undefined;
}

// ============================================================
// Google Sheets Sync
// ============================================================

export async function syncGoogleSheet(url: string) {
    try {
        let exportUrl = url;

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

        const targets = rows.map((row: any) => {
            const name = findValue(row, '홈페이지명', '사이트명', '이름', 'Name', 'Site');
            const urlVal = findValue(row, 'URL', '주소', 'Address', 'Link');
            const ip = findValue(row, 'IP', '아이피', 'ip');
            const category = findValue(row, '구분', '분류', 'Category', 'Type');

            const wasVal = findValue(row, 'WAS', 'WAS수', 'was_cnt', 'WAS Count', 'WAS목록', 'WAS서버');
            const webVal = findValue(row, 'WEB', 'WEB수', 'web_cnt', 'WEB Count', 'WEB목록', 'WEB서버');

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

        console.log(`[Sync] Replacing database with ${targets.length} targets.`);
        await deleteAllTargets();
        await uploadTargets(targets);
        return { success: true, count: targets.length };
    } catch (e: any) {
        console.error('Sync Error:', e);
        return { success: false, error: e.message || '동기화 중 오류가 발생했습니다.' };
    }
}
