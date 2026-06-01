// ---------------------------------------------------------------------------
// POST /v1/xpath-extractor
//
// Accepts a PDF and an XML file. The PDF is forwarded to Gemini as a base64
// inline data part so the model can visually locate values and match them to
// absolute XPaths in the XML, mirroring the browser XPathExtractor tool.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { callGemini, extractJsonText, XPATH_PROMPT } from '../gemini.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const pdfFile = files?.['pdf']?.[0];
    const xmlFile = files?.['xml']?.[0];

    if (!pdfFile) {
        res.status(400).json({ error: 'pdf file is required.' });
        return;
    }
    if (!xmlFile) {
        res.status(400).json({ error: 'xml file is required.' });
        return;
    }

    try {
        const pdfBase64 = pdfFile.buffer.toString('base64');
        const pdfMimeType = 'application/pdf';
        const xmlContent = xmlFile.buffer.toString('utf-8');
        const templateName = pdfFile.originalname;

        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: `${XPATH_PROMPT}\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                    { inlineData: { mimeType: pdfMimeType, data: pdfBase64 } },
                    { text: `\n\n--- XML CONTENT ---\n\n${xmlContent}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            value: { type: 'STRING', description: 'The text value found in both the PDF and the XML.' },
                            xpath: { type: 'STRING', description: 'The full, absolute XPath to the element in the XML.' },
                            templateName: { type: 'STRING', description: 'The name of the template (PDF file).' },
                            pageNumber: { type: 'STRING', description: 'The estimated page number where the value appears.' },
                            fieldType: { type: 'STRING', description: 'The type of data (String, Date, Integer, etc.).' },
                        },
                        required: ['value', 'xpath', 'templateName', 'pageNumber', 'fieldType'],
                    },
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

router.use(upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'xml', maxCount: 1 }]));
router.post('/', handler);

export default router;
