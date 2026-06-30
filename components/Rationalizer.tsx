
import React, { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { DocumentGroup, ProcessedDocument, ClauseMatch } from '../types';
import { embedContentBatch } from '../services/llmService';
import ToggleSwitch from './ToggleSwitch';
import { Squares2X2Icon } from './icons/Squares2X2Icon';

interface RationalizerProps {
    onCompareRequest: (files: [File, File]) => void;
}

// ─── Cosine similarity for document-level semantic grouping ──────────────────

const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0.0, normA = 0.0, normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
};

// ─── Repeated-clause detection: Jaccard similarity on word sets ──────────────
//
// We use Jaccard rather than AI embeddings because:
//   • No API call — fast, no quota consumption.
//   • Formal/legal language repeats phrases near-verbatim; Jaccard on word
//     sets is well-suited for this overlap pattern.
//   • Same-document duplicates (user requirement) are detected naturally
//     by comparing all clause pairs, not just cross-document pairs.
//
// Threshold of 0.65 catches paraphrases while filtering unrelated text.
// Clause windows of 3 sentences with a 1-sentence overlap ensure clauses
// that straddle arbitrary segmentation boundaries are still matched.

const CLAUSE_JACCARD_THRESHOLD = 0.65;
const CLAUSE_MIN_CHARS = 80;  // discard very short fragments (headers, labels)
const CLAUSE_WINDOW_SIZE = 3; // sentences per logical clause group
const CLAUSE_STEP_SIZE = 2;   // sliding step (1-sentence overlap between windows)

// Common English words excluded from Jaccard tokens so matching focuses
// on content words rather than grammatical glue.
const STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'by','from','is','are','was','were','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'this','that','these','those','it','its','as','if','not','no','so',
    'than','then','when','where','which','who','what','how','into','up',
    'out','about','after','before','between','through','during','our','your',
    'their','we','they','he','she','i','you','his','her','all','any',
    'each','every','both','either','neither','other','such','more','most',
    'much','many','some','few','own','same','just','also','only','over',
    'under','again','further','there','here','once','can','us','am',
]);

// Split text into sentences on punctuation boundaries.
// PDF extraction lowercases all text, so capital-letter heuristics cannot
// be used; splitting on [.!?]+ followed by whitespace is the best we can do.
function splitSentences(text: string): string[] {
    return text
        .split(/[.!?]+\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 15);
}

// Build clause windows from a document's text.
// Each window is CLAUSE_WINDOW_SIZE consecutive sentences joined with '. '.
// Windows slide by CLAUSE_STEP_SIZE so adjacent windows share one sentence,
// preventing repeated content from being missed due to arbitrary cut points.
function extractClauses(text: string): string[] {
    const sentences = splitSentences(text);
    const clauses: string[] = [];
    for (let i = 0; i < sentences.length; i += CLAUSE_STEP_SIZE) {
        const clause = sentences.slice(i, i + CLAUSE_WINDOW_SIZE).join('. ').trim();
        if (clause.length >= CLAUSE_MIN_CHARS) {
            clauses.push(clause);
        }
    }
    return clauses;
}

