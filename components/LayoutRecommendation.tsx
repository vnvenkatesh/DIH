
import React, { useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import { LayoutRecommendationResult } from '../types';
import { generateLayoutRecommendations } from '../services/llmService';
import FileUploader from './FileUploader';
import Loader from './Loader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { WordFileIcon } from './icons/WordFileIcon';

// ---------- Copy button ----------
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // fallback for non-secure contexts
            const el = document.createElement('textarea');
            el.value = text;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-all duration-200 ${
                copied
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-500 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600'
            }`}
        >
            {copied ? (
                <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Copied!
                </>
            ) : (
                <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                    </svg>
                    Copy
                </>
            )}
        </button>
    );
};

// ---------- Output card ----------
interface OutputCardProps {
    title: string;
    subtitle: string;
    accentClass: string;
    badgeClass: string;
    content: string;
}

const OutputCard: React.FC<OutputCardProps> = ({ title, subtitle, accentClass, badgeClass, content }) => (
    <div className={`flex flex-col rounded-xl border-2 ${accentClass} bg-white dark:bg-slate-800 overflow-hidden`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <div>
                <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full mb-1 ${badgeClass}`}>{title}</span>
                <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            </div>
            <CopyButton text={content} />
        </div>
        <div className="flex-1 p-4 space-y-3">
            {content.split(/\n\n+/).map((para, i) => (
                <p key={i} className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {para.split('\n').map((line, j, arr) => (
                        <React.Fragment key={j}>
                            {line}
                            {j < arr.length - 1 && <br />}
                        </React.Fragment>
                    ))}
                </p>
            ))}
        </div>
    </div>
);

// ---------- Main component ----------
const LayoutRecommendation: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [result, setResult] = useState<LayoutRecommendationResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const extractTextFromPdf = async (file: File): Promise<string> => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer }).promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            pages.push(content.items.map((item: any) => item.str).join(' '));
        }
        return pages.join('\n');
    };

    const extractTextFromDocx = async (file: File): Promise<string> => {
        const arrayBuffer = await file.arrayBuffer();
        try {
            const result = await mammoth.extractRawText({ arrayBuffer });
            return result.value;
        } catch {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsText(file);
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
            });
        }
    };

    const handleProcess = useCallback(async () => {
        if (!file) return;

        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            let text = '';
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                text = await extractTextFromPdf(file);
            } else {
                text = await extractTextFromDocx(file);
            }

            if (!text.trim()) throw new Error('Could not extract text from the document. Please check the file and try again.');

            const output = await generateLayoutRecommendations(text);
            setResult(output);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [file]);

    const handleReset = () => {
        setFile(null);
        setResult(null);
        setError(null);
        setIsLoading(false);
    };

    const isPdf = file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Layout Recommendation</h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Upload a customer communication document to get an optimised Email version and a super-condensed WhatsApp version.
                </p>
            </div>

            {/* Upload */}
            {!result && !isLoading && (
                <div className="max-w-xl mx-auto">
                    {!file ? (
                        <FileUploader
                            onFileChange={setFile}
                            acceptedFileType=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                            fileTypeName="PDF or Word Document"
                            icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                        />
                    ) : (
                        <div className="bg-slate-100 dark:bg-slate-700 p-8 rounded-lg flex flex-col items-center border-2 border-dashed border-green-500">
                            {isPdf
                                ? <PdfFileIcon className="w-12 h-12 mb-3 text-green-600 dark:text-green-400" />
                                : <WordFileIcon className="w-12 h-12 mb-3 text-green-600 dark:text-green-400" />
                            }
                            <p className="font-semibold text-green-600 dark:text-green-400 text-lg">File Ready</p>
                            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 text-center truncate w-full px-4">{file.name}</p>
                            <button onClick={() => setFile(null)} className="text-sm text-indigo-500 hover:underline mt-4">Change File</button>
                        </div>
                    )}

                    {file && (
                        <div className="text-center mt-8">
                            <button
                                onClick={handleProcess}
                                className="bg-indigo-600 text-white font-bold py-4 px-10 rounded-xl hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 shadow-lg"
                            >
                                Generate Layout Recommendations
                            </button>
                        </div>
                    )}
                </div>
            )}

            {isLoading && <Loader />}

            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p className="mt-1">{error}</p>
                    <button
                        onClick={handleReset}
                        className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {result && (
                <div>
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Recommendations for <span className="text-indigo-600 dark:text-indigo-400">{file?.name}</span></h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Two channel-optimised versions generated below.</p>
                        </div>
                        <button
                            onClick={handleReset}
                            className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline"
                        >
                            Start over
                        </button>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        <OutputCard
                            title="Email"
                            subtitle="Condensed · professional tone · all key info retained"
                            accentClass="border-blue-400 dark:border-blue-600"
                            badgeClass="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                            content={result.emailVersion}
                        />
                        <OutputCard
                            title="WhatsApp"
                            subtitle="Ultra-condensed · plain language · action items only"
                            accentClass="border-green-400 dark:border-green-600"
                            badgeClass="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                            content={result.whatsappVersion}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default LayoutRecommendation;
