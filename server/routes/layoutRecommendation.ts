// ---------------------------------------------------------------------------
// POST /v1/layout-recommendation
//
// Accepts a PDF or DOCX file and uses Gemini to reformat the document content
// into a condensed email version and an ultra-compact WhatsApp version,
// mirroring the browser LayoutRecommendation tool.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { callGemini, extractJsonText, LAYOUT_PROMPT } from '../gemini.js';
import { extractFullText, extractDocxText } from '../lib/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const file = req.file;

    if (!file) {
        res.status(400).json({ error: 'A PDF or DOCX file is required.' });
        return;
    }

    try {
        const ext = path.extname(file.originalname).toLowerCase();
        let documentText: string;

        if (ext === '.pdf') {
            const { text } = await extractFullText(file.buffer);
            documentText = text;
        } else if (ext === '.docx') {
            documentText = await extractDocxText(file.buffer);
        } else {
            res.status(400).json({ error: 'Unsupported file type. Only PDF and DOCX are accepted.' });
            return;
        }

        if (!documentText.trim()) {
            res.status(400).json({ error: 'Could not extract any text from the uploaded file.' });
            return;
        }

        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: LAYOUT_PROMPT },
                    { text: `\n\n--- DOCUMENT CONTENT ---\n\n${documentText}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        emailVersion: { type: 'STRING', description: 'The condensed email-friendly version of the document.' },
                        whatsappVersion: { type: 'STRING', description: 'The ultra-condensed WhatsApp version of the document.' },
                    },
                    required: ['emailVersion', 'whatsappVersion'],
                },
            }
        );

        const parsed = JSON.parse(extractJsonText(result));
        res.json(parsed);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
}

router.use(upload.single('file'));
router.post('/', handler);

export default router;
