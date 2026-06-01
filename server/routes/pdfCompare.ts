// ---------------------------------------------------------------------------
// POST /v1/pdf-compare
//
// Compares two uploaded PDFs page-by-page using either semantic AI comparison
// or word-level exact diffing, mirroring the browser PdfCompare tool.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { diffWordsWithSpace } from 'diff';
import { callGemini, extractJsonText, SEMANTIC_COMPARE_PROMPT } from '../gemini.js';
import { extractPagesText } from '../lib/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageDiff {
    page: number;
    type: 'semantic' | 'removed' | 'added' | 'modified';
    textA: string;
    textB: string;
    reason: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const fileA = files?.['fileA']?.[0];
    const fileB = files?.['fileB']?.[0];

    if (!fileA) {
        res.status(400).json({ error: 'fileA is required.' });
        return;
    }
    if (!fileB) {
        res.status(400).json({ error: 'fileB is required.' });
        return;
    }

    try {
        const mode: string = (req.body.mode as string) || 'semantic';

        // ------------------------------------------------------------------
        // Extract page texts from both PDFs
        // ------------------------------------------------------------------
        const [pagesA, pagesB] = await Promise.all([
            extractPagesText(fileA.buffer),
            extractPagesText(fileB.buffer),
        ]);

        const numPages = Math.max(pagesA.length, pagesB.length);
        const differences: PageDiff[] = [];

        for (let p = 0; p < numPages; p++) {
            const pageNum = p + 1;
            const textA = pagesA[p] ?? '';
            const textB = pagesB[p] ?? '';

            if (mode === 'semantic') {
                // ------------------------------------------------------------
                // Semantic mode — delegate to Gemini
                // ------------------------------------------------------------
                const result = await callGemini(
                    'gemini-2.5-flash',
                    [{
                        parts: [
                            { text: SEMANTIC_COMPARE_PROMPT },
                            { text: `\n\n--- Page A ---\n\n${textA}` },
                            { text: `\n\n--- Page B ---\n\n${textB}` },
                        ],
                    }],
                    {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    textA: { type: 'STRING' },
                                    textB: { type: 'STRING' },
                                    reason: { type: 'STRING' },
                                },
                                required: ['textA', 'textB', 'reason'],
                            },
                        },
                    }
                );

                const semanticDiffs = JSON.parse(extractJsonText(result)) as Array<{
                    textA: string;
                    textB: string;
                    reason: string;
                }>;

                for (const d of semanticDiffs) {
                    differences.push({
                        page: pageNum,
                        type: 'semantic',
                        textA: d.textA,
                        textB: d.textB,
                        reason: d.reason,
                    });
                }
            } else {
                // ------------------------------------------------------------
                // Exact mode — word-level diff
                // ------------------------------------------------------------
                const changes = diffWordsWithSpace(textA, textB);

                // Collect adjacent removed/added pairs so they can be reported
                // as "modified" when they appear next to each other.
                let pendingRemoved: string | null = null;

                for (const change of changes) {
                    if (change.removed) {
                        if (pendingRemoved !== null) {
                            // Two consecutive removals — emit the previous one
                            differences.push({
                                page: pageNum,
                                type: 'removed',
                                textA: pendingRemoved,
                                textB: '',
                                reason: null,
                            });
                        }
                        pendingRemoved = change.value;
                    } else if (change.added) {
                        if (pendingRemoved !== null) {
                            // Removal followed by addition — this is a modification
                            differences.push({
                                page: pageNum,
                                type: 'modified',
                                textA: pendingRemoved,
                                textB: change.value,
                                reason: null,
                            });
                            pendingRemoved = null;
                        } else {
                            differences.push({
                                page: pageNum,
                                type: 'added',
                                textA: '',
                                textB: change.value,
                                reason: null,
                            });
                        }
                    } else {
                        // Unchanged chunk — flush any pending removal
                        if (pendingRemoved !== null) {
                            differences.push({
                                page: pageNum,
                                type: 'removed',
                                textA: pendingRemoved,
                                textB: '',
                                reason: null,
                            });
                            pendingRemoved = null;
                        }
                    }
                }

                // Flush any trailing removal
                if (pendingRemoved !== null) {
                    differences.push({
                        page: pageNum,
                        type: 'removed',
                        textA: pendingRemoved,
                        textB: '',
                        reason: null,
                    });
                }
            }
        }

        res.json({ totalDifferences: differences.length, differences });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
}

router.use(upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]));
router.post('/', handler);

export default router;
