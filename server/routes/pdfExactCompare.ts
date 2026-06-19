// ---------------------------------------------------------------------------
// POST /v1/pdf-exact-compare
//
// No-AI exact comparison of two PDFs. Always word-level text diff.
// Optional font/color detection controlled by the `diffMode` field:
//   simple  (default) – text diff + font size & style comparison
//   precise            – simple + best-effort fill-colour comparison
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { diffWordsWithSpace } from 'diff';
import { extractPagesText } from '../lib/pdf.js';
import { requireAuth } from '../middleware/auth.js';
import {
    extractPagesWithFontData,
    compareFontPages,
    FontDiff,
} from '../lib/pdfFont.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

interface PageDiff {
    page: number;
    type: 'removed' | 'added' | 'modified' | 'font' | 'color';
    textA: string;
    textB: string;
    reason: string | null;
}

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const fileA = files?.['fileA']?.[0];
    const fileB = files?.['fileB']?.[0];

    if (!fileA) { res.status(400).json({ error: 'fileA is required.' }); return; }
    if (!fileB) { res.status(400).json({ error: 'fileB is required.' }); return; }

    const diffMode: string = (req.body?.diffMode as string) || 'simple';

    try {
        const [pagesA, pagesB] = await Promise.all([
            extractPagesText(fileA.buffer),
            extractPagesText(fileB.buffer),
        ]);

        const numPages = Math.max(pagesA.length, pagesB.length);
        const differences: PageDiff[] = [];

        // ------------------------------------------------------------------
        // Text diff (word-level, page-by-page)
        // ------------------------------------------------------------------
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

        // ------------------------------------------------------------------
        // Font diff (simple + precise)
        // ------------------------------------------------------------------
        if (diffMode === 'simple' || diffMode === 'precise') {
            const [fontPagesA, fontPagesB] = await Promise.all([
                extractPagesWithFontData(fileA.buffer),
                extractPagesWithFontData(fileB.buffer),
            ]);
            const fontDiffs: FontDiff[] = compareFontPages(fontPagesA, fontPagesB, numPages);
            for (const fd of fontDiffs) {
                differences.push({ page: fd.page, type: fd.type, textA: fd.textA, textB: fd.textB, reason: fd.reason });
            }
        }

        differences.sort((a, b) => a.page - b.page);
        res.json({ totalDifferences: differences.length, differences });
    } catch (err: unknown) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
}

router.use(requireAuth);
router.use(upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]));
router.post('/', handler);

export default router;