function tokenize(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const word of a) {
        if (b.has(word)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
}

// Detect clauses that repeat within or across documents.
//
// Algorithm: greedy grouping.
//   1. Build a flat corpus of all clauses tagged with their document index.
//   2. For each unassigned clause i, scan forward for any unassigned clause j
//      with Jaccard ≥ CLAUSE_JACCARD_THRESHOLD.  Assign all matches to
//      the same group (representative = clause i).
//   3. Groups with ≥ 2 members are reported as repeated clauses.
//
// Same-document repeats are included (per product requirement) because
// the comparison runs over all pairs regardless of document origin.
function detectRepeatedClauses(processedDocs: ProcessedDocument[]): ClauseMatch[] {
    const corpus: Array<{ docIndex: number; text: string; tokens: Set<string> }> = [];

    for (let d = 0; d < processedDocs.length; d++) {
        for (const clause of extractClauses(processedDocs[d].text)) {
            corpus.push({ docIndex: d, text: clause, tokens: tokenize(clause) });
        }
    }

    const assigned = new Set<number>();
    const matches: ClauseMatch[] = [];

    for (let i = 0; i < corpus.length; i++) {
        if (assigned.has(i)) continue;
        assigned.add(i);

        const group: number[] = [i];
        for (let j = i + 1; j < corpus.length; j++) {
            if (assigned.has(j)) continue;
            if (jaccardSimilarity(corpus[i].tokens, corpus[j].tokens) >= CLAUSE_JACCARD_THRESHOLD) {
                group.push(j);
                assigned.add(j);
            }
        }

        if (group.length < 2) continue;

        // Count occurrences per document name (same doc may contribute multiple)
        const occMap = new Map<string, number>();
        for (const idx of group) {
            const name = processedDocs[corpus[idx].docIndex].file.name;
            occMap.set(name, (occMap.get(name) ?? 0) + 1);
        }

        matches.push({
            text: corpus[i].text,
            occurrences: Array.from(occMap.entries()).map(([documentName, count]) => ({
                documentName,
                count,
            })),
            totalCount: group.length,
        });
    }

    return matches.sort((a, b) => b.totalCount - a.totalCount);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const GroupCard: React.FC<{ group: DocumentGroup; onCompareRequest: (files: [File, File]) => void }> = ({
    group,
    onCompareRequest,
}) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    const handleSelectionChange = (file: File) => {
        setSelectedFiles(prev => {
            if (prev.includes(file)) return prev.filter(f => f !== file);
            if (prev.length < 2) return [...prev, file];
            return prev;
        });
    };

    const handleCompare = () => {
        if (selectedFiles.length === 2) onCompareRequest(selectedFiles as [File, File]);
    };

    return (
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-3">
                <p className="font-bold text-indigo-600 dark:text-indigo-400">
                    Group {group.id + 1} — {group.documents.length} Documents
                    <span className="ml-2 text-sm font-medium text-white bg-indigo-500 dark:bg-indigo-600 px-2 py-0.5 rounded-full">
                        {group.similarity}% similar
                    </span>
                </p>
                <button
                    onClick={handleCompare}
                    disabled={selectedFiles.length !== 2}
                    className="bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded-md hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                >
                    Compare Selected ({selectedFiles.length})
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex justify-center items-center bg-slate-200 dark:bg-slate-900 p-2 rounded-md">
                    <img src={group.documents[0].thumbnail} alt="Document thumbnail" className="max-w-full h-auto shadow-md" />
                </div>
                <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 overflow-y-auto max-h-48">
                    {group.documents.map(doc => (
                        <li key={doc.file.name}>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedFiles.includes(doc.file)}
                                    onChange={() => handleSelectionChange(doc.file)}
                                    disabled={!selectedFiles.includes(doc.file) && selectedFiles.length >= 2}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                                />
                                <span>{doc.file.name}</span>
                            </label>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const ClauseCard: React.FC<{ match: ClauseMatch }> = ({ match }) => {
    const [expanded, setExpanded] = useState(false);
    const PREVIEW_LEN = 220;
    const isLong = match.text.length > PREVIEW_LEN;
    const displayText = expanded || !isLong ? match.text : match.text.slice(0, PREVIEW_LEN) + '…';

    const docCount = match.occurrences.length;
    const crossDoc = docCount > 1;

    return (
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {match.totalCount} occurrence{match.totalCount !== 1 ? 's' : ''}
                </span>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                    {crossDoc
                        ? `across ${docCount} documents`
                        : `within the same document`}
                </span>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
                {match.occurrences.map(occ => (
                    <span
                        key={occ.documentName}
                        className="inline-flex items-center gap-1 text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full max-w-xs truncate"
                        title={occ.documentName}
                    >
                        {occ.documentName}
                        {occ.count > 1 && (
                            <span className="font-bold bg-indigo-200 dark:bg-indigo-800 px-1 rounded-full">
                                ×{occ.count}
                            </span>
                        )}
                    </span>
                ))}
            </div>

            <div className="text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-600 leading-relaxed font-mono">
                {displayText}
                {isLong && (
                    <button
                        onClick={() => setExpanded(e => !e)}
                        className="ml-2 text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-200 font-sans text-xs"
                    >
                        {expanded ? 'Show less' : 'Show more'}
                    </button>
                )}
            </div>
        </div>
    );
};

// ─── Main component ──────────────────────────────────────────────────────────

const Rationalizer: React.FC<RationalizerProps> = ({ onCompareRequest }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [groupingMode, setGroupingMode] = useState<'exact' | 'semantic'>('semantic');
    const [similarityThreshold, setSimilarityThreshold] = useState<number>(80);
    const [results, setResults] = useState<DocumentGroup[] | null>(null);
    const [repeatedClauses, setRepeatedClauses] = useState<ClauseMatch[] | null>(null);
    const [activeTab, setActiveTab] = useState<'groups' | 'clauses'>('groups');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;
    }, []);

    const handleMultiFileChange = (selectedFiles: FileList | null) => {
        if (selectedFiles) setFiles(Array.from(selectedFiles));
    };

    const processPdf = async (file: File): Promise<ProcessedDocument> => {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        const textContent: string[] = [];
        const numPages = pdf.numPages || 0;
        console.log(`Processing ${file.name}: reported ${numPages} pages`);

        for (let i = 1; i <= numPages; i++) {
            try {
                if (i > pdf.numPages) {
                    console.warn(`Skipping page ${i} of ${file.name} as it exceeds current numPages (${pdf.numPages})`);
                    break;
                }
                const page = await pdf.getPage(i);
                const tc = await page.getTextContent();
                textContent.push(tc.items.map(item => ('str' in item ? item.str : '')).join(' '));
            } catch (pageErr) {
                console.error(`Error processing page ${i} of ${file.name}`, pageErr);
            }
        }

        // Keep newlines between pages so sentence segmentation has page-level
        // structure, but collapse intra-page whitespace.
        const fullText = textContent
            .map(p => p.trim().toLowerCase().replace(/\s+/g, ' '))
            .filter(p => p.length > 0)
            .join('\n');

        let thumbnail = '';
        if (numPages > 0) {
            try {
                const firstPage = await pdf.getPage(1);
                const viewport = firstPage.getViewport({ scale: 0.3 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                if (context) {
                    await firstPage.render({ canvasContext: context, viewport } as any).promise;
                    thumbnail = canvas.toDataURL();
                }
            } catch (thumbErr) {
                console.error(`Error generating thumbnail for ${file.name}`, thumbErr);
            }
        }

        await pdf.destroy();
        return { file, text: fullText, thumbnail };
    };

    const handleProcess = useCallback(async () => {
        if (files.length < 2) {
            setError('Please select at least two PDF files to rationalize.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setResults(null);
        setRepeatedClauses(null);

        try {
            const processedDocs: ProcessedDocument[] = [];
            for (let i = 0; i < files.length; i++) {
                setLoadingMessage(`Processing document ${i + 1} of ${files.length}: ${files[i].name}`);
                processedDocs.push(await processPdf(files[i]));
            }

            let groups: DocumentGroup[] = [];

            if (groupingMode === 'exact') {
                setLoadingMessage('Calculating hashes…');
                const hashGroups: { [key: string]: ProcessedDocument[] } = {};
                for (const doc of processedDocs) {
                    const buffer = new TextEncoder().encode(doc.text);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
                    const hashHex = Array.from(new Uint8Array(hashBuffer))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    if (!hashGroups[hashHex]) hashGroups[hashHex] = [];
                    hashGroups[hashHex].push(doc);
                }
                groups = Object.values(hashGroups)
                    .filter(g => g.length > 1)
                    .map((docs, i) => ({ id: i, documents: docs, similarity: 100 }));
            } else {
                setLoadingMessage('Generating AI embeddings…');
                const docsToEmbed = processedDocs.map(d => d.text.trim() || 'empty document');
                const embeddings = await embedContentBatch(docsToEmbed);
                for (let i = 0; i < processedDocs.length; i++) {
                    processedDocs[i].embedding = embeddings[i];
                }

                setLoadingMessage('Clustering documents…');
                const clusters: ProcessedDocument[][] = processedDocs.map(doc => [doc]);
                const similarities: { i: number; j: number; sim: number }[] = [];

                for (let i = 0; i < clusters.length; i++) {
                    for (let j = i + 1; j < clusters.length; j++) {
                        similarities.push({
                            i,
                            j,
                            sim: cosineSimilarity(clusters[i][0].embedding!, clusters[j][0].embedding!),
                        });
                    }
                }
                similarities.sort((a, b) => b.sim - a.sim);

                const merged = new Array(clusters.length).fill(false);
                const finalClusters: ProcessedDocument[][] = [];
                const threshold = similarityThreshold / 100;

                for (const { i, j, sim } of similarities) {
                    if (sim < threshold) break;
                    if (!merged[i] && !merged[j]) {
                        merged[i] = merged[j] = true;
                        finalClusters.push([...clusters[i], ...clusters[j]]);
                    } else if (merged[i] && !merged[j]) {
                        const idx = finalClusters.findIndex(c => c.includes(clusters[i][0]));
                        if (idx !== -1) { finalClusters[idx].push(...clusters[j]); merged[j] = true; }
                    } else if (!merged[i] && merged[j]) {
                        const idx = finalClusters.findIndex(c => c.includes(clusters[j][0]));
                        if (idx !== -1) { finalClusters[idx].push(...clusters[i]); merged[i] = true; }
                    }
                }
                for (let i = 0; i < clusters.length; i++) {
                    if (!merged[i]) finalClusters.push(clusters[i]);
                }

                groups = finalClusters
                    .filter(g => g.length > 1)
                    .map((docs, i) => {
                        const firstEmb = docs[0].embedding!;
                        const avgSim =
                            docs.length > 1
                                ? docs.slice(1).reduce((s, d) => s + cosineSimilarity(firstEmb, d.embedding!), 0) /
                                  (docs.length - 1)
                                : 0;
                        return { id: i, documents: docs, similarity: Math.round(avgSim * 100) };
                    })
                    .filter(g => g.similarity >= similarityThreshold);
            }

            // Detect repeated clauses (within and across documents)
            setLoadingMessage('Detecting repeated clauses…');
            const clauseMatches = detectRepeatedClauses(processedDocs);

            setResults(groups);
            setRepeatedClauses(clauseMatches);
            setActiveTab('groups');
        } catch (err: any) {
            console.error('Rationalization Error:', err);
            setError(
                `Rationalization failed: ${err.message || 'An unexpected error occurred'}. Please check your files and try again.`
            );
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [files, groupingMode, similarityThreshold]);

    const handleReset = () => {
        setFiles([]);
        setResults(null);
        setRepeatedClauses(null);
        setActiveTab('groups');
        setError(null);
        setIsLoading(false);
    };

    const hasResults = results !== null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                    <Squares2X2Icon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    Rationalizer
                </h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Group a collection of PDFs by exact content or semantic similarity, and surface repeated clauses.
                </p>
            </div>

            {/* ── Input form ── */}
            {!hasResults && !isLoading && (
                <div className="space-y-6">
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4">
                        <label htmlFor="multi-file-upload" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {files.length > 0 ? `${files.length} files selected` : 'Select Multiple PDF Files'}
                        </label>
                        <input
                            id="multi-file-upload"
                            type="file"
                            multiple
                            accept="application/pdf"
                            onChange={e => handleMultiFileChange(e.target.files)}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                        />
                        {files.length > 0 && (
                            <ul className="mt-3 text-xs list-disc list-inside text-slate-500 dark:text-slate-400 max-h-24 overflow-y-auto">
                                {files.map(f => <li key={f.name}>{f.name}</li>)}
                            </ul>
                        )}
                    </div>

                    <ToggleSwitch
                        leftLabel="Exact Content"
                        rightLabel="Semantic Closeness"
                        enabled={groupingMode === 'semantic'}
                        onChange={enabled => setGroupingMode(enabled ? 'semantic' : 'exact')}
                    />

                    {groupingMode === 'semantic' && (
                        <div className="space-y-2">
                            <label htmlFor="similarity-threshold" className="block text-sm font-medium text-center text-slate-700 dark:text-slate-300">
                                Similarity Threshold:{' '}
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">{similarityThreshold}%</span>
                            </label>
                            <input
                                id="similarity-threshold"
                                type="range"
                                min="70"
                                max="99"
                                value={similarityThreshold}
                                onChange={e => setSimilarityThreshold(Number(e.target.value))}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer dark:bg-slate-700"
                            />
                        </div>
                    )}

                    <div className="text-center">
                        <button
                            onClick={handleProcess}
                            disabled={files.length < 2}
                            className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100 inline-flex items-center gap-2"
                        >
                            <Squares2X2Icon className="w-5 h-5" />
                            Group Documents
                        </button>
                    </div>
                </div>
            )}

            {/* ── Loading ── */}
            {isLoading && (
                <div className="flex flex-col items-center justify-center p-10">
                    <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500"></div>
                    <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">{loadingMessage || 'Processing…'}</p>
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p>{error}</p>
                    <button onClick={handleReset} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors">
                        Try Again
                    </button>
                </div>
            )}

            {/* ── Results ── */}
            {hasResults && !isLoading && (
                <div>
                    {/* Tab bar */}
                    <div className="flex border-b border-slate-200 dark:border-slate-700 mb-6">
                        <button
                            onClick={() => setActiveTab('groups')}
                            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'groups'
                                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            Document Groups
                            {results && results.length > 0 && (
                                <span className="ml-2 text-xs font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full">
                                    {results.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('clauses')}
                            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                activeTab === 'clauses'
                                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            Repeated Clauses
                            {repeatedClauses && repeatedClauses.length > 0 && (
                                <span className="ml-2 text-xs font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded-full">
                                    {repeatedClauses.length}
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Document Groups tab */}
                    {activeTab === 'groups' && (
                        <div>
                            <div className="text-center mb-6">
                                <h3 className="text-xl font-bold">Document Groups</h3>
                                {results && results.length > 0 ? (
                                    <p className="text-slate-600 dark:text-slate-400">
                                        Found {results.length} group{results.length !== 1 ? 's' : ''} of similar documents.
                                    </p>
                                ) : (
                                    <p className="mt-4 text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                                        No groups of similar documents found with the current settings.
                                    </p>
                                )}
                            </div>
                            <div className="space-y-6">
                                {results && results.map(group => (
                                    <GroupCard key={group.id} group={group} onCompareRequest={onCompareRequest} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Repeated Clauses tab */}
                    {activeTab === 'clauses' && (
                        <div>
                            <div className="text-center mb-6">
                                <h3 className="text-xl font-bold">Repeated Clauses</h3>
                                {repeatedClauses && repeatedClauses.length > 0 ? (
                                    <p className="text-slate-600 dark:text-slate-400">
                                        Found {repeatedClauses.length} clause{repeatedClauses.length !== 1 ? 's' : ''} that appear more than once.
                                        Sorted by number of occurrences.
                                    </p>
                                ) : (
                                    <p className="mt-4 text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                                        No repeated clauses detected across the uploaded documents.
                                    </p>
                                )}
                            </div>
                            <div className="space-y-4">
                                {repeatedClauses && repeatedClauses.map((match, idx) => (
                                    <ClauseCard key={idx} match={match} />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="text-center mt-8">
                        <button onClick={handleReset} className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700">
                            Reset
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Rationalizer;
