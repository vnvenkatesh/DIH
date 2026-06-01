// ---------------------------------------------------------------------------
// POST /v1/data-mapping
//
// Accepts a DOCX template and an XSD schema. Uses Gemini to map dynamic
// placeholder fields in the Word document to XSD element paths and generate
// a sample XML document, mirroring the browser DataMappingGenerator tool.
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { callGemini, extractJsonText, DATA_MAPPING_PROMPT } from '../gemini.js';
import { extractDocxText } from '../lib/pdf.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handler(req: Request, res: Response): Promise<void> {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    const docxFile = files?.['docx']?.[0];
    const xsdFile = files?.['xsd']?.[0];

    if (!docxFile) {
        res.status(400).json({ error: 'docx file is required.' });
        return;
    }
    if (!xsdFile) {
        res.status(400).json({ error: 'xsd file is required.' });
        return;
    }

    try {
        const templateName = docxFile.originalname;
        const docxContent = await extractDocxText(docxFile.buffer);
        const xsdContent = xsdFile.buffer.toString('utf-8');

        const result = await callGemini(
            'gemini-2.5-flash',
            [{
                parts: [
                    { text: DATA_MAPPING_PROMPT },
                    { text: `\n\n--- TEMPLATE NAME ---\n\n${templateName}` },
                    { text: `\n\n--- WORD DOCUMENT CONTENT ---\n\n${docxContent}` },
                    { text: `\n\n--- XSD CONTENT ---\n\n${xsdContent}` },
                ],
            }],
            {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        mappings: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    field: { type: 'STRING', description: 'The placeholder name from the Word document.' },
                                    xsdPath: { type: 'STRING', description: 'The XPath to the corresponding element in the XSD.' },
                                    sampleValue: { type: 'STRING', description: 'A synthetic or extracted sample value for the field.' },
                                    templateName: { type: 'STRING', description: 'The name of the document template.' },
                                    pageNumber: { type: 'STRING', description: 'The estimated page number where the field appears.' },
                                },
                                required: ['field', 'xsdPath', 'sampleValue', 'templateName', 'pageNumber'],
                            },
                        },
                        generatedXml: { type: 'STRING', description: 'The full, valid XML string conforming to the XSD.' },
                    },
                    required: ['mappings', 'generatedXml'],
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

router.use(upload.fields([{ name: 'docx', maxCount: 1 }, { name: 'xsd', maxCount: 1 }]));
router.post('/', handler);

export default router;
