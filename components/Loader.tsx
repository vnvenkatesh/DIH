
import React from 'react';

const Loader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center p-10">
      <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-indigo-500"></div>
      <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">Analyzing Document...</p>
      <p className="text-sm text-slate-500 dark:text-slate-500">This may take a moment.</p>
    </div>
  );
};

export default Loader;
