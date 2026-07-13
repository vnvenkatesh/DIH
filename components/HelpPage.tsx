import React, { useState } from 'react';

// ── Small inline icons ────────────────────────────────────────────────────────

const MailIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
);

const UserCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
);

const CheckCircleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const ArrowRightIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
);

// ── FAQ accordion item ────────────────────────────────────────────────────────

const FaqItem: React.FC<{ q: string; a: React.ReactNode }> = ({ q, a }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
            >
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{q}</span>
                <ChevronDownIcon className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="px-5 pb-4 bg-white dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-700 pt-3">
                    {a}
                </div>
            )}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

const HelpPage: React.FC = () => {
    const workflows = [
        {
            steps: ['Business Rules', 'Test Case Generator', 'Synthetic Data Generation', 'Output Validator'],
            label: 'Full QA Pipeline',
            color: 'text-indigo-600 dark:text-indigo-400',
            dot: 'bg-indigo-500',
        },
        {
            steps: ['Data Mapping Generator', 'XPath Extractor', 'GhostDraft Generator'],
            label: 'Field Mapping → GhostDraft Document',
            color: 'text-violet-600 dark:text-violet-400',
            dot: 'bg-violet-500',
        },
        {
            steps: ['Synthetic Data Generation', 'Output Validator'],
            label: 'Data-Driven Output Validation',
            color: 'text-cyan-600 dark:text-cyan-400',
            dot: 'bg-cyan-500',
        },
        {
            steps: ['PDF AI Compare', 'PDF Visual Compare'],
            label: 'Document Review & Diff',
            color: 'text-sky-600 dark:text-sky-400',
            dot: 'bg-sky-500',
        },
    ];

    const faqs = [
        {
            q: 'Is my document data sent to any Deloitte server?',
            a: 'No. All document parsing (PDF text extraction, DOCX parsing) happens entirely in your browser. Document content is sent directly from your browser to the LLM provider you choose (Gemini, Claude, or OpenAI) — no Deloitte-managed server ever touches your document content.',
        },
        {
            q: 'Where is my API key stored?',
            a: 'Your API key is stored in your browser\'s local storage and in the database linked to your account (encrypted at rest). It is only transmitted when the app calls the relevant LLM endpoint on your behalf. It is never logged or retained elsewhere.',
        },
        {
            q: 'Which LLM provider should I choose?',
            a: (
                <ul className="space-y-1 list-disc list-inside">
                    <li><strong>Gemini 2.5 Pro/Flash</strong> — best structured-output reliability; recommended default.</li>
                    <li><strong>Claude Sonnet / Haiku</strong> — strong for long-document reasoning and nuanced rule extraction.</li>
                    <li><strong>OpenAI GPT-4o</strong> — good all-rounder; choose if your engagement already has an OpenAI key.</li>
                </ul>
            ),
        },
        {
            q: 'How do the accelerators connect with each other?',
            a: 'Several accelerators are designed to chain together. The full QA pipeline is: Business Rules (from a BRD) → Test Case Generator (rules CSV) → Synthetic Data Generation (XSD + test cases CSV) → Output Validator (generated PDF + input data + test cases CSV). For schema work: Data Mapping Generator → XPath Extractor → GhostDraft Generator.',
        },
        {
            q: 'What file types are supported?',
            a: (
                <ul className="space-y-1 list-disc list-inside">
                    <li><strong>PDF</strong> — all accelerators that accept documents</li>
                    <li><strong>DOCX</strong> — Data Mapping Generator, Layout Recommendation</li>
                    <li><strong>XSD</strong> — Data Mapping Generator, XPath Extractor, Synthetic Data Generation, GhostDraft Generator</li>
                    <li><strong>XML / JSON</strong> — XPath Extractor, Output Validator (input data)</li>
                    <li><strong>CSV</strong> — Test Case Generator (business rules input), Synthetic Data Generation (test cases input), Output Validator (test cases input)</li>
                    <li><strong>.gd</strong> — GhostDraft Generator (template + optional reference)</li>
                </ul>
            ),
        },
        {
            q: 'Can I use this without an API key?',
            a: 'The PDF Visual Compare accelerator works entirely locally with no LLM call — no API key needed. All other accelerators require at least one LLM API key configured in Settings.',
        },
        {
            q: 'How do I get a Gemini API key?',
            a: 'Visit Google AI Studio (aistudio.google.com), sign in with a Google account, and generate an API key. Free tier is available. Paste the key in Settings → API Keys → Gemini API Key.',
        },
    ];

    return (
        <div className="max-w-4xl mx-auto space-y-10 pb-12">

            {/* ── Page header ── */}
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-800 px-8 py-10 text-white shadow-xl">
                <div className="absolute inset-0 opacity-10"
                    style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
                <div className="relative">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/15 rounded-full text-xs font-semibold tracking-wide uppercase mb-4">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                        </svg>
                        Help &amp; Support
                    </div>
                    <h2 className="text-2xl md:text-3xl font-extrabold mb-2">Document Intelligence Hub</h2>
                    <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                        AI-powered accelerators for Customer Communication Management. Find answers, contact the team, and learn how to get the most out of every tool.
                    </p>
                </div>
            </div>

            {/* ── Contact card ── */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Contact</h3>
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-900/30">
                        <UserCircleIcon className="w-9 h-9 text-white" />
                    </div>
                    <div className="flex-1">
                        <div className="inline-block px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-bold uppercase tracking-wider mb-2">
                            Founder
                        </div>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white">Venkatesh Veluguri</p>
                        <a
                            href="mailto:vveluguri@deloitte.com"
                            className="inline-flex items-center gap-2 mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 font-medium transition-colors group"
                        >
                            <MailIcon className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            vveluguri@deloitte.com
                        </a>
                    </div>
                    <div className="sm:text-right">
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">Organisation</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mt-0.5">Deloitte</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Customer &amp; Marketing</p>
                    </div>
                </div>
            </div>

            {/* ── Getting started ── */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Getting Started</h3>
                <div className="grid sm:grid-cols-3 gap-4">
                    {[
                        {
                            step: '1',
                            title: 'Configure your API key',
                            body: 'Open Settings from the top-right menu. Add a Gemini, Claude, or OpenAI API key. The key is stored securely in your account.',
                            color: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800/50',
                            num: 'bg-indigo-600 text-white',
                        },
                        {
                            step: '2',
                            title: 'Pick an accelerator',
                            body: 'Choose a tool from the left sidebar based on where you are in the delivery lifecycle — Discovery, Build, Test, or QA.',
                            color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-100 dark:border-violet-800/50',
                            num: 'bg-violet-600 text-white',
                        },
                        {
                            step: '3',
                            title: 'Upload & generate',
                            body: 'Upload the required files, click Generate, then download the results as CSV, XML, or JSON for use in your project artefacts.',
                            color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50',
                            num: 'bg-emerald-600 text-white',
                        },
                    ].map(({ step, title, body, color, num }) => (
                        <div key={step} className={`rounded-xl border p-5 ${color}`}>
                            <div className={`w-8 h-8 rounded-full ${num} text-sm font-extrabold flex items-center justify-center mb-3`}>
                                {step}
                            </div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">{title}</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{body}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Connected workflows ── */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Connected Workflows</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Several accelerators are designed to chain together — the output of one becomes the input of the next.
                </p>
                <div className="space-y-3">
                    {workflows.map(({ steps, label, color, dot }) => (
                        <div key={label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-5 py-4 shadow-sm">
                            <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${color}`}>{label}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                {steps.map((s, i) => (
                                    <React.Fragment key={s}>
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-2 h-2 rounded-full ${dot} flex-shrink-0`} />
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{s}</span>
                                        </div>
                                        {i < steps.length - 1 && (
                                            <ArrowRightIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Feature checklist ── */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">What's Included</h3>
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm divide-y divide-slate-100 dark:divide-slate-700 overflow-hidden">
                    {[
                        { feature: '12 accelerators', detail: '11 AI-powered, 1 fully local (PDF Visual Compare)' },
                        { feature: 'Multi-provider LLM support', detail: 'Gemini 2.5 Pro/Flash, Claude Sonnet/Haiku, OpenAI GPT-4o' },
                        { feature: 'Zero data retention', detail: 'Document content never persists after your session' },
                        { feature: 'Connected workflows', detail: 'Accelerators designed to chain — rules → test cases → XML data' },
                        { feature: 'Export everywhere', detail: 'Results downloadable as CSV, XML, and JSON' },
                        { feature: 'Dark mode', detail: 'System preference respected; toggle in Settings' },
                        { feature: 'Role-based access', detail: 'Admin and AppUser roles with per-user API key storage' },
                    ].map(({ feature, detail }) => (
                        <div key={feature} className="flex items-start gap-3 px-5 py-3.5">
                            <CheckCircleIcon className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div>
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{feature}</span>
                                <span className="text-sm text-slate-500 dark:text-slate-400"> — {detail}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── FAQ ── */}
            <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Frequently Asked Questions</h3>
                <div className="space-y-2">
                    {faqs.map(({ q, a }) => (
                        <FaqItem key={q} q={q} a={a} />
                    ))}
                </div>
            </div>

            {/* ── Footer note ── */}
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-5 py-4 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    For feature requests or bug reports, contact{' '}
                    <a href="mailto:vveluguri@deloitte.com" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                        vveluguri@deloitte.com
                    </a>
                </p>
            </div>
        </div>
    );
};

export default HelpPage;
