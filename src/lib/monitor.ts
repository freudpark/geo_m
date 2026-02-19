import { Target } from './db';

export async function checkTarget(target: Target): Promise<{ status: number; latency: number; result: string; details?: string }> {
    const startTime = Date.now();
    let status = 0;
    let result = 'FAIL';

    // Helper to perform fetch request
    const performFetch = async (urlStr: string, headers: Record<string, string>, timeoutMs: number): Promise<number> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(urlStr, {
                method: 'GET',
                headers: {
                    ...headers,
                    // 'Host' header is forbidden to set manually in some environments like Cloudflare, 
                    // relying on default behavior is safer.
                    'Connection': 'keep-alive'
                },
                signal: controller.signal,
                redirect: 'follow', // Cloudflare fetch follows redirects by default? Standad fetch is 'follow'
                cache: 'no-store'
            });
            clearTimeout(timeoutId);
            return res.status;
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('ETIMEDOUT');
            }
            throw error;
        }
    };

    try {
        // Strategy 1: Modern Browser Headers (Standard)
        const modernHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        };

        try {
            // First attempt: Modern headers, 2.5s timeout (Aggressive fail fast)
            status = await performFetch(target.url, modernHeaders, 2500);

            if (status === 400 || status === 403 || status === 406 || status === 500) {
                throw new Error('RETRY_LEGACY');
            }

        } catch (err: any) {
            const msg = (err.message || '').toUpperCase();

            const shouldRetry =
                msg === 'RETRY_LEGACY' ||
                msg.includes('PROTOCOL') ||
                msg.includes('HPE_') ||
                msg.includes('ECONNRESET') ||
                msg.includes('SOCKET HANG UP') ||
                msg === 'ETIMEDOUT'; // Retry timeout with longer duration?

            if (shouldRetry) {
                // Strategy 2: Legacy/Curl Headers
                const legacyHeaders = {
                    'User-Agent': 'curl/8.16.0',
                    'Accept': '*/*'
                };

                // Give legacy servers a reasonable time (5s)
                status = await performFetch(target.url, legacyHeaders, 5000);
            } else {
                throw err; // Real error
            }
        }

        // Evaluate Status
        if (status >= 200 && status < 400) {
            result = 'OK';
        } else {
            // Precise Error Mapping
            if (status === 404) result = 'FAIL:페이지 없음 (404)';
            else if (status === 500) result = 'FAIL:서버 오류 (500)';
            else if (status === 502) result = 'FAIL:게이트웨이 오류 (502)';
            else if (status === 503) result = 'FAIL:서비스 점검 중 (503)';
            else if (status === 504) result = 'FAIL:응답 시간 초과 (504)';
            else if (status === 403) result = 'FAIL:접근 권한 없음 (403)';
            else if (status === 410) result = 'FAIL:사라짐 (410)';
            else if (status === 400) result = 'FAIL:잘못된 요청 (400)';
            else result = `FAIL:HTTP 오류 (${status})`;
        }

    } catch (err: any) {
        // Strategy 3: Auto-WWW Retry (Manual implementation for Fetch)
        // Fetch usually resolves DNS. If it fails, it throws TypeError or similar.
        // We can check error message for 'network error' or similar.

        const msg = (err.message || '').toLowerCase();
        const isDnsError = msg.includes('dns') || msg.includes('address') || msg.includes('found'); // 'not found' in address

        if (isDnsError) {
            try {
                const urlObj = new URL(target.url);
                if (!urlObj.hostname.startsWith('www.')) {
                    const newUrl = `${urlObj.protocol}//www.${urlObj.hostname}${urlObj.pathname}${urlObj.search}`;
                    const newTarget = { ...target, url: newUrl };
                    // Recursive call
                    return await checkTarget(newTarget);
                }
            } catch (e) { }
        }

        // Map network errors
        let reason = '접속 불가';

        if (msg.includes('etimedout') || msg.includes('timeout') || err.name === 'AbortError') reason = '시간 초과';
        else if (msg.includes('connection refused')) reason = '연결 거부됨';
        else if (msg.includes('reset')) reason = '연결 초기화됨';
        else if (msg.includes('invalid url')) reason = '잘못된 주소';
        else if (msg.includes('cert') || msg.includes('tls') || msg.includes('ssl')) reason = '인증서 오류 (SSL)';
        else if (isDnsError) reason = '주소 찾기 실패';
        else if (err.message) {
            reason = `오류: ${err.message}`;
        }

        result = `FAIL:${reason}`;
    }

    const latency = Date.now() - startTime;
    return { status, latency, result };
}
