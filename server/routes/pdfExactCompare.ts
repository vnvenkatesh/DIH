// ---------------------------------------------------------------------------
// POST /v1/pdf-exact-compare
//
// Compares two uploaded PDFs page-by-page using word-level exact diffing.
// No AI involved. Mirrors /v1/pdf-compare but mode is always 'exact'.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { diffWordsWithSpace } from 'diff';
import { extractPagesText } from '../lib/pdf.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface PageDiff {
    page: number;
    type: 'removed' | 'added' | 'modified';
    textA: string;
    textB: string;
    reason: null;
}

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const fileA = files?.['fileA']?.[0];
    const fileB = files?.['fileB']?.[0];

    if (!fileA) { res.status(400).json({ error: 'fileA is required.' }); return; }
    if (!fileB) { res.status(400).json({ error: 'fileB is required.' }); return; }

    try {
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
            const changes = diffWordsWithSpace(textA, textB);
            let pendingRemoved: string | null = null;

            for (const change of changes) {
                if (change.removed) {
                    if (pendingRemoved !== null) {
                        differences.push({ page: pageNum, type: 'removed', textA: pendingRemoved, textB: '', reason: null });
                    }
                    pendingRemoved = change.value;
                } else if (change.added) {
                    if (pendingRemoved !== null) {
                        differences.push({ page: pageNum, type: 'modified', textA: pendingRemoved, textB: change.value, reason: null });
                        pendingRemoved = null;
                    } else {
                        differences.push({ page: pageNum, type: 'added', textA: '', textB: change.value, reason: null });
                    }
                } else {
                    if (pendingRemoved !== null) {
                        differences.push({ page: pageNum, type: 'removed', textA: pendingRemoved, textB: '', reason: null });
                        pendingRemoved = null;
                    }
                }
            }

            if (pendingRemoved !== null) {
                differences.push({ page: pageNum, type: 'removed', textA: pendingRemoved, textB: '', reason: null });
            }
        }

        res.json({ totalDifferences: differences.length, differences });
    } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}

router.use(requireAuth);
router.use(upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]));
router.post('/', handler);

export default router;
