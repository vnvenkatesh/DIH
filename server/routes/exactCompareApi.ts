// ---------------------------------------------------------------------------
// POST /v1/api/exact-compare
//
// Public API: Basic-Auth-protected exact PDF comparison.
// diffMode form field controls depth:
//   simple  (default) – text diff + font size & style
//   precise            – simple + best-effort fill-colour
// ---------------------------------------------------------------------------

import { Router, Response } from 'express';
import multer from 'multer';
import { diffWordsWithSpace } from 'diff';
import { extractPagesText } from '../lib/pdf.js';
import { requireBasicAuth, BasicAuthRequest } from '../middleware/basicAuth.js';
import {
    extractPagesWithFontData,
    compareFontPages,
    FontDiff,
} from '../lib/pdfFont.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

type DiffType = 'added' | 'removed' | 'modified' | 'Font' | 'Color';
type Position = 'Top' | 'Middle' | 'Bottom';
type Severity = 'Major' | 'Minor';

interface ExactDiff {
    diffID: number;
    PageNumber: number;
    typeOfDiff: DiffType;
    positionInPage: Position;
    diffSeverity: Severity;
    textA: string;
    textB: string;
    reason?: string;
}

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function severity(text: string): Severity {
    return wordCount(text) >= 5 ? 'Major' : 'Minor';
}

function withPositions(diffs: Omit<ExactDiff, 'positionInPage'>[]): ExactDiff[] {
    const total = diffs.length;
    return diffs.map((d, i) => {
        const ratio = total <= 1 ? 0 : i / (total - 1);
        const positionInPage: Position = ratio < 1 / 3 ? 'Top' : ratio < 2 / 3 ? 'Middle' : 'Bottom';
        return { ...d, positionInPage };
    });
}

router.post(
    '/',
    requireBasicAuth,
    upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]),
    async (req: BasicAuthRequest, res: Response): Promise<void> => {
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
            let diffID = 1;

            // Collect page-level raw diffs before assigning positions
            const pageBuckets: Omit<ExactDiff, 'positionInPage'>[][] = Array.from({ length: numPages }, () => []);

            // ------------------------------------------------------------------
            // Text diff
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
                            pageBuckets[p].push({ diffID: diffID++, PageNumber: pageNum, typeOfDiff: 'removed', diffSeverity: severity(pendingRemoved), textA: pendingRemoved, textB: '' });
                        }
                        pendingRemoved = change.value;
                    } else if (change.added) {
                        if (pendingRemoved !== null) {
                            const t = wordCount(pendingRemoved) >= wordCount(change.value) ? pendingRemoved : change.value;
                            pageBuckets[p].push({ diffID: diffID++, PageNumber: pageNum, typeOfDiff: 'modified', diffSeverity: severity(t), textA: pendingRemoved, textB: change.value });
                            pendingRemoved = null;
                        } else {
                            pageBuckets[p].push({ diffID: diffID++, PageNumber: pageNum, typeOfDiff: 'added', diffSeverity: severity(change.value), textA: '', textB: change.value });
                        }
                    } else {
                        if (pendingRemoved !== null) {
                            pageBuckets[p].push({ diffID: diffID++, PageNumber: pageNum, typeOfDiff: 'removed', diffSeverity: severity(pendingRemoved), textA: pendingRemoved, textB: '' });
                            pendingRemoved = null;
                        }
                    }
                }
                if (pendingRemoved !== null) {
                    pageBuckets[p].push({ diffID: diffID++, PageNumber: pageNum, typeOfDiff: 'removed', diffSeverity: severity(pendingRemoved), textA: pendingRemoved, textB: '' });
                }
            }

            // ------------------------------------------------------------------
            // Font diff
            // ------------------------------------------------------------------
            if (diffMode === 'simple' || diffMode === 'precise') {
                const [fontPagesA, fontPagesB] = await Promise.all([
                    extractPagesWithFontData(fileA.buffer),
                    extractPagesWithFontData(fileB.buffer),
                ]);
                const fontDiffs: FontDiff[] = compareFontPages(fontPagesA, fontPagesB, numPages);
                for (const fd of fontDiffs) {
                    const p = fd.page - 1;
                    pageBuckets[p].push({
                        diffID: diffID++,
                        PageNumber: fd.page,
                        typeOfDiff: fd.type === 'color' ? 'Color' : 'Font',
                        diffSeverity: 'Minor',
                        textA: fd.textA,
                        textB: fd.textB,
                        reason: fd.reason,
                    });
                }
            }

            const allDiffs = pageBuckets.flatMap(withPositions);

            res.json({
                areDocumentsSame: allDiffs.length === 0 ? 'Yes' : 'No',
                differences: { difference: allDiffs },
            });
        } catch (err: unknown) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    }
);

export default router;
