
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ComparisonDifference, Highlight } from '../types';
import { performSemanticComparison } from '../services/llmService';
import FileUploader from './FileUploader';
import { PdfFileIcon } from './icons/PdfFileIcon';
import { ArrowsRightLeftIcon } from './icons/ArrowsRightLeftIcon';
import ToggleSwitch from './ToggleSwitch';
import { diffArrays, diffWordsWithSpace } from 'diff';


// FIX: Define TextItem type derived from pdfjsLib to solve export issue in some versions.
// FIX: Replaced `pdfjs-dist` with the imported alias `pdfjsLib`. The hyphen in `pdfjs-dist` was causing the TypeScript parser to misinterpret the type definition as an arithmetic operation, leading to a cascade of errors.
type PdfTextItem = Extract<Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>['items'][number], { str: string }>;

interface TextItemWithBounds extends PdfTextItem {
    x: number;
    y: number;
    w: number;
    h: number;
    str: string;
}

interface PdfCompareProps {
    initialFiles?: [File, File] | null;
    onInitialFilesConsumed: () => void;
}

interface FlatDifference {
    page: number;
    diffIndexInPage: number;
    uniqueIdA: string;
    uniqueIdB: string;
}

const Tooltip: React.FC<{ content: React.ReactNode; top: number; left: number }> = ({ content, top, left }) => (
    <div
      className="absolute z-50 p-2 text-xs font-medium text-white bg-slate-900 rounded-lg shadow-sm dark:bg-slate-700 max-w-xs pointer-events-none"
      style={{ top, left, transform: 'translate(-50%, -110%)' }}
    >
      {content}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[-4px] w-0 h-0 border-l-4 border-l-transparent border-r-4 border-r-transparent border-t-4 border-t-slate-900 dark:border-t-slate-700"></div>
    </div>
);

const PdfSinglePage: React.FC<{ doc: pdfjsLib.PDFDocumentProxy; pageNum: number; }> = ({ doc, pageNum }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;
        
        let isCancelled = false;
        
        if (pageNum < 1 || pageNum > doc.numPages) {
            console.warn(`Invalid page request: ${pageNum} of ${doc.numPages}`);
            return;
        }
        
        doc.getPage(pageNum).then(page => {
            if (isCancelled) return;
            const viewport = page.getViewport({ scale: 1.5 });
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderTask = page.render({ canvasContext: context, viewport: viewport } as any);
            renderTaskRef.current = renderTask;

            renderTask.promise.catch(err => {
                if (err.name !== 'AbortException') {
                    console.error(`Failed to render page ${pageNum}`, err);
                }
            }).finally(() => {
                 renderTaskRef.current = null;
            });
        }).catch(err => {
            console.error(`Error getting page ${pageNum}`, err);
        });

        return () => {
            isCancelled = true;
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [doc, pageNum]);

    return <canvas ref={canvasRef} id={`canvas-page-${pageNum}`} className="block" />;
};


