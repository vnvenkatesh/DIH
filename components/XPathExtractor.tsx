
import React, { useState, useCallback } from 'react';
import { XPathMapping } from '../types';
import { extractXPaths } from '../services/llmService';
import FileUploader from './FileUploader';
import ResultsTable from './ResultsTable';
import Loader from './Loader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { XmlFileIcon } from './icons/XmlFileIcon';

const XPathExtractor: React.FC = () => {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [xmlFile, setXmlFile] = useState<File | null>(null);
    const [results, setResults] = useState<XPathMapping[] | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = (error) => reject(error);
        });
    };

    const fileToString = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsText(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
        });
    };

    const handleProcess = useCallback(async () => {
        if (!pdfFile || !xmlFile) {
            setError('Please select both a PDF and an XML file.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setResults(null);

        try {
            const pdfBase64 = await fileToBase64(pdfFile);
            const xmlContent = await fileToString(xmlFile);
            // Pass the PDF filename as the template name
            const extractedResults = await extractXPaths(pdfBase64, pdfFile.type, xmlContent, pdfFile.name);
            const safeResults = Array.isArray(extractedResults) ? extractedResults : [];
            if (safeResults.length === 0) {
                setError('No matching fields were found between the PDF and XML. Ensure the PDF content corresponds to the uploaded XML file.');
                return;
            }
            setResults(safeResults);
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [pdfFile, xmlFile]);
    
    const handleReset = () => {
        setPdfFile(null);
        setXmlFile(null);
        setResults(null);
        setError(null);
        setIsLoading(false);
    };

    const handleDownloadCsv = () => {
        if (!results) return;

        const headers = ['Template Name', 'Page Number', 'Field Type', 'Value from PDF', 'Corresponding XPath'];
        const csvRows = [
            headers.join(','),
            ...results.map(row => 
                `"${row.templateName || ''}","${row.pageNumber || ''}","${row.fieldType || ''}","${row.value.replace(/"/g, '""')}","${row.xpath.replace(/"/g, '""')}"`
            )
        ];
        
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'xpath_mappings.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const resultHeaders = [
        { key: 'templateName', label: 'Template Name', className: 'w-48' },
        { key: 'pageNumber', label: 'Page', className: 'w-20 text-center' },
        { key: 'fieldType', label: 'Type', className: 'w-32' },
        { key: 'value', label: 'Value from PDF', className: 'w-1/4' },
        { key: 'xpath', label: 'Corresponding XPath', className: 'break-all' },
    ];
    
    const bothFilesReady = pdfFile && xmlFile;
    
    // Calculate stats
    const totalPaths = results ? results.length : 0;
    const uniquePaths = results ? new Set(results.map(r => r.xpath)).size : 0;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">XPath Extractor</h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Upload a PDF and its source XML to map dynamic data fields to their XPaths.
                </p>
            </div>

            {!results && !isLoading && (
                 <div className="grid md:grid-cols-2 gap-6 mb-6">
                    <div>
                        {!pdfFile ? (
                             <FileUploader 
                                onFileChange={setPdfFile}
                                acceptedFileType='application/pdf'
                                fileTypeName='PDF'
                                icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                            />
                        ) : (
                            <div className="bg-slate-100 dark:bg-slate-700 p-4 h-full rounded-lg text-slate-700 dark:text-slate-300 flex flex-col justify-center items-center">
                                <p className="font-semibold text-green-600 dark:text-green-400">PDF Ready:</p>
                                <p className="text-sm truncate w-full px-4 text-center">{pdfFile.name}</p>
                                <button onClick={() => setPdfFile(null)} className='text-xs text-indigo-500 hover:underline mt-2'>Change</button>
                            </div>
                        )}
                    </div>
                    <div>
                       {!xmlFile ? (
                            <FileUploader 
                                onFileChange={setXmlFile}
                                acceptedFileType='application/xml, text/xml'
                                fileTypeName='XML'
                                icon={<XmlFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                            />
                       ) : (
                            <div className="bg-slate-100 dark:bg-slate-700 p-4 h-full rounded-lg text-slate-700 dark:text-slate-300 flex flex-col justify-center items-center">
                                <p className="font-semibold text-green-600 dark:text-green-400">XML Ready:</p>
                                <p className="text-sm truncate w-full px-4 text-center">{xmlFile.name}</p>
                                <button onClick={() => setXmlFile(null)} className='text-xs text-indigo-500 hover:underline mt-2'>Change</button>
                            </div>
                       )}
                    </div>
                </div>
            )}
           
            {!isLoading && !results && (
                 <div className="text-center">
                    <button
                        onClick={handleProcess}
                        disabled={!bothFilesReady}
                        className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100"
                    >
                        Process Files
                    </button>
                </div>
            )}


            {isLoading && <Loader />}
            
            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p>{error}</p>
                    <button
                        onClick={handleReset}
                        className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {results && (
                <div>
                    {/* Summary Section */}
                    <div className="mb-6 bg-slate-100 dark:bg-slate-700 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center gap-4">
                        <div>
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Extraction Summary</h3>
                             <p className="text-slate-600 dark:text-slate-300 text-sm">
                                Found <span className="font-bold text-indigo-600 dark:text-indigo-400">{totalPaths}</span> total paths (<span className="font-bold text-indigo-600 dark:text-indigo-400">{uniquePaths}</span> unique).
                            </p>
                        </div>
                        <button
                            onClick={handleDownloadCsv}
                            className="bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors text-sm"
                        >
                            Download XPaths (CSV)
                        </button>
                    </div>

                    <ResultsTable data={results} headers={resultHeaders} title="XPath Extraction Results" />
                    
                    <div className="text-center mt-8 flex justify-center gap-4">
                        <button
                            onClick={handleReset}
                            className="bg-slate-200 text-slate-700 font-bold py-3 px-6 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-300 dark:focus:ring-slate-700 transition-all duration-300"
                        >
                            Reset / Start Over
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default XPathExtractor;
