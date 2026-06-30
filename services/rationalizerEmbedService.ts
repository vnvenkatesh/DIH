// Rationalizer-specific embedding service.
//
// Uses the Gemini text-embedding-004 model (real semantic embeddings) via the
// server-side /v1/rationalizer/embed proxy. Falls back to a local keyword-hash
// approach (identical to the original geminiService.embedContentBatch) when the
// API key is absent or the API call fails — so the Rationalizer continues to
// work offline or without a configured key, just with lower-quality grouping.
//
// REVERT: To go back to keyword-hash-only behaviour, change the import in
// Rationalizer.tsx from '../services/rationalizerEmbedService' back to
// '../services/llmService'.

import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

// ---------------------------------------------------------------------------
// Keyword-hash fallback (mirrors geminiService.ts generateKeywordEmbedding)
// ---------------------------------------------------------------------------

function keywordEmbedFallback(text: string): number[] {
    const vector = new Array(768).fill(0);
    const words = text.toLowerCase().match(/\w+/g) || [];
    for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash |= 0;
        }
        vector[Math.abs(hash) % 768] += 1;
    }
    const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

function getGeminiApiKey(): string {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        return (s.geminiApiKey as string) || '';
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacement for llmService.embedContentBatch
// ---------------------------------------------------------------------------

export async function embedContentBatch(textChunks: string[]): Promise<number[][]> {
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
        console.warn('[Rationalizer] No Gemini API key configured — using keyword-hash fallback for embeddings.');
        return textChunks.map(chunk => keywordEmbedFallback(chunk));
    }

    try {
        const response = await fetch('/v1/rationalizer/embed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: textChunks, apiKey }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => String(response.status));
            throw new Error(`Embedding server returned ${response.status}: ${errText}`);
        }

        const data = await response.json() as { embeddings: number[][] };

        if (!Array.isArray(data.embeddings) || data.embeddings.length !== textChunks.length) {
            throw new Error('Unexpected embedding response shape from server');
        }

        console.info('[Rationalizer] Using real Gemini semantic embeddings (text-embedding-004).');
        return data.embeddings;
    } catch (err) {
        console.warn('[Rationalizer] Semantic embedding API failed — falling back to keyword hash:', err);
        return textChunks.map(chunk => keywordEmbedFallback(chunk));
    }
}