const PdfPages: React.FC<{
    doc: pdfjsLib.PDFDocumentProxy | null;
    side: 'A' | 'B';
    results: ComparisonDifference[] | null;
    currentDifferenceIndex: number | null;
    flatDifferences: FlatDifference[];
    highlightElementRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
    onMouseEnter: (e: React.MouseEvent, content: React.ReactNode) => void;
    onMouseLeave: () => void;
}> = ({ doc, side, results, currentDifferenceIndex, flatDifferences, highlightElementRefs, onMouseEnter, onMouseLeave }) => {
    if (!doc) return null;

    return (
        <div>
            {Array.from(new Array(doc.numPages), (_, index) => {
                const pageNum = index + 1;
                const pageResult = results?.find(r => r.page === pageNum);
                
                return (
                    <div key={`page-wrapper-${pageNum}`} id={`page-${side}-${pageNum}`} className="relative mb-4 shadow-lg">
                        <PdfSinglePage doc={doc} pageNum={pageNum} />
                         <div className="absolute top-0 left-0 w-full h-full">
                            {pageResult && (side === 'A' ? pageResult.highlightsA : pageResult.highlightsB).map((h, diffIndexInPage) => {
                                const overallIndex = flatDifferences.findIndex(fd => fd.page === pageNum && fd.diffIndexInPage === diffIndexInPage);
                                if (overallIndex === -1) return null;

                                const diffInfo = flatDifferences[overallIndex];
                                const uniqueId = side === 'A' ? diffInfo.uniqueIdA : diffInfo.uniqueIdB;
                                const isCurrent = currentDifferenceIndex === overallIndex;

                                if(h.bbox.width === 0 && h.bbox.height === 0) return null;

                                return (
                                    <div
                                        key={uniqueId}
                                        tabIndex={-1}
                                        ref={el => {
                                            if (el) highlightElementRefs.current.set(uniqueId, el);
                                            else highlightElementRefs.current.delete(uniqueId);
                                        }}
                                        className={`absolute ${side === 'A' ? 'bg-red-500/30' : 'bg-green-500/30'} ${isCurrent ? 'outline outline-4 outline-offset-2 outline-blue-500 z-20' : ''} focus:outline-none focus:ring-4 focus:ring-blue-500/50`}
                                        style={h.bbox}
                                        onMouseEnter={(e) => onMouseEnter(e, h.tooltipContent)}
                                        onMouseLeave={onMouseLeave}
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};


const multiplyMatrices = (m1: number[], m2: number[]): number[] => {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
};

const PdfCompare: React.FC<PdfCompareProps> = ({ initialFiles, onInitialFilesConsumed }) => {
    const [pdfFileA, setPdfFileA] = useState<File | null>(null);
    const [pdfFileB, setPdfFileB] = useState<File | null>(null);
    const [comparisonMode, setComparisonMode] = useState<'exact' | 'semantic'>('exact');
    const [results, setResults] = useState<ComparisonDifference[] | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    
    const [pdfDocA, setPdfDocA] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [pdfDocB, setPdfDocB] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    
    const viewerARef = useRef<HTMLDivElement>(null);
    const viewerBRef = useRef<HTMLDivElement>(null);
    const isNavigatingRef = useRef(false);
    const activeScrollerRef = useRef<'A' | 'B' | null>(null);
    const hasCompared = useRef(false);

    const [activeTooltip, setActiveTooltip] = useState<{ content: React.ReactNode; top: number; left: number } | null>(null);
    const [currentDifferenceIndex, setCurrentDifferenceIndex] = useState<number | null>(null);
    const highlightElementRefs = useRef(new Map<string, HTMLDivElement>());
    const [flatDifferences, setFlatDifferences] = useState<FlatDifference[]>([]);


    useEffect(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;
    }, []);
    
    useEffect(() => {
        if (initialFiles) {
            handleReset(); // Reset everything before loading new files
            setPdfFileA(initialFiles[0]);
            setPdfFileB(initialFiles[1]);
            onInitialFilesConsumed();
        }
    }, [initialFiles, onInitialFilesConsumed]);

    useEffect(() => {
        if (!results) {
            setFlatDifferences([]);
            return;
        }
        const flatList: FlatDifference[] = [];
        let counter = 0;
        results.forEach(pageResult => {
            for (let i = 0; i < pageResult.highlightsA.length; i++) {
                flatList.push({
                    page: pageResult.page,
                    diffIndexInPage: i,
                    uniqueIdA: `p${pageResult.page}-d${counter}-a`,
                    uniqueIdB: `p${pageResult.page}-d${counter}-b`,
                });
                counter++;
            }
        });
        setFlatDifferences(flatList);
    }, [results]);


    useEffect(() => {
        if (currentDifferenceIndex === null || !flatDifferences[currentDifferenceIndex]) return;

        isNavigatingRef.current = true;

        const diffInfo = flatDifferences[currentDifferenceIndex];
        const highlightA = highlightElementRefs.current.get(diffInfo.uniqueIdA);
        const highlightB = highlightElementRefs.current.get(diffInfo.uniqueIdB);

        const scrollOptions: ScrollIntoViewOptions = {
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        };

        if (highlightA) {
            highlightA.focus({ preventScroll: true });
            highlightA.scrollIntoView(scrollOptions);
        }
        if (highlightB) {
            highlightB.focus({ preventScroll: true });
            highlightB.scrollIntoView(scrollOptions);
        }

        const navigationTimeout = setTimeout(() => {
            isNavigatingRef.current = false;
        }, 1000);

        return () => clearTimeout(navigationTimeout);
    }, [currentDifferenceIndex, flatDifferences]);

    const handleScroll = useCallback(() => {
        if (isNavigatingRef.current) return;
    
        const scroller = activeScrollerRef.current;
        const viewerA = viewerARef.current;
        const viewerB = viewerBRef.current;
    
        if (!scroller || !viewerA || !viewerB) return;
    
        const source = scroller === 'A' ? viewerA : viewerB;
        const target = scroller === 'A' ? viewerB : viewerA;
    
        const sourceScrollHeight = source.scrollHeight - source.clientHeight;
        if (sourceScrollHeight > 0) {
            const scrollPercentage = source.scrollTop / sourceScrollHeight;
            target.scrollTop = scrollPercentage * (target.scrollHeight - target.clientHeight);
        } else {
            target.scrollTop = source.scrollTop;
        }
    
        const sourceScrollWidth = source.scrollWidth - source.clientWidth;
        if (sourceScrollWidth > 0) {
            const scrollPercentage = source.scrollLeft / sourceScrollWidth;
            target.scrollLeft = scrollPercentage * (target.scrollWidth - target.clientWidth);
        } else {
            target.scrollLeft = source.scrollLeft;
        }
    }, []);

    const loadPdf = async (file: File) => {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        return await loadingTask.promise;
    };
    
    const handleReset = useCallback(() => {
        setPdfFileA(null);
        setPdfFileB(null);
        setPdfDocA(null);
        setPdfDocB(null);
        setResults(null);
        setError(null);
        setIsLoading(false);
        setCurrentDifferenceIndex(null);
        highlightElementRefs.current.clear();
        hasCompared.current = false;
    }, []);

     const getTextItemsWithBounds = async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale: number): Promise<TextItemWithBounds[]> => {
        if (!doc || pageNum < 1 || pageNum > doc.numPages) return [];
        try {
            const page = await doc.getPage(pageNum);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale });
            return textContent.items
                .filter((item): item is PdfTextItem => 'str' in item && item.str.trim().length > 0)
                .map(item => {
                    const tx = item.transform ? multiplyMatrices(viewport.transform, item.transform) : viewport.transform;
                    const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
                    return {
                        ...item,
                        str: item.str,
                        x: tx[4],
                        y: tx[5],
                        w: item.width || 0,
                        h: item.height || fontHeight || 10,
                    };
                });
        } catch (err) {
            console.error(`Error extracting text from page ${pageNum}`, err);
            return [];
        }
    };
    
    const getBboxForItems = (items: TextItemWithBounds[]): Highlight['bbox'] => {
        if (items.length === 0) return { left: 0, top: 0, width: 0, height: 0 };
        const x1 = Math.min(...items.map(i => i.x));
        const y1 = Math.min(...items.map(i => i.y - i.h));
        const x2 = Math.max(...items.map(i => i.x + i.w));
        const y2 = Math.max(...items.map(i => i.y));
        return { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
    };

    const findBboxForSnippet = (snippet: string, items: TextItemWithBounds[]): Highlight['bbox'] | null => {
        if (!snippet || snippet.trim().length === 0) return null;
        
        const normalizedSnippet = snippet.replace(/\s+/g, '').toLowerCase();
        if (normalizedSnippet.length === 0) return null;

        let bestMatchItems: TextItemWithBounds[] = [];

        // Try to find a contiguous sequence of items that contains the normalized snippet
        for (let i = 0; i < items.length; i++) {
            let currentMatchText = "";
            let currentMatchItems: TextItemWithBounds[] = [];
            for (let j = i; j < items.length; j++) {
                currentMatchText += items[j].str.replace(/\s+/g, '').toLowerCase();
                currentMatchItems.push(items[j]);
                
                if (currentMatchText.includes(normalizedSnippet)) {
                    if (bestMatchItems.length === 0 || currentMatchItems.length < bestMatchItems.length) {
                        bestMatchItems = [...currentMatchItems];
                    }
                    break;
                }
                if (currentMatchText.length > normalizedSnippet.length + 100) break;
            }
        }

        if (bestMatchItems.length > 0) {
            return getBboxForItems(bestMatchItems);
        }
        
        // Fallback: search for items that contain significant parts of the snippet
        const parts = snippet.split(/\s+/).filter(p => p.length > 4);
        const fallbackItems = items.filter(item => 
            parts.some(part => item.str.toLowerCase().includes(part.toLowerCase()))
        );
        
        if (fallbackItems.length > 0) {
            return getBboxForItems(fallbackItems);
        }

        return null;
    };
    
    const groupIntoParagraphs = (items: TextItemWithBounds[]): TextItemWithBounds[][] => {
        if (items.length === 0) return [];
    
        const sortedItems = [...items].sort((a, b) => {
            if (Math.abs(a.y - b.y) > 5) return b.y - a.y;
            return a.x - b.x;
        });
    
        const paragraphs: TextItemWithBounds[][] = [];
        if (sortedItems.length === 0) return paragraphs;
    
        let currentParagraph: TextItemWithBounds[] = [sortedItems[0]];
    
        for (let i = 1; i < sortedItems.length; i++) {
            const prev = currentParagraph[currentParagraph.length - 1];
            const current = sortedItems[i];
            
            const verticalGap = Math.abs(current.y - prev.y);
            const isNewLine = verticalGap > (prev.h * 1.5);

            if (isNewLine) {
                paragraphs.push(currentParagraph.sort((a, b) => a.x - b.x));
                currentParagraph = [current];
            } else {
                currentParagraph.push(current);
            }
        }
        paragraphs.push(currentParagraph.sort((a, b) => a.x - b.x));
        return paragraphs; 
    };

    const createDiffTooltip = (original: string, changed: string) => (
        <div className="font-mono text-xs whitespace-pre-wrap break-words">
            {diffWordsWithSpace(original, changed).map((part, index) => (
                <span key={index} className={
                    part.added ? 'bg-green-200 dark:bg-green-900/80 text-green-800 dark:text-green-300' :
                    part.removed ? 'bg-red-200 dark:bg-red-900/80 text-red-800 dark:text-red-300 line-through' :
                    ''
                }>
                    {part.value}
                </span>
            ))}
        </div>
    );

    const handleCompare = useCallback(async () => {
        if (!pdfFileA || !pdfFileB) {
            setError('Please upload two PDF files to compare.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setResults(null);
        setCurrentDifferenceIndex(null);
        highlightElementRefs.current.clear();

        try {
            setLoadingMessage('Loading PDFs...');
            const docA = pdfDocA || await loadPdf(pdfFileA);
            const docB = pdfDocB || await loadPdf(pdfFileB);
            
            if (!pdfDocA) setPdfDocA(docA);
            if (!pdfDocB) setPdfDocB(docB);

            const numPagesA = docA.numPages || 0;
            const numPagesB = docB.numPages || 0;
            const numPages = Math.max(numPagesA, numPagesB);
            const differences: ComparisonDifference[] = [];
            const scale = 1.5;
            let overallDifferenceCounter = 0;

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                setLoadingMessage(`Analyzing Page ${pageNum} of ${numPages}...`);
                
                // Double check bounds
                const itemsA = (pageNum <= docA.numPages) ? await getTextItemsWithBounds(docA, pageNum, scale) : [];
                const itemsB = (pageNum <= docB.numPages) ? await getTextItemsWithBounds(docB, pageNum, scale) : [];
                
                const pageHighlightsA: Highlight[] = [];
                const pageHighlightsB: Highlight[] = [];

                const createTooltip = (title: string, content: React.ReactNode, diffNumber: number) => (
                    <div>
                        <strong className="block text-sm pb-1 mb-1 border-b border-slate-500">{title} (#{diffNumber})</strong>
                        {content}
                    </div>
                );

                if (comparisonMode === 'semantic') {
                    setLoadingMessage(`Performing AI semantic analysis on page ${pageNum}...`);
                    const textA = itemsA.map(i => i.str).join(' ');
                    const textB = itemsB.map(i => i.str).join(' ');

                    if (textA.trim() || textB.trim()) {
                        try {
                            const semanticDiffs = await performSemanticComparison(textA, textB);

                            if (Array.isArray(semanticDiffs)) {
                                for (const diff of semanticDiffs) {
                                    overallDifferenceCounter++;
                                    const isSame = (diff.kind ?? '').toLowerCase() === 'same';
                                    const bboxA = findBboxForSnippet(diff.textA, itemsA) || { left: 0, top: 0, width: 0, height: 0 };
                                    const bboxB = findBboxForSnippet(diff.textB, itemsB) || { left: 0, top: 0, width: 0, height: 0 };

                                    if (isSame) {
                                        const tooltip = createTooltip("Semantically Same", null, overallDifferenceCounter);
                                        pageHighlightsA.push({ bbox: bboxA, tooltipContent: tooltip, highlightKind: 'semantically-same' });
                                        pageHighlightsB.push({ bbox: bboxB, tooltipContent: tooltip, highlightKind: 'semantically-same' });
                                    } else {
                                        const tooltip = createTooltip("Semantic Difference", <p className="mt-1">{diff.reason}</p>, overallDifferenceCounter);
                                        pageHighlightsA.push({ bbox: bboxA, tooltipContent: tooltip });
                                        pageHighlightsB.push({ bbox: bboxB, tooltipContent: tooltip });
                                    }
                                }
                            }
                        } catch (semanticErr) {
                            console.error("Semantic comparison failed for page", pageNum, semanticErr);
                            // Fallback or just skip this page's semantic diffs
                        }
                    }
                } else {
                    const paragraphsA = groupIntoParagraphs(itemsA);
                    const paragraphsB = groupIntoParagraphs(itemsB);

                    const paraTextsA = paragraphsA.map(p => p.map(item => item.str).join(' '));
                    const paraTextsB = paragraphsB.map(p => p.map(item => item.str).join(' '));

                    const paraDiff = diffArrays(paraTextsA, paraTextsB);
                    
                    const processedDiff = [];
                    let i = 0;
                    while (i < paraDiff.length) {
                        const current = paraDiff[i];
                        const next = i + 1 < paraDiff.length ? paraDiff[i+1] : null;
                        if (current.removed && next && next.added) {
                            processedDiff.push({ changed: true, removed: current.value, added: next.value });
                            i += 2;
                        } else {
                            processedDiff.push(current);
                            i++;
                        }
                    }
                    
                    let indexA = 0;
                    let indexB = 0;

                    for (const part of processedDiff) {
                        if (part.changed) {
                            const removedParas = part.removed;
                            const addedParas = part.added;
                            
                            const removedParaItems = paragraphsA.slice(indexA, indexA + removedParas.length).flat();
                            const addedParaItems = paragraphsB.slice(indexB, indexB + addedParas.length).flat();

                            const removedText = removedParas.join(' ');
                            const addedText = addedParas.join(' ');

                            if (removedText.replace(/\s+/g, '') !== addedText.replace(/\s+/g, '')) {
                                overallDifferenceCounter++;
                                const tooltip = createTooltip("Text Modified", createDiffTooltip(removedText, addedText), overallDifferenceCounter);
                                pageHighlightsA.push({ bbox: getBboxForItems(removedParaItems), tooltipContent: tooltip });
                                pageHighlightsB.push({ bbox: getBboxForItems(addedParaItems), tooltipContent: tooltip });
                            }
                            
                            indexA += removedParas.length;
                            indexB += addedParas.length;

                        } else if (part.added) {
                            part.value.forEach(paraText => {
                                const paraItems = paragraphsB[indexB];
                                if(paraItems) {
                                    overallDifferenceCounter++;
                                    const tooltip = createTooltip("Text Added", createDiffTooltip('', paraText), overallDifferenceCounter);
                                    pageHighlightsB.push({ bbox: getBboxForItems(paraItems), tooltipContent: tooltip });
                                    pageHighlightsA.push({ bbox: {left:0,top:0,width:0,height:0}, tooltipContent: ''});
                                }
                                indexB++;
                            });
                        } else if (part.removed) {
                            part.value.forEach(paraText => {
                                const paraItems = paragraphsA[indexA];
                                 if(paraItems) {
                                    overallDifferenceCounter++;
                                    const tooltip = createTooltip("Text Removed", createDiffTooltip(paraText, ''), overallDifferenceCounter);
                                    pageHighlightsA.push({ bbox: getBboxForItems(paraItems), tooltipContent: tooltip });
                                    pageHighlightsB.push({ bbox: {left:0,top:0,width:0,height:0}, tooltipContent: ''});
                                }
                                indexA++;
                            });
                        } else {
                            indexA += part.value.length;
                            indexB += part.value.length;
                        }
                    }
                }
                
                if (pageHighlightsA.length > 0 || pageHighlightsB.length > 0) {
                     differences.push({ page: pageNum, highlightsA: pageHighlightsA, highlightsB: pageHighlightsB });
                }
            }
            setResults(differences);
            hasCompared.current = true;
        } catch (err) {
            console.error(err);
            setError('An unexpected error occurred during comparison. Please try again.');
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    }, [pdfFileA, pdfFileB, comparisonMode, pdfDocA, pdfDocB]);

    useEffect(() => {
        if (hasCompared.current) {
            handleCompare();
        }
    }, [comparisonMode, handleCompare]);

    const handleMouseEnter = useCallback((e: React.MouseEvent, content: React.ReactNode) => {
        const target = e.target as HTMLElement;
        const rect = target.getBoundingClientRect();
        setActiveTooltip({ content, top: rect.top + window.scrollY, left: rect.left + window.scrollX + rect.width / 2 });
    }, []);

    const handleMouseLeave = useCallback(() => {
        setActiveTooltip(null);
    }, []);

    const handleJumpToPage = (pageNum: number) => {
        const firstDiffIndexOnPage = flatDifferences.findIndex(d => d.page === pageNum);
        if (firstDiffIndexOnPage !== -1) {
            setCurrentDifferenceIndex(firstDiffIndexOnPage);
        }
    };
    
    const FilePlaceholder: React.FC<{ file: File | null, label: string, onClear: () => void }> = ({ file, label, onClear }) => (
        <div className="w-full p-8 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg flex flex-col justify-center items-center h-full">
            <PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />
            <p className="font-semibold text-green-600 dark:text-green-400">{label} Ready:</p>
            <p className="text-sm text-slate-700 dark:text-slate-300 truncate w-full px-4 text-center">{file?.name}</p>
            <button onClick={onClear} className='text-xs text-indigo-500 hover:underline mt-2'>Change File</button>
        </div>
    );
    
    const showViewers = pdfDocA && pdfDocB && !isLoading;
    const totalDifferences = flatDifferences.length;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 md:p-10 transition-all duration-300">
             <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center justify-center gap-3">
                    <ArrowsRightLeftIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
                    PDF Compare
                </h2>
                <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Compare two PDFs side-by-side and highlight textual or semantic differences.
                </p>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6 mb-6">
                {pdfFileA ? <FilePlaceholder file={pdfFileA} label="PDF A" onClear={() => { setPdfFileA(null); handleReset(); }} /> : <FileUploader onFileChange={setPdfFileA} acceptedFileType="application/pdf" fileTypeName="PDF A" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />}
                {pdfFileB ? <FilePlaceholder file={pdfFileB} label="PDF B" onClear={() => { setPdfFileB(null); handleReset(); }} /> : <FileUploader onFileChange={setPdfFileB} acceptedFileType="application/pdf" fileTypeName="PDF B" icon={<PdfFileIcon className="w-12 h-12 mb-4 text-slate-500 dark:text-slate-400" />} />}
            </div>

            <div className='flex flex-col items-center gap-6 mb-6'>
                <ToggleSwitch 
                    leftLabel="Exact Compare"
                    rightLabel="Semantic Compare"
                    enabled={comparisonMode === 'semantic'}
                    onChange={(enabled) => setComparisonMode(enabled ? 'semantic' : 'exact')}
                />
                <div className="flex items-center gap-4">
                     <button
                        onClick={handleCompare}
                        disabled={!pdfFileA || !pdfFileB || isLoading}
                        className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 dark:focus:ring-indigo-800 transition-all duration-300 transform hover:scale-105 inline-flex items-center gap-2 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed disabled:scale-100"
                    >
                        <ArrowsRightLeftIcon className="w-5 h-5" />
                        {hasCompared.current ? 'Re-Compare' : 'Compare Documents'}
                    </button>
                     <button 
                        onClick={handleReset} 
                        disabled={(!pdfFileA && !pdfFileB) || isLoading}
                        className="bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-300 dark:focus:ring-slate-700 transition-all duration-300 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed"
                    >
                        Reset
                    </button>
                </div>
            </div>
            
             {isLoading && (
                <div className="flex flex-col items-center justify-center p-10">
                  <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500"></div>
                  <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">{loadingMessage || 'Comparing Documents...'}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500">This may take a moment.</p>
                </div>
            )}

            {error && (
                <div className="text-center text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="font-bold">An Error Occurred</p>
                    <p>{error}</p>
                    <button onClick={handleReset} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors">Try Again</button>
                </div>
            )}
            
             {showViewers && (
                 <div className="mt-8 flex flex-col">
                     {results && totalDifferences > 0 && (
                        <div className="sticky top-2 z-30 bg-white dark:bg-slate-800 rounded-lg shadow-md p-3 mb-4">
                            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-700 pb-2 mb-2">
                                <div className="flex items-center gap-4">
                                    <h3 className="font-bold text-slate-900 dark:text-white">Summary:</h3>
                                    <div className="flex items-center gap-2 overflow-x-auto max-w-md scrollbar-thin">
                                        {results.map(res => (
                                            <button key={`summary-${res.page}`} onClick={() => handleJumpToPage(res.page)} className="flex-shrink-0 text-left px-3 py-1 text-sm rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900/50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                                <span className="font-semibold">P.{res.page}</span>
                                                <span className="ml-1.5 bg-slate-200 dark:bg-slate-700 text-xs font-medium px-2 py-0.5 rounded-full">{res.highlightsA.length}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                        {currentDifferenceIndex !== null ? `${currentDifferenceIndex + 1} of ` : ''} 
                                        {totalDifferences} difference{totalDifferences === 1 ? '' : 's'}
                                    </span>
                                    <div className="flex gap-1">
                                        <button onClick={() => setCurrentDifferenceIndex(p => Math.max(0, (p ?? 0) - 1))} disabled={currentDifferenceIndex === 0 || totalDifferences === 0} className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition text-lg leading-none">&larr;</button>
                                        <button onClick={() => setCurrentDifferenceIndex(p => Math.min(totalDifferences - 1, (p ?? -1) + 1))} disabled={currentDifferenceIndex === totalDifferences - 1} className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition text-lg leading-none">&rarr;</button>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-2">
                                <h3 className="text-center font-bold text-slate-700 dark:text-slate-300 truncate px-2" title={pdfFileA?.name}>
                                    {pdfFileA?.name || 'PDF A'}
                                </h3>
                                <h3 className="text-center font-bold text-slate-700 dark:text-slate-300 truncate px-2" title={pdfFileB?.name}>
                                    {pdfFileB?.name || 'PDF B'}
                                </h3>
                            </div>
                        </div>
                     )}

                    <div className="grid grid-cols-2 gap-4 h-[70vh]">
                        <div 
                            ref={viewerARef} 
                            onMouseEnter={() => activeScrollerRef.current = 'A'}
                            onScroll={handleScroll}
                            className="overflow-auto p-2 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                            <PdfPages
                                doc={pdfDocA}
                                side="A"
                                results={results}
                                currentDifferenceIndex={currentDifferenceIndex}
                                flatDifferences={flatDifferences}
                                highlightElementRefs={highlightElementRefs}
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                            />
                        </div>
                        <div 
                            ref={viewerBRef} 
                            onMouseEnter={() => activeScrollerRef.current = 'B'}
                            onScroll={handleScroll}
                            className="overflow-auto p-2 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700"
                        >
                            <PdfPages
                                doc={pdfDocB}
                                side="B"
                                results={results}
                                currentDifferenceIndex={currentDifferenceIndex}
                                flatDifferences={flatDifferences}
                                highlightElementRefs={highlightElementRefs}
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                            />
                        </div>
                    </div>
                 </div>
            )}
            
            {activeTooltip && <Tooltip {...activeTooltip} />}

            {results && !isLoading && totalDifferences === 0 && (
                <div className="mt-8 border-t border-slate-200 dark:border-slate-700 pt-6">
                     <p className="text-center text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">No differences found between the two documents.</p>
                </div>
            )}
        </div>
    );
};

export default PdfCompare;
