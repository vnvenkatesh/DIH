// ---------------------------------------------------------------------------
// POST /v1/synthetic-data
//
// Accepts a single XSD file and uses Gemini to generate a valid XML document
// populated with realistic synthetic data, mirroring the browser FieldExtractor
// tool.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { callGemini, extractJsonText, SYNTHETIC_DATA_PROMPT } from '../gemini.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const file = req.file;

    if (!file) {
        res.status(400).json({ error: 'xsd file is required.' });
        return;
    }

    try {
        const xsdContent = file.buffer.toString('utf-8');

        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: SYNTHETIC_DATA_PROMPT },
                    { text: `\n\n--- XML SCHEMA (XSD) ---\n\n${xsdContent}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        fields: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    field: { type: 'STRING', description: 'The name of the element or attribute.' },
                                    value: { type: 'STRING', description: 'The generated synthetic value.' },
                                },
                                required: ['field', 'value'],
                            },
                        },
                        generatedXml: { type: 'STRING', description: 'The generated XML string.' },
                    },
                    required: ['fields', 'generatedXml'],
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

router.use(upload.single('xsd'));
router.post('/', handler);

export default router;
