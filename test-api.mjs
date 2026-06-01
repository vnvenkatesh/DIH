/**
 * Run with: node test-api.mjs
 * Tests Gemini API connectivity and your API key from Node.js (no browser, no CORS).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read API key from .env.local
let apiKey = '';
try {
    const env = readFileSync(join(__dirname, '.env.local'), 'utf8');
    const match = env.match(/GEMINI_API_KEY=(.+)/);
    apiKey = match ? match[1].trim() : '';
} catch {
    console.error('Could not read .env.local');
    process.exit(1);
}

if (!apiKey) {
    console.error('GEMINI_API_KEY not found in .env.local');
    process.exit(1);
}

console.log(`API key found: ${apiKey.slice(0, 8)}...`);
console.log('Calling Gemini API...\n');

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

try {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply with exactly: {"ok":true}' }] }],
            generationConfig: { responseMimeType: 'application/json' },
        }),
    });

    const body = await res.json();

    if (!res.ok) {
        console.error('API error:', res.status, body?.error?.message || JSON.stringify(body));
        process.exit(1);
    }

    const text = body?.candidates?.[0]?.content?.parts?.find(p => !p.thought)?.text ?? '';
    console.log('Response:', text);
    console.log('\nResult: API key and network are working from Node.js.');
    console.log('If the browser still fails, the issue is CORS/firewall — the Vite proxy should fix it.');
} catch (err) {
    console.error('\nFetch failed:', err.message);
    console.log('\nThis means Node.js also cannot reach googleapis.com.');
    console.log('Your corporate network may require a proxy. Set HTTP_PROXY / HTTPS_PROXY env vars and retry.');
}
