
import React, { useState, useCallback, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { DocumentGroup, ProcessedDocument } from '../types';
import { embedContentBatch } from '../services/llmService';
import FileUploader from './FileUploader';
import ToggleSwitch from './ToggleSwitch';
import { Squares2X2Icon } from './icons/Squares2X2Icon';

interface RationalizerProps {
    onCompareRequest: (files: [File, File]) => void;
}

// A simple cosine similarity function
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
};

const GroupCard: React.FC<{ group: DocumentGroup, onCompareRequest: (files: [File, File]) => void }> = ({ group, onCompareRequest }) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    const handleSelectionChange = (file: File) => {
        setSelectedFiles(prev => {
            if (prev.includes(file)) {
                return prev.filter(f => f !== file);
            }
            if (prev.length < 2) {
                return [...prev, file];
            }
            return prev;
        });
    };
    
    const handleCompare = () => {
        if (selectedFiles.length === 2) {
            onCompareRequest(selectedFiles as [File, File]);
        }
    }

    return (
         <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center mb-3">
                 <p className="font-bold text-indigo-600 dark:text-indigo-400">
                    Group {group.id + 1} - {group.documents.length} Documents
                    <span className="ml-2 text-sm font-medium text-white bg-indigo-500 dark:bg-indigo-600 px-2 py-0.5 rounded-full">{group.similarity}% similar</span>
                </p>
                <button 
                    onClick={handleCompare}
                    disabled={selectedFiles.length !== 2}
                    className="bg-indigo-500 text-white text-xs font-bold py-1 px-3 rounded-md hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                >
                    Compare Selected ({selectedFiles.length})
                </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex justify-center items-center bg-slate-200 dark:bg-slate-900 p-2 rounded-md">
                    <img src={group.documents[0].thumbnail} alt="Document thumbnail" className="max-w-full h-auto shadow-md" />
                </div>
                <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 overflow-y-auto max-h-48">
                    {group.documents.map(doc => (
                        <li key={doc.file.name}>
                           <label className="flex items-center space-x-2 cursor-pointer">
                                <input 
                                    type="checkbox"
                                    checked={selectedFiles.includes(doc.file)}
                                    onChange={() => handleSelectionChange(doc.file)}
                                    disabled={!selectedFiles.includes(doc.file) && selectedFiles.length >= 2}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                                />
                                <span>{doc.file.name}</span>
                           </label>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const Rationalizer: React.FC<RationalizerProps> = ({ onCompareRequest }) => {
    const [files, setFiles] = useState<File[]>([]);
    const [groupingMode, setGroupingMode] = useState<'exact' | 'semantic'>('semantic');
    const [similarityThreshold, setSimilarityThreshold] = useState<number>(80);
    const [results, setResults] = useState<DocumentGroup[] | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;
    }, []);

    const handleMultiFileChange = (selectedFiles: FileList | null) => {
        if (selectedFiles) {
            setFiles(Array.from(selectedFiles));
        }
    }

    const processPdf = async (file: File): Promise<ProcessedDocument> => {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        // Extract text
        const textContent = [];
        const numPages = pdf.numPages || 0;
        console.log(`Processing ${file.name}: reported ${numPages} pages`);

        for (let i = 1; i <= numPages; i++) {
            try {
                // Double check bounds before calling getPage
                if (i > pdf.numPages) {
                    console.warn(`Skipping page ${i} of ${file.name} as it exceeds current numPages (${pdf.numPages})`);
                    break;
                }
                const page = await pdf.getPage(i);
                const tc = await page.getTextContent();
                textContent.push(tc.items.map(item => 'str' in item ? item.str : '').join(' '));
            } catch (pageErr) {
                console.error(`Error processing page ${i} of ${file.name} (Total pages: ${pdf.numPages})`, pageErr);
            }
        }
        const fullText = textContent.join('\n').trim().toLowerCase().replace(/\s+/g, ' ');
        
        // Generate thumbnail
        let thumbnail = "";
        if (numPages > 0) {
            try {
                const firstPage = await pdf.getPage(1);
                const viewport = firstPage.getViewport({ scale: 0.3 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                if(context) {
                    await firstPage.render({ canvasContext: context, viewport: viewport } as any).promise;
                    thumbnail = canvas.toDataURL();
                }
            } catch (thumbErr) {
                console.error(`Error generating thumbnail for ${file.name}`, thumbErr);
            }
        }

        // Cleanup
        await pdf.destroy();

        return { file, text: fullText, thumbnail };
    };

    const handleProcess = useCallback(async () => {
        if (files.length < 2) {
            setError('Please select at least two PDF files to rationalize.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setResults(null);
        
        try {
            setLoadingMessage(`Processing ${files.length} documents...`);
            
            // Process documents in smaller batches or sequentially to avoid worker overload
            const processedDocs: ProcessedDocument[] = [];
            for (let i = 0; i < files.length; i++) {
                setLoadingMessage(`Processing document ${i + 1} of ${files.length}: ${files[i].name}`);
                const doc = await processPdf(files[i]);
                processedDocs.push(doc);
            }

            let groups: DocumentGroup[] = [];
            if (groupingMode === 'exact') {
                setLoadingMessage('Calculating hashes...');
                const hashGroups: { [key: string]: ProcessedDocument[] } = {};
                for (const doc of processedDocs) {
                    const buffer = new TextEncoder().encode(doc.text);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    if (!hashGroups[hashHex]) {
                        hashGroups[hashHex] = [];
                    }
                    hashGroups[hashHex].push(doc);
                }
                groups = Object.values(hashGroups)
                    .filter(g => g.length > 1)
                    .map((docs, i) => ({ id: i, documents: docs, similarity: 100 }));
            
            } else { // Semantic grouping
                setLoadingMessage('Generating AI embeddings...');
                // Filter out documents with no text to avoid API errors
                const docsToEmbed = processedDocs.map(d => d.text.trim() || "empty document");
                const embeddings = await embedContentBatch(docsToEmbed);
                for(let i = 0; i < processedDocs.length; i++) {
                    processedDocs[i].embedding = embeddings[i];
                }

                setLoadingMessage('Clustering documents...');
                // Agglomerative Clustering
                const clusters: ProcessedDocument[][] = processedDocs.map(doc => [doc]);
                let similarities: { i: number, j: number, sim: number }[] = [];

                for (let i = 0; i < clusters.length; i++) {
                    for (let j = i + 1; j < clusters.length; j++) {
                        const sim = cosineSimilarity(clusters[i][0].embedding!, clusters[j][0].embedding!);
                        similarities.push({ i, j, sim });
                    }
                }

                similarities.sort((a, b) => b.sim - a.sim);

                const merged = new Array(clusters.length).fill(false);
                const finalClusters: ProcessedDocument[][] = [];
                const threshold = similarityThreshold / 100;
                
                for(const {i, j, sim} of similarities) {
                    if (sim < threshold) break;
                    if(!merged[i] && !merged[j]){
                        merged[i] = true;
                        merged[j] = true;
                        finalClusters.push([...clusters[i], ...clusters[j]]);
                    } else if (merged[i] && !merged[j]) {
                         const clusterIndex = finalClusters.findIndex(c => c.includes(clusters[i][0]));
                         if(clusterIndex !== -1) {
                            finalClusters[clusterIndex].push(...clusters[j]);
                            merged[j] = true;
                         }
                    } else if (!merged[i] && merged[j]) {
                        const clusterIndex = finalClusters.findIndex(c => c.includes(clusters[j][0]));
                        if(clusterIndex !== -1) {
                           finalClusters[clusterIndex].push(...clusters[i]);
                           merged[i] = true;
                        }
                    }
                }
                 // Add unmerged clusters if they weren't part of any merge
                for(let i=0; i<clusters.length; i++) {
                    if(!merged[i]) finalClusters.push(clusters[i]);
                }
                
                groups = finalClusters
                    .filter(g => g.length > 1)
                    .map((docs, i) => {
                        let avgSimilarity = 0;
                        if (docs.length > 1) {
                             const firstEmbedding = docs[0].embedding!;
                             avgSimilarity = docs.slice(1).reduce((sum, doc) => sum + cosineSimilarity(firstEmbedding, doc.embedding!), 0) / (docs.length - 1);
                        }
                        return { id: i, documents: docs, similarity: Math.round(avgSimilarity * 100) };
                    }).filter(g => g.similarity >= similarityThreshold);
            }
            
            setResults(groups);

        } catch (err: any) {
            console.error("Rationalization Error:", err);
            const message = err.message || 'An unexpected error occurred during rationalization.';
            setError(`Rationalization failed: ${message}. Please check your files and try again.`);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }

    }, [files, groupingMode, similarityThreshold]);
    
    const handleReset = () => {
        setFiles([]);
        setResults(null);
        setError(null);
        setIsLoading(false);
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
             <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                    <Squares2X2Icon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    Rationalizer
                </h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Group a collection of PDFs by exact content or semantic similarity to find redundancies.
                </p>
            </div>

            {results === null && !isLoading && (
                <div className="space-y-6">
                    <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4">
                        <label htmlFor="multi-file-upload" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                           {files.length > 0 ? `${files.length} files selected` : 'Select Multiple PDF Files'}
                        </label>
                        <input
                            id="multi-file-upload"
                            type="file"
                            multiple
                            accept="application/pdf"
                            onChange={(e) => handleMultiFileChange(e.target.files)}
                            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                        />
                        {files.length > 0 && 
                            <ul className="mt-3 text-xs list-disc list-inside text-slate-500 dark:text-slate-400 max-h-24 overflow-y-auto">
                                {files.map(f => <li key={f.name}>{f.name}</li>)}
                            </ul>
                        }
                    </div>
                    
                     <ToggleSwitch
                        leftLabel="Exact Content"
                        rightLabel="Semantic Closeness"
                        enabled={groupingMode === 'semantic'}
                        onChange={(enabled) => setGroupingMode(enabled ? 'semantic' : 'exact')}
                    />

                    {groupingMode === 'semantic' && (
                        <div className='space-y-2'>
                            <label htmlFor="similarity-threshold" className="block text-sm font-medium text-center text-slate-700 dark:text-slate-300">
                                Similarity Threshold: <span className="font-bold text-indigo-600 dark:text-indigo-400">{similarityThreshold}%</span>
                            </label>
                            <input
                                id="similarity-threshold"
                                type="range"
                                min="70"
                                max="99"
                                value={similarityThreshold}
                                onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer dark:bg-slate-700"
                            />
                        </div>
                    )}
                     <div className="text-center">
                        <button
                            onClick={handleProcess}
                            disabled={files.length < 2}
                            className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100 inline-flex items-center gap-2"
                        >
                            <Squares2X2Icon className="w-5 h-5" />
                            Group Documents
                        </button>
                    </div>
                </div>
            )}
            
            {isLoading && (
                <div className="flex flex-col items-center justify-center p-10">
                  <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500"></div>
                  <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">{loadingMessage || 'Processing...'}</p>
                </div>
            )}

            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p>{error}</p>
                    <button onClick={handleReset} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors">Try Again</button>
                </div>
            )}

            {results !== null && !isLoading && (
                <div>
                     <div className="text-center mb-6">
                        <h3 className="text-xl font-bold">Rationalization Results</h3>
                         {results.length > 0 ? (
                            <p className="text-slate-600 dark:text-slate-400">Found {results.length} group{results.length > 1 ? 's' : ''} of similar documents.</p>
                        ) : (
                            <p className="mt-4 text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">No groups of similar documents were found with the current settings.</p>
                        )}
                    </div>
                    
                    <div className="space-y-6">
                        {results.map(group => (
                           <GroupCard key={group.id} group={group} onCompareRequest={onCompareRequest} />
                        ))}
                    </div>

                    <div className="text-center mt-8">
                        <button onClick={handleReset} className="bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-indigo-700">Reset</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Rationalizer;
