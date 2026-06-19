// ---------------------------------------------------------------------------
// POST /v1/api/exact-compare
//
// Public API endpoint that compares two uploaded PDFs using word-level exact
// diffing. Protected by HTTP Basic Auth (username + password against the DB).
// ---------------------------------------------------------------------------

import { Router, Response } from 'express';
import multer from 'multer';
import { diffWordsWithSpace } from 'diff';
import { extractPagesText } from '../lib/pdf.js';
import { requireBasicAuth, BasicAuthRequest } from '../middleware/basicAuth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiffType = 'added' | 'removed' | 'modified';
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function severity(text: string): Severity {
    return wordCount(text) >= 5 ? 'Major' : 'Minor';
}

// Assigns Top/Middle/Bottom based on each diff's rank within its page's diffs.
function withPositions(diffs: Omit<ExactDiff, 'positionInPage'>[]): ExactDiff[] {
    const total = diffs.length;
    return diffs.map((d, i) => {
        const ratio = total <= 1 ? 0 : i / (total - 1);
        const positionInPage: Position = ratio < 1 / 3 ? 'Top' : ratio < 2 / 3 ? 'Middle' : 'Bottom';
        return { ...d, positionInPage };
    });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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

        try {
            const [pagesA, pagesB] = await Promise.all([
                extractPagesText(fileA.buffer),
                extractPagesText(fileB.buffer),
            ]);

            const numPages = Math.max(pagesA.length, pagesB.length);
            let diffID = 1;
            const allDiffs: ExactDiff[] = [];

            for (let p = 0; p < numPages; p++) {
                const pageNum = p + 1;
                const textA = pagesA[p] ?? '';
                const textB = pagesB[p] ?? '';
                const changes = diffWordsWithSpace(textA, textB);
                const pageDiffs: Omit<ExactDiff, 'positionInPage'>[] = [];
                let pendingRemoved: string | null = null;

                for (const change of changes) {
                    if (change.removed) {
                        if (pendingRemoved !== null) {
                            pageDiffs.push({
                                diffID: diffID++,
                                PageNumber: pageNum,
                                typeOfDiff: 'removed',
                                diffSeverity: severity(pendingRemoved),
                                textA: pendingRemoved,
                                textB: '',
                            });
                        }
                        pendingRemoved = change.value;
                    } else if (change.added) {
                        if (pendingRemoved !== null) {
                            // Removal immediately followed by addition — treat as modification
                            const changedText = wordCount(pendingRemoved) >= wordCount(change.value)
                                ? pendingRemoved
                                : change.value;
                            pageDiffs.push({
                                diffID: diffID++,
                                PageNumber: pageNum,
                                typeOfDiff: 'modified',
                                diffSeverity: severity(changedText),
                                textA: pendingRemoved,
                                textB: change.value,
                            });
                            pendingRemoved = null;
                        } else {
                            pageDiffs.push({
                                diffID: diffID++,
                                PageNumber: pageNum,
                                typeOfDiff: 'added',
                                diffSeverity: severity(change.value),
                                textA: '',
                                textB: change.value,
                            });
                        }
                    } else {
                        if (pendingRemoved !== null) {
                            pageDiffs.push({
                                diffID: diffID++,
                                PageNumber: pageNum,
                                typeOfDiff: 'removed',
                                diffSeverity: severity(pendingRemoved),
                                textA: pendingRemoved,
                                textB: '',
                            });
                            pendingRemoved = null;
                        }
                    }
                }

                if (pendingRemoved !== null) {
                    pageDiffs.push({
                        diffID: diffID++,
                        PageNumber: pageNum,
                        typeOfDiff: 'removed',
                        diffSeverity: severity(pendingRemoved),
                        textA: pendingRemoved,
                        textB: '',
                    });
                }

                allDiffs.push(...withPositions(pageDiffs));
            }

            res.json({
                areDocumentsSame: allDiffs.length === 0 ? 'Yes' : 'No',
                differences: {
                    difference: allDiffs,
                },
            });
        } catch (err: unknown) {
            res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
        }
    }
);

export default router;
