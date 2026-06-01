// ---------------------------------------------------------------------------
// Server-side document text extraction helpers.
// Uses pdf-parse for PDFs and mammoth for DOCX files.
// ---------------------------------------------------------------------------

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

// ---------------------------------------------------------------------------
// PDF helpers
// ---------------------------------------------------------------------------

/**
 * Extract text content one page at a time.
 *
 * Returns an array where index 0 corresponds to page 1. Each element is the
 * concatenated text of all text items on that page.
 */
export async function extractPagesText(buffer: Buffer): Promise<string[]> {
    const pages: string[] = [];

    // pdf-parse's pagerender callback receives a page data object from pdfjs.
    // We use it to collect per-page text while still letting pdf-parse do the
    // heavy lifting of loading the document.
    const options = {
        // Called once per page during parse; we capture the text and push it.
        pagerender: async (pageData: {
            getTextContent: () => Promise<{
                items: Array<{ str?: string }>;
            }>;
        }): Promise<string> => {
            const textContent = await pageData.getTextContent();
            const pageText = textContent.items
                .filter((item): item is { str: string } => typeof item.str === 'string')
                .map(item => item.str)
                .join(' ')
                .trim();
            pages.push(pageText);
            // pdf-parse concatenates the return value of pagerender into the
            // top-level .text field — we return the same text so that field
            // remains accurate.
            return pageText;
        },
    };

    await pdfParse(buffer, options);
    return pages;
}

/**
 * Extract the full concatenated text of a PDF along with its page count.
 */
export async function extractFullText(
    buffer: Buffer
): Promise<{ text: string; pageCount: number }> {
    const result = await pdfParse(buffer);
    return {
        text: result.text ?? '',
        pageCount: result.numpages ?? 0,
    };
}

// ---------------------------------------------------------------------------
// DOCX helper
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a DOCX buffer using mammoth.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
}
