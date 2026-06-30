
import React, { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { DocumentGroup, ProcessedDocument, ClauseMatch } from '../types';
import { embedContentBatch } from '../services/rationalizerEmbedService';
import ToggleSwitch from './ToggleSwitch';
import { Squares2X2Icon } from './icons/Squares2X2Icon';

interface RationalizerProps {
    onCompareRequest: (files: [File, File]) => void;
}

// ─── Cosine similarity for document-level semantic grouping ──────────────────

const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
};

// ─── Repeated-clause detection: Jaccard similarity on word sets ──────────────
//
// Jaccard is used rather than AI embeddings because:
//   • No API call — fast, no quota consumption.
//   • Formal/legal language repeats phrases near-verbatim; Jaccard on
//     content-word sets is well-suited to that overlap pattern.
//   • Same-document duplicates are detected naturally (all pairs compared,
//     not just cross-document pairs).
//
// Threshold 0.65 catches meaningful paraphrases while filtering unrelated text.
// 3-sentence windows with 1-sentence overlap prevent clauses that straddle
// arbitrary segmentation boundaries from being missed.

const CLAUSE_JACCARD_THRESHOLD = 0.65;
const CLAUSE_MIN_CHARS = 80;   // discard very short fragments (headers, labels)
const CLAUSE_WINDOW_SIZE = 3;  // sentences per logical clause group
const CLAUSE_STEP_SIZE = 2;    // sliding step; leaves 1-sentence overlap

// Common English words excluded so Jaccard focuses on content words.
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

// PDF extraction lowercases all text, so we cannot use capital-letter
// detection for sentence boundaries — split on punctuation + whitespace only.
function splitSentences(text: string): string[] {
    return text
        .split(/[.!?]+\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 15);
}

// Build clause windows: CLAUSE_WINDOW_SIZE consecutive sentences joined with
// '. ', sliding by CLAUSE_STEP_SIZE so adjacent windows share one sentence.
function extractClauses(text: string): string[] {
    const sentences = splitSentences(text);
    const clauses: string[] = [];
    for (let i = 0; i < sentences.length; i += CLAUSE_STEP_SIZE) {
        const clause = sentences.slice(i, i + CLAUSE_WINDOW_SIZE).join('. ').trim();
        if (clause.length >= CLAUSE_MIN_CHARS) clauses.push(clause);
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
    for (const word of a) if (b.has(word)) intersection++;
    return intersection / (a.size + b.size - intersection);
}

// Detect clauses that repeat within or across documents.
// Greedy grouping: each unassigned clause i is compared forward against all
// unassigned j; first match wins the group. Includes same-document repeats.
// frequency = % of total uploaded docs that contain the clause (≥ 1 instance).
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

        const occMap = new Map<string, number>();
        for (const idx of group) {
            const name = processedDocs[corpus[idx].docIndex].file.name;
            occMap.set(name, (occMap.get(name) ?? 0) + 1);
        }
        const docCount = occMap.size;
        matches.push({
            text: corpus[i].text,
            occurrences: Array.from(occMap.entries()).map(([documentName, count]) => ({ documentName, count })),
            totalCount: group.length,
            frequency: Math.round((docCount / processedDocs.length) * 100),
        });
    }

    return matches.sort((a, b) => b.totalCount - a.totalCount);
}

// For each group, find clauses that appear in one doc of the group but not
// in any other doc of that group (unique content per document).
function computeUniqueClausesByGroup(
    groups: DocumentGroup[],
    clausesByDoc: Record<string, string[]>
): Record<number, Record<string, string[]>> {
    const result: Record<number, Record<string, string[]>> = {};
    for (const group of groups) {
        const groupUnique: Record<string, string[]> = {};
        for (const doc of group.documents) {
            const thisClauses = clausesByDoc[doc.file.name] ?? [];
            const otherTokenSets = group.documents
                .filter(d => d.file.name !== doc.file.name)
                .flatMap(d => (clausesByDoc[d.file.name] ?? []).map(tokenize));
            groupUnique[doc.file.name] = thisClauses.filter(clause => {
                const ct = tokenize(clause);
                return !otherTokenSets.some(ot => jaccardSimilarity(ct, ot) >= CLAUSE_JACCARD_THRESHOLD);
            });
        }
        result[group.id] = groupUnique;
    }
    return result;
}

