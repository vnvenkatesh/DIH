// ---------------------------------------------------------------------------
// Gemini REST client — mirrors the browser geminiService.ts pattern but runs
// server-side with native Node fetch and reads the key from process.env.
// ---------------------------------------------------------------------------

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getApiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error(
            'GEMINI_API_KEY is not set. Add it to .env.local or export it before starting the server.'
        );
    }
    return key;
}

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

/**
 * Send a generateContent request to a Gemini model.
 *
 * @param model            e.g. "gemini-2.5-flash" or "gemini-2.5-pro"
 * @param contents         The "contents" array in the Gemini REST schema.
 * @param generationConfig Additional generation options (responseMimeType, responseSchema, …).
 * @returns                The raw parsed response body.
 */
export async function callGemini(
    model: string,
    contents: unknown[],
    generationConfig: unknown
): Promise<unknown> {
    const apiKey = getApiKey();
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig }),
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const message =
            (errBody as { error?: { message?: string } })?.error?.message ??
            `Gemini API error ${response.status}: ${response.statusText}`;
        throw new Error(message);
    }

    return response.json();
}

// ---------------------------------------------------------------------------
// Response text extractor
// ---------------------------------------------------------------------------

/**
 * Extract the final text output from a Gemini response, skipping "thought"
 * parts that the thinking-capable models emit before the answer.
 */
export function extractJsonText(result: unknown): string {
    const parts: Array<{ text?: string; thought?: boolean }> =
        (result as { candidates?: [{ content?: { parts?: unknown[] } }] })
            ?.candidates?.[0]?.content?.parts ?? [];

    const finalParts = parts.filter(
        (p): p is { text: string } =>
            p.text !== undefined && !p.thought
    );

    const text = finalParts.map(p => p.text).join('').trim();
    if (!text) throw new Error('Gemini returned an empty response. Please try again.');
    return text;
}

// ---------------------------------------------------------------------------
// Prompt constants
// ---------------------------------------------------------------------------

/**
 * XPATH_PROMPT — instructs Gemini to locate each XML leaf-node value inside
 * the PDF and return a structured mapping with absolute XPaths and metadata.
 */
export const XPATH_PROMPT = `\
You are an expert document specialist tasked with mapping dynamic data from a PDF to its source XML.

Instructions:
1.  You will be given a PDF file, a Template Name, and its corresponding source XML file.
2.  Parse the XML to identify all text values (the content of the leaf nodes).
3.  For each text value from the XML, search for its presence in the PDF document.
4.  Use intelligent matching. For example, if the PDF has "Acme Corp." and the XML has "Acme Corporation," treat this as a match. Similarly, handle minor differences in formatting such as dates, currencies, or punctuation.
5.  For each identified match, determine:
    - The text value found in the PDF.
    - The full, absolute XPath of that element in the XML.
    - The estimated Page Number in the PDF where this value appears (e.g., "1").
    - The Data Type of the field based on the XML value (e.g., "String", "Date", "Currency", "Integer", "Boolean").
    - Use the provided Template Name for the 'templateName' field.
6.  Compile a list of all successful mappings.
7.  Format the final output as a JSON array of objects.
8.  The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.`;

/**
 * DATA_MAPPING_PROMPT — instructs Gemini to identify dynamic placeholder fields
 * in a Word document and map each one to the correct XSD element path, then
 * generate a valid sample XML document conforming to that schema.
 */
export const DATA_MAPPING_PROMPT = `\
You are an expert template designer and data architect. Your task is to map placeholder fields from a Word document template to the correct elements in an XML Schema Definition (XSD) and generate a valid sample XML.

Instructions:
1.  You will be provided with the text content of a Word document, the document's filename (Template Name), and the full text of an XSD (XML Schema Definition) file.
2.  Identify Dynamic Fields: Scan the Word document text for potential dynamic fields. These will be identified by patterns like <placeholder>, [placeholder], or common business terms (e.g., "City", "Account Number", "Recipient Name").
3.  Strict Filtering: ONLY include fields that are explicitly identified in the Word document. Do NOT list all fields from the XSD schema.
4.  Analyze XSD Schema: Parse the provided XSD content to understand the schema structure. Look for 'xs:element', 'xs:complexType', and 'xs:attribute' definitions to identify valid XML structure and paths.
5.  AI-Powered Mapping: For each field identified in the Word document, determine the correct XPath to the corresponding leaf element within the XSD schema.
6.  Sample Data Priority:
    - Priority 1: If the Word document contains actual data next to a field (e.g., "Name: John Smith"), use that data ("John Smith") as the sampleValue.
    - Priority 2: If no data is found for an identified field, generate a realistic, synthetic sample value based on the field name and XSD type.
7.  Metadata:
    - Use the provided Template Name for the 'templateName' field in the output.
    - Estimate the 'pageNumber' where the field likely appears based on text flow.
8.  Generate XML: Create a valid XML string that strictly conforms to the provided XSD structure. Populate elements corresponding to the mapped fields with sample data. Ensure the XML is well-formed and valid against the schema.
9.  Format the Output: Return a JSON object with two keys:
    - "mappings": An array of objects where each object contains "field", "xsdPath", "sampleValue", "templateName", and "pageNumber".
    - "generatedXml": A string containing the full, valid XML with populated data.
10. The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.`;

