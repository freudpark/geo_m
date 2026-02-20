// Vercel environment - no Cloudflare-specific types needed

declare global {
    var _targets: import('./lib/db').Target[];
    var _logs: import('./lib/db').LogResult[];
    var _nextTargetId: number;
}

export { };