// ─── Group summary generation ─────────────────────────────────────────────────
//
// Produces a short human-readable description of the differences within a
// document group by combining:
//   • Unique-clause count (already computed by computeUniqueClausesByGroup)
//   • Word-set diff to detect state names, dates, codes, amounts
// Because the keyword embedding collapses documents with the same vocabulary
// distribution (e.g. state-specific legal forms) to near-100% similarity,
// word-level analysis is more reliable for describing what actually differs.

const US_STATES = new Set([
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
    'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
    'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
    'minnesota','mississippi','missouri','montana','nebraska','nevada',
    'hampshire','jersey','mexico','carolina','dakota','ohio','oklahoma','oregon',
    'pennsylvania','rhode','tennessee','texas','utah','vermont','virginia',
    'washington','wisconsin','wyoming',
]);

function generateGroupSummary(
    group: DocumentGroup,
    uniqueByDoc: Record<string, string[]>
): string {
    const docs = group.documents;
    if (docs.length < 2) return '';

    const allUniqueClauses = Object.values(uniqueByDoc).flat();

    // Word-set analysis: find words that appear in some docs but not all
    const wordSets = docs.map(d => new Set(d.text.split(/\s+/).filter(w => w.length > 3)));
    const diffWords: string[] = [];
    for (let i = 0; i < docs.length; i++) {
        for (const w of wordSets[i]) {
            if (!docs.some((_, j) => j !== i && wordSets[j].has(w))) {
                diffWords.push(w);
            }
        }
    }

    const maxUnique = Math.max(...Object.values(uniqueByDoc).map(c => c.length), 0);

    // No clause-level differences but docs are not identical text
    if (maxUnique === 0 && diffWords.length === 0) {
        const first = docs[0].text;
        return docs.every(d => d.text === first)
            ? 'Texts appear identical — differences may be visual or metadata only.'
            : 'Very high similarity — differences are below clause detection threshold.';
    }

    const insights: string[] = [];

    // Clause count
    if (maxUnique === 0 && diffWords.length > 0) {
        insights.push('subtle word-level differences only');
    } else if (maxUnique === 1) {
        insights.push('1 clause differs per document');
    } else if (maxUnique <= 3) {
        insights.push(`up to ${maxUnique} clauses differ`);
    } else if (maxUnique <= 7) {
        insights.push('several clauses differ');
    } else {
        insights.push('significant content variation');
    }

    // State/jurisdiction variants
    const stateHits = diffWords.filter(w => US_STATES.has(w.toLowerCase()));
    if (stateHits.length > 0) {
        insights.push(`state-specific variants (${stateHits.slice(0, 2).join(', ')})`);
    }

    // Date differences (in unique clauses or diff words)
    const dateRe = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/;
    if (allUniqueClauses.some(c => dateRe.test(c)) || diffWords.some(w => dateRe.test(w))) {
        insights.push('dates differ');
    }

    // Reference codes / form IDs (e.g. "cwf220b", "orf220b")
    const codeRe = /^[a-z]{1,6}\d{3,}$|^\d{3,}[a-z]{1,6}$/i;
    if (diffWords.some(w => codeRe.test(w))) {
        insights.push('form or reference codes differ');
    }

    // Monetary amounts
    const amountRe = /\$[\d,]+|\b\d{1,3}(,\d{3})+\b/;
    if (allUniqueClauses.some(c => amountRe.test(c))) {
        insights.push('monetary amounts differ');
    }

    // Short-section differences — likely headers, footers, or labels
    if (insights.length === 1 && allUniqueClauses.length > 0) {
        const shortRatio = allUniqueClauses.filter(c => c.length < 130).length / allUniqueClauses.length;
        if (shortRatio > 0.6) insights.push('differences in short sections (headers/footers/labels)');
    }

    return insights.join(' · ');
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportClausesCSV(clauses: ClauseMatch[]): void {
    const header = ['"#"', '"Clause (preview)"', '"Total Occurrences"', '"% of Documents"', '"Documents"'];
    const rows = clauses.map((c, i) => {
        const preview = c.text.replace(/"/g, '""').slice(0, 300);
        const docs = c.occurrences
            .map(o => (o.count > 1 ? `${o.documentName} (×${o.count})` : o.documentName))
            .join('; ')
            .replace(/"/g, '""');
        return [`${i + 1}`, `"${preview}"`, `${c.totalCount}`, `${c.frequency}`, `"${docs}"`];
    });
    const csv = [header, ...rows].map(r => r.join(',')).join('\r\n');
    // BOM prepended so Excel opens the file with correct UTF-8 encoding.
    triggerDownload(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'repeated-clauses.csv');
}

function exportMasterDocument(clauses: ClauseMatch[], totalDocs: number, docNames: string[]): void {
    // Sort by frequency descending so the most universal clauses lead the document.
    const sorted = [...clauses].sort((a, b) => b.frequency - a.frequency);

    const tocItems = sorted
        .map((c, i) => `<li><a href="#c${i + 1}">${escapeHtml(c.text.slice(0, 90))}${c.text.length > 90 ? '…' : ''}</a> — ${c.frequency}% of docs</li>`)
        .join('\n    ');

    const clauseBlocks = sorted.map((c, i) => {
        const barColor = c.frequency >= 67 ? '#22c55e' : c.frequency >= 34 ? '#f59e0b' : '#6366f1';
        const badges = c.occurrences
            .map(o => `<span class="badge">${escapeHtml(o.documentName)}${o.count > 1 ? ` ×${o.count}` : ''}</span>`)
            .join(' ');
        return `
<div class="clause" id="c${i + 1}">
  <div class="clause-header">
    <span class="clause-num">Clause ${i + 1}</span>
    <span class="freq-label">Present in ${c.occurrences.length} of ${totalDocs} documents (${c.frequency}%)</span>
  </div>
  <div class="bar-wrap"><div class="bar-fill" style="width:${c.frequency}%;background:${barColor}"></div></div>
  <div class="clause-text">${escapeHtml(c.text)}</div>
  <div class="annotation"><strong>Applicable to:</strong> ${badges}</div>
</div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Master Document — Repeated Clauses</title>
<style>
  body{font-family:Georgia,serif;max-width:860px;margin:40px auto;padding:0 24px;color:#1e293b;line-height:1.65}
  h1{font-size:22px;border-bottom:3px solid #4f46e5;padding-bottom:12px}
  .meta{color:#64748b;font-size:13px;margin-bottom:28px}
  .toc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin-bottom:32px}
  .toc h2{font-size:14px;margin:0 0 10px}
  .toc ol{margin:0;padding-left:18px;font-size:12px;color:#475569;line-height:1.8}
  .toc a{color:#4f46e5;text-decoration:none}
  .clause{page-break-inside:avoid;margin:28px 0;padding:18px 20px;border:1px solid #e2e8f0;border-left:4px solid #4f46e5;border-radius:6px;background:#fafbff}
  .clause-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
  .clause-num{font-weight:bold;color:#4f46e5;font-size:13px}
  .freq-label{font-size:12px;color:#64748b}
  .bar-wrap{background:#e2e8f0;border-radius:3px;height:5px;margin-bottom:12px}
  .bar-fill{height:5px;border-radius:3px}
  .clause-text{font-size:14px;line-height:1.8;background:#fff;padding:14px 16px;border:1px solid #e2e8f0;border-radius:4px;white-space:pre-wrap;word-break:break-word}
  .annotation{margin-top:12px;font-size:12px;color:#475569}
  .annotation strong{color:#334155}
  .badge{display:inline-block;background:#eef2ff;color:#4338ca;padding:2px 8px;border-radius:12px;font-size:11px;margin:2px 3px;border:1px solid #c7d2fe}
</style>
</head>
<body>
<h1>Master Document — Repeated Clauses</h1>
<div class="meta">
  Generated from <strong>${totalDocs} document${totalDocs !== 1 ? 's' : ''}</strong> &bull;
  <strong>${sorted.length} repeated clause${sorted.length !== 1 ? 's' : ''}</strong> &bull;
  Sorted by frequency (most common first)<br>
  <em>Source files: ${escapeHtml(docNames.join(', '))}</em>
</div>
<div class="toc"><h2>Table of Contents</h2><ol>${tocItems}</ol></div>
${clauseBlocks}
</body>
</html>`;

    triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), 'master-document.html');
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const GroupCard: React.FC<{
    group: DocumentGroup;
    onCompareRequest: (files: [File, File]) => void;
    uniqueByDoc?: Record<string, string[]>;
    summary?: string;
}> = ({ group, onCompareRequest, uniqueByDoc, summary }) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    const handleSelectionChange = (file: File) => {
        setSelectedFiles(prev => {
            if (prev.includes(file)) return prev.filter(f => f !== file);
            if (prev.length < 2) return [...prev, file];
            return prev;
        });
    };

    return (
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
            {/* Header row */}
            <div className="flex justify-between items-center mb-3">
                <p className="font-bold text-indigo-600 dark:text-indigo-400">
                    Group {group.id + 1} — {group.documents.length} Documents
                    <span className="ml-2 text-sm font-medium text-white bg-indigo-500 dark:bg-indigo-600 px-2 py-0.5 rounded-full">
                        {group.similarity}% similar
                    </span>
                </p>
                <button
                    onClick={() => onCompareRequest(selectedFiles as [File, File])}
                    disabled={selectedFiles.length !== 2}
                    className="ml-4 shrink-0 bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded-md hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                >
                    Compare Selected ({selectedFiles.length})
                </button>
            </div>

            {/* Three-column body: thumbnail | document list | summary */}
            <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_1fr] gap-4 items-start">

                {/* Narrow thumbnail */}
                <div className="flex justify-center items-start bg-slate-200 dark:bg-slate-900 p-1.5 rounded-md">
                    <img src={group.documents[0].thumbnail} alt="Document thumbnail" className="max-w-full h-auto shadow-md" />
                </div>

                {/* Document checklist */}
                <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 overflow-y-auto max-h-48">
                    {group.documents.map(doc => {
                        const uniqueCount = uniqueByDoc?.[doc.file.name]?.length ?? 0;
                        return (
                            <li key={doc.file.name}>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedFiles.includes(doc.file)}
                                        onChange={() => handleSelectionChange(doc.file)}
                                        disabled={!selectedFiles.includes(doc.file) && selectedFiles.length >= 2}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 shrink-0"
                                    />
                                    <span className="truncate">{doc.file.name}</span>
                                    {uniqueCount > 0 && (
                                        <span className="ml-auto shrink-0 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-full" title="Clauses unique to this document within the group">
                                            {uniqueCount} unique
                                        </span>
                                    )}
                                </label>
                            </li>
                        );
                    })}
                </ul>

                {/* Difference summary */}
                {summary ? (
                    <div className="flex items-start gap-2 p-3 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-600 h-full">
                        <span className="text-slate-400 dark:text-slate-500 mt-0.5 shrink-0">💡</span>
                        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed italic">
                            {summary}
                        </p>
                    </div>
                ) : (
                    <div className="hidden md:block" />
                )}
            </div>
        </div>
    );
};

const ClauseCard: React.FC<{ match: ClauseMatch }> = ({ match }) => {
    const [expanded, setExpanded] = useState(false);
    const PREVIEW_LEN = 220;
    const isLong = match.text.length > PREVIEW_LEN;
    const displayText = expanded || !isLong ? match.text : match.text.slice(0, PREVIEW_LEN) + '…';

    // Color heatmap: green = universal (≥67%), amber = common (≥34%), indigo = selective (<34%)
    const barColor =
        match.frequency >= 67 ? 'bg-green-500' :
        match.frequency >= 34 ? 'bg-amber-500' :
        'bg-indigo-500';
    const freqLabel =
        match.frequency >= 67 ? 'Universal' :
        match.frequency >= 34 ? 'Common' :
        'Selective';

    return (
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                        {match.totalCount} occurrence{match.totalCount !== 1 ? 's' : ''}
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        {match.occurrences.length > 1
                            ? `across ${match.occurrences.length} documents`
                            : `within 1 document`}
                    </span>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {freqLabel} — {match.frequency}% of docs
                </span>
            </div>

            {/* Frequency heatmap bar */}
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden mb-3">
                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${match.frequency}%` }} />
            </div>

            {/* Document badges */}
            <div className="flex flex-wrap gap-1.5 mb-3">
                {match.occurrences.map(occ => (
                    <span
                        key={occ.documentName}
                        title={occ.documentName}
                        className="inline-flex items-center gap-1 text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-full max-w-[200px] truncate"
                    >
                        {occ.documentName}
                        {occ.count > 1 && (
                            <span className="font-bold bg-indigo-200 dark:bg-indigo-800 px-1 rounded-full shrink-0">
                                ×{occ.count}
                            </span>
                        )}
                    </span>
                ))}
            </div>

            {/* Clause text */}
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

// ─── Main component ───────────────────────────────────────────────────────────

const LARGE_BATCH_THRESHOLD = 20;

const Rationalizer: React.FC<RationalizerProps> = ({ onCompareRequest }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [groupingMode, setGroupingMode] = useState<'exact' | 'semantic'>('semantic');
    const [similarityThreshold, setSimilarityThreshold] = useState<number>(80);

    const [results, setResults] = useState<DocumentGroup[] | null>(null);
    const [repeatedClauses, setRepeatedClauses] = useState<ClauseMatch[] | null>(null);
    const [uniqueClausesByGroup, setUniqueClausesByGroup] = useState<Record<number, Record<string, string[]>> | null>(null);
    const [groupSummaries, setGroupSummaries] = useState<Record<number, string> | null>(null);
    const [totalDocCount, setTotalDocCount] = useState<number>(0);

    const [activeTab, setActiveTab] = useState<'groups' | 'clauses'>('groups');
    const [clauseSort, setClauseSort] = useState<'frequency' | 'count'>('frequency');

    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;
    }, []);

    const processPdf = async (file: File): Promise<ProcessedDocument> => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages || 0;
        const textContent: string[] = [];

        for (let i = 1; i <= numPages; i++) {
            try {
                if (i > pdf.numPages) break;
                const page = await pdf.getPage(i);
                const tc = await page.getTextContent();
                textContent.push(tc.items.map(item => ('str' in item ? item.str : '')).join(' '));
            } catch (err) {
                console.error(`Error processing page ${i} of ${file.name}`, err);
            }
        }

        // Preserve newlines between pages for sentence segmentation while
        // collapsing intra-page whitespace.
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
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                if (ctx) {
                    await firstPage.render({ canvasContext: ctx, viewport } as any).promise;
                    thumbnail = canvas.toDataURL();
                }
            } catch (err) {
                console.error(`Thumbnail error for ${file.name}`, err);
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
        setUniqueClausesByGroup(null);
        setGroupSummaries(null);

        // Total steps: one per PDF + embedding/hashing + clustering + clause detection
        const totalSteps = files.length + 3;
        let currentStep = 0;
        const tick = (msg: string) => {
            currentStep++;
            setProgress({ current: currentStep, total: totalSteps });
            setLoadingMessage(msg);
        };
        setProgress({ current: 0, total: totalSteps });

        try {
            const processedDocs: ProcessedDocument[] = [];
            for (let i = 0; i < files.length; i++) {
                setLoadingMessage(`Processing document ${i + 1} of ${files.length}: ${files[i].name}`);
                processedDocs.push(await processPdf(files[i]));
                currentStep++;
                setProgress({ current: currentStep, total: totalSteps });
            }

            // Build clause corpus per document for unique-content computation later.
            const clausesByDoc: Record<string, string[]> = {};
            for (const doc of processedDocs) {
                clausesByDoc[doc.file.name] = extractClauses(doc.text);
            }

            let groups: DocumentGroup[] = [];

            if (groupingMode === 'exact') {
                tick('Calculating hashes…');
                const hashGroups: { [k: string]: ProcessedDocument[] } = {};
                for (const doc of processedDocs) {
                    const buf = new TextEncoder().encode(doc.text);
                    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
                    const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
                    if (!hashGroups[hex]) hashGroups[hex] = [];
                    hashGroups[hex].push(doc);
                }
                groups = Object.values(hashGroups)
                    .filter(g => g.length > 1)
                    .map((docs, i) => ({ id: i, documents: docs, similarity: 100 }));
                tick('Grouping documents…'); // consume the clustering slot
            } else {
                tick('Generating semantic embeddings…');
                const embeddings = await embedContentBatch(processedDocs.map(d => d.text.trim() || 'empty document'));
                for (let i = 0; i < processedDocs.length; i++) processedDocs[i].embedding = embeddings[i];

                tick('Clustering documents…');
                const clusters = processedDocs.map(doc => [doc]);
                const pairs: { i: number; j: number; sim: number }[] = [];
                for (let i = 0; i < clusters.length; i++)
                    for (let j = i + 1; j < clusters.length; j++)
                        pairs.push({ i, j, sim: cosineSimilarity(clusters[i][0].embedding!, clusters[j][0].embedding!) });
                pairs.sort((a, b) => b.sim - a.sim);

                const merged = new Array(clusters.length).fill(false);
                const finalClusters: ProcessedDocument[][] = [];
                const threshold = similarityThreshold / 100;

                for (const { i, j, sim } of pairs) {
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
                for (let i = 0; i < clusters.length; i++) if (!merged[i]) finalClusters.push(clusters[i]);

                groups = finalClusters
                    .filter(g => g.length > 1)
                    .map((docs, i) => {
                        const firstEmb = docs[0].embedding!;
                        const avgSim = docs.length > 1
                            ? docs.slice(1).reduce((s, d) => s + cosineSimilarity(firstEmb, d.embedding!), 0) / (docs.length - 1)
                            : 0;
                        // Cap at 99%: keyword embeddings can round non-identical docs
                        // to 100% due to identical vocabulary distributions.
                        return { id: i, documents: docs, similarity: Math.min(Math.round(avgSim * 100), 99) };
                    })
                    .filter(g => g.similarity >= similarityThreshold);
            }

            tick('Detecting repeated clauses…');
            const clauseMatches = detectRepeatedClauses(processedDocs);

            // Sort groups by similarity descending so the most similar pairs surface first.
            const sortedGroups = [...groups].sort((a, b) => b.similarity - a.similarity)
                .map((g, i) => ({ ...g, id: i })); // reindex after sort

            const uniqueData = computeUniqueClausesByGroup(sortedGroups, clausesByDoc);

            // Generate a short difference summary for each group.
            const summaries: Record<number, string> = {};
            for (const group of sortedGroups) {
                summaries[group.id] = generateGroupSummary(group, uniqueData[group.id] ?? {});
            }

            setTotalDocCount(processedDocs.length);
            setResults(sortedGroups);
            setRepeatedClauses(clauseMatches);
            setUniqueClausesByGroup(uniqueData);
            setGroupSummaries(summaries);
            setActiveTab('groups');
        } catch (err: any) {
            console.error('Rationalization error:', err);
            setError(`Rationalization failed: ${err.message || 'An unexpected error occurred'}. Please check your files and try again.`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
            setProgress(null);
        }
    }, [files, groupingMode, similarityThreshold]);

    const handleReset = () => {
        setFiles([]);
        setResults(null);
        setRepeatedClauses(null);
        setUniqueClausesByGroup(null);
        setGroupSummaries(null);
        setTotalDocCount(0);
        setActiveTab('groups');
        setProgress(null);
        setError(null);
        setIsLoading(false);
    };

    const sortedClauses = repeatedClauses
        ? [...repeatedClauses].sort((a, b) =>
            clauseSort === 'frequency' ? b.frequency - a.frequency : b.totalCount - a.totalCount
          )
        : null;

    const hasResults = results !== null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                    <Squares2X2Icon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    Rationalizer
                </h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Group a collection of PDFs by similarity and surface repeated clauses across documents.
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
                            onChange={e => e.target.files && setFiles(Array.from(e.target.files))}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                        />
                        {files.length > 0 && (
                            <ul className="mt-3 text-xs list-disc list-inside text-slate-500 dark:text-slate-400 max-h-24 overflow-y-auto">
                                {files.map(f => <li key={f.name}>{f.name}</li>)}
                            </ul>
                        )}
                    </div>

                    {/* Large-batch warning — shown when ≥ LARGE_BATCH_THRESHOLD files selected */}
                    {files.length >= LARGE_BATCH_THRESHOLD && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                            <span className="text-base leading-none mt-0.5">⚠</span>
                            <span>
                                <strong>Large batch ({files.length} files)</strong> — processing may take a minute or two,
                                especially in Semantic mode which calls the AI embeddings API once per document.
                            </span>
                        </div>
                    )}

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
                                type="range" min="70" max="99"
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

            {/* ── Loading with progress bar ── */}
            {isLoading && (
                <div className="flex flex-col items-center justify-center p-8 space-y-5">
                    <p className="text-base text-slate-600 dark:text-slate-400 text-center">{loadingMessage || 'Processing…'}</p>
                    {progress && (
                        <div className="w-full max-w-md space-y-2">
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
                                <div
                                    className="bg-indigo-500 h-3 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                                />
                            </div>
                            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                                Step {progress.current} of {progress.total} ({Math.round((progress.current / progress.total) * 100)}%)
                            </p>
                        </div>
                    )}
                    {!progress && (
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500" />
                    )}
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

                    {/* ── Document Groups tab ── */}
                    {activeTab === 'groups' && (
                        <div>
                            <div className="text-center mb-6">
                                <h3 className="text-xl font-bold">Document Groups</h3>
                                {results && results.length > 0 ? (
                                    <p className="text-slate-600 dark:text-slate-400">
                                        Found {results.length} group{results.length !== 1 ? 's' : ''} of similar documents.
                                        Unique-clause counts per document are shown where detected.
                                    </p>
                                ) : (
                                    <p className="mt-4 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                                        No groups of similar documents found with the current settings.
                                    </p>
                                )}
                            </div>
                            <div className="space-y-6">
                                {results && results.map(group => (
                                    <GroupCard
                                        key={group.id}
                                        group={group}
                                        onCompareRequest={onCompareRequest}
                                        uniqueByDoc={uniqueClausesByGroup?.[group.id]}
                                        summary={groupSummaries?.[group.id]}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Repeated Clauses tab ── */}
                    {activeTab === 'clauses' && (
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                                <div>
                                    <h3 className="text-xl font-bold">Repeated Clauses</h3>
                                    {sortedClauses && sortedClauses.length > 0 ? (
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            {sortedClauses.length} clause{sortedClauses.length !== 1 ? 's' : ''} found.
                                            Bar colour: <span className="text-green-600 dark:text-green-400 font-medium">green</span> = universal ≥67%,{' '}
                                            <span className="text-amber-600 dark:text-amber-400 font-medium">amber</span> = common ≥34%,{' '}
                                            <span className="text-indigo-600 dark:text-indigo-400 font-medium">indigo</span> = selective.
                                        </p>
                                    ) : (
                                        <p className="text-sm text-slate-600 dark:text-slate-400">
                                            No repeated clauses detected.
                                        </p>
                                    )}
                                </div>

                                {sortedClauses && sortedClauses.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        {/* Sort control */}
                                        <select
                                            value={clauseSort}
                                            onChange={e => setClauseSort(e.target.value as 'frequency' | 'count')}
                                            className="text-xs border border-slate-300 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                                        >
                                            <option value="frequency">Sort: Frequency</option>
                                            <option value="count">Sort: Occurrences</option>
                                        </select>

                                        {/* Export CSV */}
                                        <button
                                            onClick={() => exportClausesCSV(sortedClauses)}
                                            className="text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 transition-colors"
                                        >
                                            Export CSV
                                        </button>

                                        {/* Export master document */}
                                        <button
                                            onClick={() => exportMasterDocument(
                                                sortedClauses,
                                                totalDocCount,
                                                files.map(f => f.name)
                                            )}
                                            className="text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 rounded-md transition-colors"
                                        >
                                            Export Master Doc
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-4">
                                {sortedClauses && sortedClauses.length === 0 && (
                                    <p className="text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                                        No repeated clauses detected across the uploaded documents.
                                    </p>
                                )}
                                {sortedClauses && sortedClauses.map((match, idx) => (
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
