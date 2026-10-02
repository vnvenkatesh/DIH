import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/', requireAuth, async (req, res) => {
    const { method = 'GET', url, query = [], headers = [], auth = { type: 'none' }, body = { mode: 'none' } } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }

    let targetUrl: URL;
    try {
        targetUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: `Invalid URL: ${url}` });
    }

    for (const { enabled, key, value } of (query as { enabled: boolean; key: string; value: string }[])) {
        if (enabled && key) targetUrl.searchParams.append(key, String(value));
    }

    const requestHeaders: Record<string, string> = {};
    for (const { enabled, key, value } of (headers as { enabled: boolean; key: string; value: string }[])) {
        if (enabled && key) requestHeaders[key.toLowerCase()] = String(value);
    }

    if (auth.type === 'bearer' && auth.token) {
        requestHeaders['authorization'] = `Bearer ${auth.token}`;
    } else if (auth.type === 'basic' && (auth.username || auth.password)) {
        const credentials = Buffer.from(`${auth.username ?? ''}:${auth.password ?? ''}`).toString('base64');
        requestHeaders['authorization'] = `Basic ${credentials}`;
    }

    let requestBody: string | undefined;
    if (method === 'POST' && body.mode !== 'none') {
        if (body.mode === 'json') {
            requestBody = body.value;
            if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
        } else if (body.mode === 'raw') {
            requestBody = body.value;
            if (!requestHeaders['content-type'] && body.contentType) requestHeaders['content-type'] = body.contentType;
        } else if (body.mode === 'form-urlencoded') {
            const params = new URLSearchParams();
            for (const { enabled, key, value } of (body.entries as { enabled: boolean; key: string; value: string }[] ?? [])) {
                if (enabled && key) params.append(key, String(value));
            }
            requestBody = params.toString();
            if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
        }
    }

    const startTime = Date.now();
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), 30000);

    try {
        const upstream = await fetch(targetUrl.toString(), {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: abortController.signal,
        });

        const elapsed = Date.now() - startTime;
        const responseContentType = upstream.headers.get('content-type') ?? '';

        const responseHeaders: Record<string, string> = {};
        const skip = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers']);
        upstream.headers.forEach((value, key) => {
            if (!skip.has(key.toLowerCase())) responseHeaders[key] = value;
        });

        const MAX_SIZE = 20 * 1024 * 1024;
        const buffer = await upstream.arrayBuffer();
        const size = buffer.byteLength;

        if (size > MAX_SIZE) {
            return res.status(413).json({ error: `Response too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.` });
        }

        const isText = responseContentType.includes('text/') ||
            responseContentType.includes('application/json') ||
            responseContentType.includes('application/xml') ||
            responseContentType.includes('application/xhtml') ||
            responseContentType.includes('application/javascript') ||
            responseContentType.includes('application/ld+json') ||
            responseContentType.includes('application/atom+xml') ||
            responseContentType.includes('+xml');

        if (isText) {
            const text = new TextDecoder().decode(buffer);
            return res.json({
                httpStatus: upstream.status,
                httpStatusText: upstream.statusText,
                contentType: responseContentType,
                headers: responseHeaders,
                body: text,
                bodyEncoding: 'text',
                elapsed,
                size,
            });
        } else {
            const base64 = Buffer.from(buffer).toString('base64');
            return res.json({
                httpStatus: upstream.status,
                httpStatusText: upstream.statusText,
                contentType: responseContentType,
                headers: responseHeaders,
                body: base64,
                bodyEncoding: 'base64',
                elapsed,
                size,
            });
        }
    } catch (error: any) {
        if (error.name === 'AbortError' || abortController.signal.aborted) {
            return res.status(504).json({ error: 'Request timed out after 30 seconds.' });
        }
        return res.status(502).json({ error: error.message ?? 'Failed to reach the target URL.' });
    } finally {
        clearTimeout(timeoutHandle);
    }
});

export default router;
