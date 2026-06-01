import React from 'react';

interface Header {
    key: string;
    label: string;
    className?: string;
}

interface ResultsTableProps {
  data: any[];
  headers: Header[];
  title?: string;
}

const ResultsTable: React.FC<ResultsTableProps> = ({ data, headers, title }) => {
  if (!data || data.length === 0) {
    return (
        <div className="text-center p-8 bg-slate-100 dark:bg-slate-700 rounded-lg">
            <p className="text-slate-600 dark:text-slate-300">No results to display.</p>
        </div>
    );
  }

  return (
    <div>
      {title && <h2 className="text-2xl font-bold mb-4 text-center text-slate-900 dark:text-white">{title}</h2>}
      <div className="overflow-x-auto bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
          <thead className="text-xs text-slate-700 uppercase bg-slate-100 dark:bg-slate-700 dark:text-slate-300">
            <tr>
              {headers.map((header) => (
                <th key={header.key} scope="col" className={`px-6 py-3 ${header.className || ''}`}>
                  {header.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={index} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600/50">
                {headers.map((header, headerIndex) => {
                    if(headerIndex === 0) {
                        return (
                            <th key={`${index}-${header.key}`} scope="row" className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap dark:text-white">
                                {item[header.key]}
                            </th>
                        )
                    }
                    return (
                        <td key={`${index}-${header.key}`} className="px-6 py-4 font-mono text-xs">
                            {item[header.key]}
                        </td>
                    )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;
