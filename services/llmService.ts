import * as gemini from './geminiService';
import * as claude from './claudeService';
import * as openai from './openaiService';
import { XPathMapping, DataMappingResult, SyntheticDataResult, LayoutRecommendationResult, AccessibilityResult, BusinessRulesResult, TestCaseResult } from '../types';
import { SETTINGS_STORAGE_KEY } from '../contexts/SettingsContext';

function getProvider(): 'claude' | 'gemini' | 'openai' {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
        if (s.llmProvider === 'claude') return 'claude';
        if (s.llmProvider === 'openai') return 'openai';
        return 'gemini';
    } catch {
        return 'gemini';
    }
}

export const generateSyntheticDataFromXsd = (xsdContent: string): Promise<SyntheticDataResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.generateSyntheticDataFromXsd(xsdContent);
    if (p === 'openai') return openai.generateSyntheticDataFromXsd(xsdContent);
    return gemini.generateSyntheticDataFromXsd(xsdContent);
};

export const extractXPaths = (
    pdfBase64: string,
    pdfMimeType: string,
    xmlContent: string,
    templateName: string
): Promise<XPathMapping[]> => {
    const p = getProvider();
    if (p === 'claude') return claude.extractXPaths(pdfBase64, pdfMimeType, xmlContent, templateName);
    if (p === 'openai') return openai.extractXPaths(pdfBase64, pdfMimeType, xmlContent, templateName);
    return gemini.extractXPaths(pdfBase64, pdfMimeType, xmlContent, templateName);
};

export const generateDataMap = (
    docxContent: string,
    xsdContent: string,
    templateName: string
): Promise<DataMappingResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.generateDataMap(docxContent, xsdContent, templateName);
    if (p === 'openai') return openai.generateDataMap(docxContent, xsdContent, templateName);
    return gemini.generateDataMap(docxContent, xsdContent, templateName);
};

export const performSemanticComparison = (
    textA: string,
    textB: string
): Promise<Array<{ textA: string; textB: string; reason: string; kind: 'diff' | 'same' }>> => {
    const p = getProvider();
    if (p === 'claude') return claude.performSemanticComparison(textA, textB);
    if (p === 'openai') return openai.performSemanticComparison(textA, textB);
    return gemini.performSemanticComparison(textA, textB);
};

export const generateLayoutRecommendations = (documentText: string): Promise<LayoutRecommendationResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.generateLayoutRecommendations(documentText);
    if (p === 'openai') return openai.generateLayoutRecommendations(documentText);
    return gemini.generateLayoutRecommendations(documentText);
};

export const scoreAccessibility = (
    documentText: string,
    fileName: string
): Promise<AccessibilityResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.scoreAccessibility(documentText, fileName);
    if (p === 'openai') return openai.scoreAccessibility(documentText, fileName);
    return gemini.scoreAccessibility(documentText, fileName);
};

export const extractBusinessRules = (docText: string): Promise<BusinessRulesResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.extractBusinessRules(docText);
    if (p === 'openai') return openai.extractBusinessRules(docText);
    return gemini.extractBusinessRules(docText);
};

export const generateTestCases = (rulesAndHints: string): Promise<TestCaseResult> => {
    const p = getProvider();
    if (p === 'claude') return claude.generateTestCases(rulesAndHints);
    if (p === 'openai') return openai.generateTestCases(rulesAndHints);
    return gemini.generateTestCases(rulesAndHints);
};

// Embeddings are always computed client-side
export const embedContentBatch = gemini.embedContentBatch;
