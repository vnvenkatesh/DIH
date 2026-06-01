
import React, { useState, useCallback } from 'react';
import { SyntheticDataResult } from '../types';
import { generateSyntheticDataFromXsd } from '../services/llmService';
import ResultsTable from './ResultsTable';
import Loader from './Loader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { XmlFileIcon } from './icons/XmlFileIcon';
import FileUploader from './FileUploader';

const SyntheticDataGenerator: React.FC = () => {
  const [xsdFile, setXsdFile] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<any[] | null>(null);
  const [generatedXml, setGeneratedXml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fileToString = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsText(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
  };

  const handleProcessXsd = useCallback(async () => {
    if (!xsdFile) {
      setError('Please select an XSD file.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setExtractedData(null);
    setGeneratedXml(null);

    try {
        const xsdContent = await fileToString(xsdFile);
        const result = await generateSyntheticDataFromXsd(xsdContent);
        
        setExtractedData(result.fields);
        setGeneratedXml(result.generatedXml || null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [xsdFile]);

  const handleReset = () => {
    setXsdFile(null);
    setExtractedData(null);
    setGeneratedXml(null);
    setError(null);
    setIsLoading(false);
  }

  const handleDownloadXml = () => {
    if (!generatedXml) return;
    const blob = new Blob([generatedXml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synthetic_data.xml';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    if (!extractedData) return;

    const headers = ['Field', 'Synthetic Value'];
    const csvRows = [
        headers.join(','),
        ...extractedData.map(row => 
            `"${row.field.replace(/"/g, '""')}","${row.value.replace(/"/g, '""')}"`
        )
    ];
    
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'synthetic_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultHeaders = [
    { key: 'field', label: 'Field / Element', className: 'w-1/2' },
    { key: 'value', label: 'Generated Synthetic Value' },
  ];

  const totalFields = extractedData ? extractedData.length : 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
      <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
            <DocumentTextIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            Synthetic Data Generation
          </h2>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Upload an XML Schema (XSD) to generate a valid XML document populated with realistic synthetic data.
          </p>
      </div>

      {!extractedData && !isLoading && (
        <div className="max-w-xl mx-auto">
            <div className="space-y-4">
                <h3 className="text-sm font-semibold text-center text-slate-700 dark:text-slate-300">Upload XML Schema (XSD)</h3>
                {!xsdFile ? (
                    <FileUploader 
                        onFileChange={setXsdFile}
                        acceptedFileType='.xsd'
                        fileTypeName='XSD Schema'
                        icon={<XmlFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />}
                    />
                ) : (
                    <div className="bg-slate-100 dark:bg-slate-700 p-8 rounded-lg text-slate-700 dark:text-slate-300 flex flex-col justify-center items-center border-2 border-dashed border-green-500">
                        <XmlFileIcon className="w-12 h-12 mb-4 text-green-600 dark:text-green-400" />
                        <p className="font-semibold text-green-600 dark:text-green-400 text-lg">XSD Ready</p>
                        <p className="text-sm truncate w-full px-4 text-center mt-1">{xsdFile.name}</p>
                        <button onClick={() => setXsdFile(null)} className='text-sm text-indigo-500 hover:underline mt-4'>Change File</button>
                    </div>
                )}
            </div>

            {xsdFile && (
                <div className="text-center mt-8">
                    <button
                        onClick={handleProcessXsd}
                        className="bg-indigo-600 text-white font-bold py-4 px-10 rounded-xl hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 shadow-lg"
                    >
                        Generate Synthetic XML
                    </button>
                </div>
            )}
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

      {extractedData && (
        <div>
           {/* Summary Section */}
           <div className="mb-6 bg-slate-100 dark:bg-slate-700 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">Generation Summary</h3>
                    <p className="text-slate-600 dark:text-slate-300 text-sm">
                        Generated synthetic data for <span className="font-bold text-indigo-600 dark:text-indigo-400">{totalFields}</span> elements/attributes from the schema.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleDownloadCsv}
                        className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white border border-slate-300 dark:border-slate-600 font-medium py-2 px-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors text-sm"
                    >
                        Download CSV
                    </button>
                    {generatedXml && (
                        <button
                            onClick={handleDownloadXml}
                            className="bg-indigo-600 text-white font-medium py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors text-sm"
                        >
                            Download XML
                        </button>
                    )}
                </div>
            </div>

          <ResultsTable data={extractedData} headers={resultHeaders} title="Extraction Results" />
          
          {generatedXml && (
            <div className="mt-6">
                <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">Generated XML Preview</h3>
                <pre className="w-full h-64 overflow-auto bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-300 scrollbar-thin">
                    {generatedXml}
                </pre>
            </div>
          )}
          
          <div className="text-center mt-8">
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

export default SyntheticDataGenerator;
