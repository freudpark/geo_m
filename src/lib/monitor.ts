import { Target } from './db';

export async function checkTarget(target: Target): Promise<{ status: number; latency: number; result: string; details?: string }> {
    const startTime = Date.now();
    let status = 0;
    let lastError: any = null;

    // Strategies configuration
    const strategies = [
        {
            name: 'Modern Browser',
            timeout: 3000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        },
        {
            name: 'Mobile Safari',
            timeout: 7000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9'
            }
        },
        {
            name: 'Legacy Curl',
            timeout: 12000,
            headers: {
                'User-Agent': 'curl/8.6.0',
                'Accept': '*/*'
            }
        },
        {
            name: 'Minimal',
            timeout: 15000,
            headers: {}
        }
    ];

    const performFetch = async (urlStr: string, headers: Record<string, string>, timeoutMs: number): Promise<number> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(urlStr, {
                method: 'GET',
                headers: {
                    ...headers,
                    'Connection': 'close' // Some older servers prefer close over keep-alive during monitoring
                },
                signal: controller.signal,
                redirect: 'follow',
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
            return res.status;
        } catch (error: any) {
            clearTimeout(timeoutId);
            throw error;
        }
    };

    // Try each strategy until success or all fail
    for (let i = 0; i < strategies.length; i++) {
        const strategy = strategies[i];
        try {
            status = await performFetch(target.url, strategy.headers as Record<string, string>, strategy.timeout);

            // If we get a valid response (2xx or 3xx), we're done
            if (status >= 200 && status < 400) {
                const latency = Date.now() - startTime;
                return { status, latency, result: 'OK' };
            }

            // If we get "Bad Request", "Forbidden", "Not Acceptable", etc., retry with next strategy
            const shouldRetry = [400, 403, 405, 406, 412, 500, 502, 503, 504].includes(status);
            if (!shouldRetry) {
                break; // Stop on 401, 404, etc.
            }

            console.log(`[Monitor] Strategy ${strategy.name} failed with status ${status} for ${target.url}. Retrying...`);

        } catch (err: any) {
            lastError = err;
            const msg = (err.message || '').toUpperCase();
            const name = (err.name || '').toUpperCase();

            const isTimeout = msg.includes('TIMEDOUT') || msg.includes('TIMEOUT') || name === 'ABORTERROR';
            const isConnError = msg.includes('RESET') || msg.includes('REFUSED') || msg.includes('HANG UP') || msg.includes('NETWORK');

            if (isTimeout || isConnError) {
                console.log(`[Monitor] Strategy ${strategy.name} encountered ${isTimeout ? 'TIMEOUT' : 'NETWORK ERROR'} for ${target.url}. Retrying...`);
                continue; // Try next strategy
            }
            break; // Unexpected error
        }
    }

    // If we're here, all strategies failed OR we stopped early
    const latency = Date.now() - startTime;
    let result = 'FAIL';

    if (status > 0) {
        // HTTP Status Mapping
        if (status === 404) result = 'FAIL:페이지 없음 (404)';
        else if (status === 500) result = 'FAIL:서버 오류 (500)';
        else if (status === 502) result = 'FAIL:게이트웨이 오류 (502)';
        else if (status === 503) result = 'FAIL:서비스 점검 중 (503)';
        else if (status === 504) result = 'FAIL:응답 시간 초과 (504)';
        else if (status === 403) result = 'FAIL:접근 권한 없음 (403)';
        else if (status === 400) result = 'FAIL:잘못된 요청 (400)';
        else result = `FAIL:HTTP 오류 (${status})`;
    } else if (lastError) {
        // Network/Exception Mapping
        const msg = (lastError.message || '').toLowerCase();
        const name = (lastError.name || '').toLowerCase();

        if (msg.includes('timeout') || name === 'aborterror') result = 'FAIL:시간 초과';
        else if (msg.includes('refused')) result = 'FAIL:연결 거부됨';
        else if (msg.includes('reset')) result = 'FAIL:연결 초기화됨';
        else if (msg.includes('cert') || msg.includes('tls') || msg.includes('ssl')) result = 'FAIL:인증서 오류 (SSL)';
        else if (msg.includes('dns') || msg.includes('address')) result = 'FAIL:주소 찾기 실패';
        else result = `FAIL:접속 불가 (${lastError.message || 'Unknown'})`;

        // DNS Retry Strategy (moved inside catch block logic basically)
        if (msg.includes('dns') || msg.includes('address')) {
            try {
                const urlObj = new URL(target.url);
                if (!urlObj.hostname.startsWith('www.')) {
                    const newUrl = `${urlObj.protocol}//www.${urlObj.hostname}${urlObj.pathname}${urlObj.search}`;
                    return await checkTarget({ ...target, url: newUrl });
                }
            } catch (e) { }
        }
    }

    return { status, latency, result };
}
