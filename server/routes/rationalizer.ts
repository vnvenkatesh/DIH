// ---------------------------------------------------------------------------
// POST /v1/rationalizer
//
// Accepts multiple PDF uploads and groups them by exact content hash or by
// semantic (keyword-embedding) similarity, mirroring the browser Rationalizer.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { extractFullText } from '../lib/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Keyword-based embedding (matches geminiService.ts embedContentBatch logic)
// ---------------------------------------------------------------------------

/**
 * Produce a 768-dimensional keyword-frequency vector for the supplied text,
 * then L2-normalise it so cosine similarity equals the dot product.
 */
function generateKeywordEmbedding(text: string): number[] {
    const vector = new Array<number>(768).fill(0);
    const words = text.toLowerCase().match(/\w+/g);
    if (!words || words.length === 0) return vector;

    for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash |= 0; // Convert to 32-bit integer
        }
        vector[Math.abs(hash) % 768] += 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map(v => v / magnitude) : vector;
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessedDoc {
    filename: string;
    pageCount: number;
    text: string;
    hash?: string;
    embedding?: number[];
}

interface DocumentSummary {
    filename: string;
    pageCount: number;
}

interface GroupResult {
    id: number;
    similarity: number;
    documents: DocumentSummary[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length < 2) {
        res.status(400).json({ error: 'At least two PDF files are required.' });
        return;
    }

    try {
        const mode: string = (req.body.mode as string) || 'semantic';
        const threshold = Number(req.body.similarityThreshold ?? 80) / 100;

        // ------------------------------------------------------------------
        // Step 1: Extract text from every uploaded PDF
        // ------------------------------------------------------------------
        const docs: ProcessedDoc[] = await Promise.all(
            files.map(async (file) => {
                const { text, pageCount } = await extractFullText(file.buffer);
                const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
                return { filename: file.originalname, pageCount, text: normalized };
            })
        );

        let groups: GroupResult[] = [];

        if (mode === 'exact') {
            // ----------------------------------------------------------------
            // Exact mode: group by SHA-256 hash of normalized text
            // ----------------------------------------------------------------
            const hashMap = new Map<string, ProcessedDoc[]>();

            for (const doc of docs) {
                const hash = crypto.createHash('sha256').update(doc.text).digest('hex');
                doc.hash = hash;
                if (!hashMap.has(hash)) hashMap.set(hash, []);
                hashMap.get(hash)!.push(doc);
            }

            let id = 0;
            for (const bucket of hashMap.values()) {
                if (bucket.length > 1) {
                    groups.push({
                        id: id++,
                        similarity: 100,
                        documents: bucket.map(d => ({ filename: d.filename, pageCount: d.pageCount })),
                    });
                }
            }
        } else {
            // ----------------------------------------------------------------
            // Semantic mode: keyword embeddings + agglomerative clustering
            // ----------------------------------------------------------------
            for (const doc of docs) {
                doc.embedding = generateKeywordEmbedding(doc.text || 'empty document');
            }

            // Build initial clusters — one doc per cluster
            const clusters: ProcessedDoc[][] = docs.map(d => [d]);

            // Pre-compute all pairwise similarities
            const similarities: Array<{ i: number; j: number; sim: number }> = [];
            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const sim = cosineSimilarity(clusters[i][0].embedding!, clusters[j][0].embedding!);
                    similarities.push({ i, j, sim });
                }
            }
            similarities.sort((a, b) => b.sim - a.sim);

            const merged = new Array<boolean>(clusters.length).fill(false);
            const finalClusters: ProcessedDoc[][] = [];

            for (const { i, j, sim } of similarities) {
                if (sim < threshold) break;

                if (!merged[i] && !merged[j]) {
                    // Both unmerged — form a new cluster
                    merged[i] = true;
                    merged[j] = true;
                    finalClusters.push([...clusters[i], ...clusters[j]]);
                } else if (merged[i] && !merged[j]) {
                    // i already in a cluster — absorb j into it
                    const idx = finalClusters.findIndex(c => c.includes(clusters[i][0]));
                    if (idx !== -1) {
                        finalClusters[idx].push(...clusters[j]);
                        merged[j] = true;
                    }
                } else if (!merged[i] && merged[j]) {
                    // j already in a cluster — absorb i into it
                    const idx = finalClusters.findIndex(c => c.includes(clusters[j][0]));
                    if (idx !== -1) {
                        finalClusters[idx].push(...clusters[i]);
                        merged[i] = true;
                    }
                }
            }

            // Build output groups; only emit groups with 2+ docs that meet threshold
            let id = 0;
            for (const bucket of finalClusters) {
                if (bucket.length < 2) continue;

                const firstEmb = bucket[0].embedding!;
                const avgSim =
                    bucket.slice(1).reduce(
                        (sum, d) => sum + cosineSimilarity(firstEmb, d.embedding!),
                        0
                    ) / (bucket.length - 1);

                const simPct = Math.round(avgSim * 100);
                if (simPct >= threshold * 100) {
                    groups.push({
                        id: id++,
                        similarity: simPct,
                        documents: bucket.map(d => ({ filename: d.filename, pageCount: d.pageCount })),
                    });
                }
            }
        }

        res.json({ groups });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
}

router.use(upload.array('files'));
router.post('/', handler);

export default router;
