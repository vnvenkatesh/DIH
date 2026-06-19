// ---------------------------------------------------------------------------
// Font-aware PDF extraction helpers.
// Uses pdf-parse's pagerender callback to access pdfjs text items with font
// metadata (height, fontName). For Precise mode, attempts operator-list
// parsing to extract fill colours.
// ---------------------------------------------------------------------------

import pdfParse from 'pdf-parse';
import { diffArrays } from 'diff';

export interface FontItem {
    str: string;
    height: number;   // PDF-unit font size
    fontName: string; // internal PDF font identifier
    x: number;
    y: number;
}

export interface FontDiff {
    page: number;
    type: 'font' | 'color';
    textA: string;
    textB: string;
    reason: string;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export async function extractPagesWithFontData(buffer: Buffer): Promise<FontItem[][]> {
    const pages: FontItem[][] = [];
    await pdfParse(buffer, {
        pagerender: async (pageData: any): Promise<string> => {
            const tc = await pageData.getTextContent();
            const items: FontItem[] = tc.items
                .filter((it: any) => typeof it.str === 'string' && it.str.trim())
                .map((it: any) => ({
                    str: it.str as string,
                    height: (it.height as number) ?? 0,
                    fontName: (it.fontName as string) ?? '',
                    x: it.transform ? Math.round(it.transform[4]) : 0,
                    y: it.transform ? Math.round(it.transform[5]) : 0,
                }));
            pages.push(items);
            return items.map(i => i.str).join(' ');
        },
    });
    return pages;
}

// For Precise mode: attempt to map fill colour to each text item via operator list.
// Returns a parallel array of hex colour strings (same length as page's FontItem[]).
// Falls back to empty array if operator list is unavailable.
export async function extractPageColors(pageData: any, itemCount: number): Promise<string[]> {
    const colors: string[] = new Array(itemCount).fill('#000000');
    try {
        const opList = await pageData.getOperatorList();
        // Stable OPS numeric values across pdfjs versions
        const SET_FILL_RGB  = 73;
        const SET_FILL_GRAY = 61;
        const SHOW_TEXT     = 43;
        const SHOW_SPACED   = 44;

        let fillColor = '#000000';
        let textIdx = 0;

        for (let i = 0; i < opList.fnArray.length && textIdx < itemCount; i++) {
            const op = opList.fnArray[i];
            const args = opList.argsArray[i] as number[];
            if (op === SET_FILL_RGB) {
                fillColor = toHex(args[0], args[1], args[2]);
            } else if (op === SET_FILL_GRAY) {
                fillColor = toHex(args[0], args[0], args[0]);
            } else if (op === SHOW_TEXT || op === SHOW_SPACED) {
                colors[textIdx++] = fillColor;
            }
        }
    } catch {
        // Operator list unavailable — keep default black
    }
    return colors;
}

function toHex(r: number, g: number, b: number): string {
    const byte = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

export function groupFontItemsIntoParagraphs(items: FontItem[]): FontItem[][] {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) =>
        Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x
    );
    const paras: FontItem[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const prev = paras[paras.length - 1][paras[paras.length - 1].length - 1];
        const curr = sorted[i];
        const gap = Math.abs(curr.y - prev.y);
        const lineH = Math.max(prev.height, curr.height) || 12;
        if (gap > lineH * 1.5) {
            paras.push([curr]);
        } else {
            paras[paras.length - 1].push(curr);
        }
    }
    return paras;
}

export function dominantHeight(items: FontItem[]): number {
    const hs = items.filter(i => i.height > 0).map(i => i.height).sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length / 2)] : 0;
}

export function extractFontStyle(items: FontItem[]): string {
    const names = items.map(i => i.fontName.toLowerCase());
    const bold   = names.some(n => n.includes('bold'));
    const italic = names.some(n => n.includes('italic') || n.includes('oblique'));
    if (bold && italic) return 'bold-italic';
    if (bold)   return 'bold';
    if (italic) return 'italic';
    return 'regular';
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export function compareFontPages(
    fontPagesA: FontItem[][],
    fontPagesB: FontItem[][],
    numPages: number,
): FontDiff[] {
    const diffs: FontDiff[] = [];

    for (let p = 0; p < numPages; p++) {
        const parasA = groupFontItemsIntoParagraphs(fontPagesA[p] ?? []);
        const parasB = groupFontItemsIntoParagraphs(fontPagesB[p] ?? []);
        const textsA = parasA.map(para => para.map(i => i.str).join(' ').trim());
        const textsB = parasB.map(para => para.map(i => i.str).join(' ').trim());
        const chunks = diffArrays(textsA, textsB);

        let idxA = 0;
        let idxB = 0;
        for (const chunk of chunks) {
            if (!chunk.added && !chunk.removed) {
                for (let k = 0; k < chunk.value.length; k++) {
                    const pa = parasA[idxA + k];
                    const pb = parasB[idxB + k];
                    if (!pa || !pb) continue;

                    const ha = dominantHeight(pa);
                    const hb = dominantHeight(pb);
                    const sizeChanged = ha > 0 && hb > 0 && Math.abs(ha - hb) > 0.5;

                    const styleA = extractFontStyle(pa);
                    const styleB = extractFontStyle(pb);
                    const styleChanged = styleA !== styleB;

                    if (sizeChanged || styleChanged) {
                        const reasons: string[] = [];
                        if (sizeChanged)  reasons.push(`size ${ha.toFixed(1)}pt → ${hb.toFixed(1)}pt`);
                        if (styleChanged) reasons.push(`style ${styleA} → ${styleB}`);
                        diffs.push({
                            page: p + 1,
                            type: 'font',
                            textA: textsA[idxA + k],
                            textB: textsB[idxB + k],
                            reason: `Font changed — ${reasons.join(', ')}`,
                        });
                    }
                }
                idxA += chunk.value.length;
                idxB += chunk.value.length;
            } else if (chunk.removed) {
                idxA += chunk.value.length;
            } else {
                idxB += chunk.value.length;
            }
        }
    }
    return diffs;
}
