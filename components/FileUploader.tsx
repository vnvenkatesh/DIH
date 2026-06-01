import React, { useCallback, useState } from 'react';

interface FileUploaderProps {
  onFileChange: (file: File | null) => void;
  acceptedFileType: string;
  fileTypeName: string;
  icon: React.ReactNode;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFileChange, acceptedFileType, fileTypeName, icon }) => {
  const [isDragging, setIsDragging] = useState(false);

  const isValidFileType = (file: File) => {
    if (acceptedFileType === '*') {
        return true;
    }
    const acceptedTypes = acceptedFileType.split(',').map(type => type.trim());
    
    // Check MIME types
    if (acceptedTypes.includes(file.type)) {
        return true;
    }

    // Check extensions (specifically for types like .xsd that might have varying MIME types)
    const fileName = file.name.toLowerCase();
    return acceptedTypes.some(type => type.startsWith('.') && fileName.endsWith(type.toLowerCase()));
  };

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isValidFileType(file)) {
        onFileChange(file);
      } else {
        alert(`Please upload a valid ${fileTypeName} file.`);
      }
    }
  }, [onFileChange, acceptedFileType, fileTypeName]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        if (isValidFileType(file)) {
          onFileChange(file);
        } else {
          alert(`Please upload a valid ${fileTypeName} file.`);
          e.target.value = ''; // Reset input
        }
    }
  };

  const uploaderClasses = `flex flex-col items-center justify-center w-full p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-300 ${
    isDragging 
      ? 'border-indigo-500 bg-indigo-100 dark:bg-indigo-900/50' 
      : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-700'
  }`;
  
  // Use a unique ID for the input to avoid conflicts when using multiple uploaders
  const inputId = `dropzone-file-${fileTypeName.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="flex items-center justify-center w-full">
      <label
        htmlFor={inputId}
        className={uploaderClasses}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {icon}
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold">Click to upload {fileTypeName}</span> or drag and drop
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{fileTypeName} (MAX. 10MB)</p>
        </div>
        <input id={inputId} type="file" className="hidden" accept={acceptedFileType} onChange={handleFileSelect} />
      </label>
    </div>
  );
};

export default FileUploader;