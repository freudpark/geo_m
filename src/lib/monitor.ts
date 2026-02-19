import { Target } from './db';
import https from 'https';
import http from 'http';
import { URL } from 'url';

// Forcefully disable SSL verification for the entire process
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function checkTarget(target: Target): Promise<{ status: number; latency: number; result: string; details?: string }> {
    const startTime = Date.now();
    let status = 0;
    let result = 'FAIL';

    // Helper function to perform the low-level request
    const performRequest = (headers: Record<string, string>, timeoutMs: number): Promise<number> => {
        return new Promise<number>((resolve, reject) => {
            let url: URL;
            try {
                url = new URL(target.url);
            } catch (e) {
                reject(new Error('ERR_INVALID_URL'));
                return;
            }

            const isHttps = url.protocol === 'https:';
            const requestModule = isHttps ? https : http;

            const options: https.RequestOptions = {
                method: 'GET',
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                timeout: timeoutMs,
                rejectUnauthorized: false, // Ignore SSL
                family: 4, // Force IPv4 avoids many timeout issues on dual-stack networks
                headers: {
                    ...headers,
                    'Host': url.hostname,
                    'Connection': 'keep-alive'
                }
            };

            const req = requestModule.request(options, (res) => {
                if (res.statusCode) {
                    resolve(res.statusCode);
                } else {
                    reject(new Error('NO_STATUS_CODE'));
                }
                res.resume(); // Consume data
            });

            req.on('error', (err) => reject(err));

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('ETIMEDOUT'));
            });

            req.end();
        });
    };

    try {
        // Strategy 1: Modern Browser Headers (Standard)
        const modernHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
        };

        try {
            status = await performRequest(modernHeaders, 15000);

            if (status === 400 || status === 403 || status === 406 || status === 500) {
                throw new Error('RETRY_LEGACY');
            }

        } catch (err: any) {
            const msg = (err.message || '').toUpperCase();

            const shouldRetry =
                msg === 'RETRY_LEGACY' ||
                msg.includes('PROTOCOL') ||
                msg.includes('HPE_') || // HTTP Parse Error
                msg.includes('ECONNRESET') ||
                msg.includes('SOCKET HANG UP');

            if (shouldRetry) {
                // Strategy 2: Legacy/Curl Headers
                const legacyHeaders = {
                    'User-Agent': 'curl/8.16.0',
                    'Accept': '*/*'
                };

                status = await performRequest(legacyHeaders, 15000);
            } else {
                throw err; // Real error, rethrow to outer catch
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
            else if (status === 400) result = 'FAIL:잘못된 요청 (400)';
            else result = `FAIL:HTTP 오류 (${status})`;
        }

    } catch (err: any) {
        // Strategy 3: Auto-WWW Retry (for DNS errors)
        const code = (err.code || '').toUpperCase();
        if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
            try {
                const urlObj = new URL(target.url);
                if (!urlObj.hostname.startsWith('www.')) {
                    // Construct new URL with www
                    const newUrl = `${urlObj.protocol}//www.${urlObj.hostname}${urlObj.pathname}${urlObj.search}`;
                    // Temporarily update target URL for this retry
                    const newTarget = { ...target, url: newUrl };

                    // Recursive call with new URL
                    // Note: This returns a promise, need to await it and return its result
                    return await checkTarget(newTarget);
                }
            } catch (e) {
                // URL parsing failed or other error, fall through to error mapping
            }
        }

        // Map network errors
        let reason = '접속 불가';
        const msg = (err.message || '').toLowerCase();

        if (code === 'ETIMEDOUT') reason = '시간 초과';
        else if (msg.includes('socket hang up')) reason = '서버 연결 끊김';
        else if (code === 'ENOTFOUND') reason = '주소 찾기 실패';
        else if (code === 'ECONNREFUSED') reason = '연결 거부됨';
        else if (code === 'ECONNRESET') reason = '연결 초기화됨';
        else if (msg.includes('invalid url') || code === 'ERR_INVALID_URL') reason = '잘못된 주소';
        else if (msg.includes('protocol')) reason = '프로토콜 오류';
        else if (msg.includes('cert') || msg.includes('legacy') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') reason = '인증서 오류 (SSL)';

        else if (err.cause) {
            const causeMsg = String(err.cause).toLowerCase();
            if (causeMsg.includes('econnrefused')) reason = '연결 거부됨';
            else if (causeMsg.includes('enotfound')) reason = '주소 찾기 실패';
            else if (causeMsg.includes('socket hang up')) reason = '서버 연결 끊김';
            else if (causeMsg.includes('cert') || causeMsg.includes('tls') || causeMsg.includes('ssl')) reason = '인증서 오류 (SSL)';
            else if (causeMsg.includes('protocol')) reason = '프로토콜 오류';
        }
        else if (err.message) {
            reason = `오류: ${err.message}`;
        }

        result = `FAIL:${reason}`;
    }

    const latency = Date.now() - startTime;
    return { status, latency, result };
}
