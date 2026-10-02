import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth as any, async (req: AuthRequest, res) => {
    try {
        const reqBody: Record<string, any> = req.body ?? {};
        const {
            method = 'GET',
            url,
            query = [],
            headers = [],
            auth = { type: 'none' },
            body = { mode: 'none' },
        } = reqBody;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url is required' });
        }

        let targetUrl: URL;
        try {
            targetUrl = new URL(url);
        } catch {
            return res.status(400).json({ error: `Invalid URL: ${url}` });
        }

        for (const entry of (query as { enabled?: boolean; key?: string; value?: string }[])) {
            if (entry.enabled && entry.key) targetUrl.searchParams.append(entry.key, String(entry.value ?? ''));
        }

        const requestHeaders: Record<string, string> = {};
        for (const entry of (headers as { enabled?: boolean; key?: string; value?: string }[])) {
            if (entry.enabled && entry.key) requestHeaders[entry.key.toLowerCase()] = String(entry.value ?? '');
        }

        const authObj = (auth ?? { type: 'none' }) as Record<string, any>;
        if (authObj.type === 'bearer' && authObj.token) {
            requestHeaders['authorization'] = `Bearer ${authObj.token}`;
        } else if (authObj.type === 'basic' && (authObj.username || authObj.password)) {
            const credentials = Buffer.from(`${authObj.username ?? ''}:${authObj.password ?? ''}`).toString('base64');
            requestHeaders['authorization'] = `Basic ${credentials}`;
        }

        const bodyObj = (body ?? { mode: 'none' }) as Record<string, any>;
        let requestBody: string | undefined;
        if (method !== 'GET' && method !== 'HEAD' && bodyObj.mode !== 'none') {
            if (bodyObj.mode === 'json') {
                requestBody = bodyObj.value;
                if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
            } else if (bodyObj.mode === 'raw') {
                requestBody = bodyObj.value;
                if (!requestHeaders['content-type'] && bodyObj.contentType) requestHeaders['content-type'] = bodyObj.contentType;
            } else if (bodyObj.mode === 'form-urlencoded') {
                const params = new URLSearchParams();
                for (const entry of ((bodyObj.entries as { enabled?: boolean; key?: string; value?: string }[]) ?? [])) {
                    if (entry.enabled && entry.key) params.append(entry.key, String(entry.value ?? ''));
                }
                requestBody = params.toString();
                if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
            }
        }

        const startTime = Date.now();
        const abortController = new AbortController();
        const timeoutHandle = setTimeout(() => abortController.abort(), 30_000);

        try {
            const fetchOptions: RequestInit = {
                method,
                headers: requestHeaders,
                signal: abortController.signal,
            };
            if (requestBody !== undefined) fetchOptions.body = requestBody;

            const upstream = await fetch(targetUrl.toString(), fetchOptions);
            const elapsed = Date.now() - startTime;
            const responseContentType = upstream.headers.get('content-type') ?? '';

            const responseHeaders: Record<string, string> = {};
            const skip = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade',
                'proxy-authenticate', 'proxy-authorization', 'te', 'trailers']);
            upstream.headers.forEach((value, key) => {
                if (!skip.has(key.toLowerCase())) responseHeaders[key] = value;
            });

            const MAX_SIZE = 20 * 1024 * 1024;
            const buffer = await upstream.arrayBuffer();
            const size = buffer.byteLength;

            if (size > MAX_SIZE) {
                return res.status(413).json({ error: `Response too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.` });
            }

            const isText =
                responseContentType.includes('text/') ||
                responseContentType.includes('application/json') ||
                responseContentType.includes('application/xml') ||
                responseContentType.includes('application/xhtml') ||
                responseContentType.includes('application/javascript') ||
                responseContentType.includes('application/ld+json') ||
                responseContentType.includes('application/atom+xml') ||
                responseContentType.includes('+xml');

            const responsePayload = {
                httpStatus: upstream.status,
                httpStatusText: upstream.statusText,
                contentType: responseContentType,
                headers: responseHeaders,
                elapsed,
                size,
            };

            if (isText) {
                return res.json({ ...responsePayload, body: new TextDecoder().decode(buffer), bodyEncoding: 'text' });
            } else {
                return res.json({ ...responsePayload, body: Buffer.from(buffer).toString('base64'), bodyEncoding: 'base64' });
            }
        } catch (fetchError: any) {
            if (fetchError.name === 'AbortError' || abortController.signal.aborted) {
                return res.status(504).json({ error: 'Request timed out after 30 seconds.' });
            }
            return res.status(502).json({ error: fetchError.message ?? 'Failed to reach the target URL.' });
        } finally {
            clearTimeout(timeoutHandle);
        }
    } catch (outerError: any) {
        return res.status(500).json({ error: outerError.message ?? 'Internal error in fetch-doc proxy.' });
    }
});

export default router;