/**
 * SYNTHETIC_DATA_PROMPT — instructs Gemini to parse an XSD schema and
 * synthesise a realistic XML document along with a flat field-value catalogue.
 */
export const SYNTHETIC_DATA_PROMPT = `\
You are an expert data architect and XML specialist. Your task is to analyze the provided XML Schema (XSD) and generate a valid XML document populated with realistic, synthetic data.

Instructions:
1.  Parse the XSD to understand the structure, elements, attributes, and data types.
2.  Generate a valid XML document that strictly conforms to the schema.
3.  Synthetic Data Generation: For every element and attribute, generate realistic, high-quality synthetic data based on its name and type:
    - Names: "John Doe", "Jane Smith"
    - Addresses: "782 Mallard Ln", "123 Main St"
    - Dates: Realistic dates in the format required by the schema.
    - Numbers: Realistic values appropriate for counts, prices, identifiers, etc.
4.  Ensure the XML is well-formed and valid against the provided XSD.
5.  Format the final output as a JSON object with:
    - "fields": A JSON array of objects, where each object has a "field" key (the element or attribute name) and a "value" key (the generated synthetic value).
    - "generatedXml": A string containing the full, valid XML.
6.  The entire response must be ONLY the JSON object. Do not include any other text, comments, or markdown formatting.`;

/**
 * SEMANTIC_COMPARE_PROMPT — instructs Gemini to compare two document pages
 * and return an array of meaningful semantic differences, ignoring cosmetic
 * phrasing variations when the core meaning is unchanged.
 */
export const SEMANTIC_COMPARE_PROMPT = `\
You are a meticulous quality assurance analyst. Your task is to compare two pages of a document and identify all semantic differences.

Instructions:
1.  You will be given the text content of "Page A" and "Page B".
2.  Analyze their meaning, intent, and the information they convey.
3.  Ignore minor differences in wording, phrasing, punctuation, or layout if the core meaning remains identical.
4.  Identify substantive differences in meaning, missing information, or added information.
5.  For each semantic difference, provide:
    - "textA": The specific snippet of text from Page A that is different or missing in Page B. Use an empty string if the content is entirely new in Page B.
    - "textB": The specific snippet of text from Page B that is different or missing in Page A. Use an empty string if the content was removed from Page A.
    - "reason": A brief, one-sentence explanation of the semantic difference.
6.  Format the final output as a JSON array of objects.
7.  The entire response must be ONLY the JSON array. Do not include any other text, comments, or markdown formatting.`;

/**
 * LAYOUT_PROMPT — instructs Gemini to reformat a customer communication
 * document into a concise email version and an ultra-compact WhatsApp version.
 */
export const LAYOUT_PROMPT = `\
You are a customer communications specialist. Analyze the provided customer communication document and reformat it into two concise versions.

Instructions:
1.  EMAIL VERSION: A professional, condensed version optimized for email delivery.
    - Structure: Subject line (prefixed "Subject: "), then a blank line, then the body.
    - Body: 2–4 short paragraphs. Each paragraph separated by a blank line (\\n\\n).
    - Retain all key information — dates, action items, account/reference numbers, contact details.
    - Remove marketing filler and repetition. Keep a professional tone.
    - Use ONLY plain text. Separate paragraphs with two newline characters (\\n\\n). No markdown.

2.  WHATSAPP VERSION: An ultra-condensed version for WhatsApp (5–7 lines maximum).
    - Include ONLY the most critical information: required action, key dates/deadlines, important reference numbers.
    - Plain language, short sentences. Each key point on its own line separated by a single newline (\\n).

Return a JSON object with exactly two keys:
- "emailVersion": the email text as described above, using \\n\\n between paragraphs.
- "whatsappVersion": the WhatsApp text, using \\n between points.
The entire response must be ONLY the JSON object.`;
