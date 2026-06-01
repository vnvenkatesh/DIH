
import React from 'react';

interface IconProps { className?: string; }

const ServerIcon: React.FC<IconProps> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 17.25v.75a3 3 0 01-3 3h-15a3 3 0 01-3-3v-.75m19.5 0a3 3 0 00-3-3h-15a3 3 0 00-3 3m19.5 0v.008H2.25V17.25M21.75 12v.75a3 3 0 01-3 3h-15a3 3 0 01-3-3V12m19.5 0a3 3 0 00-3-3h-15a3 3 0 00-3 3m19.5 0v.008H2.25V12M21.75 6.75v.75a3 3 0 01-3 3h-15a3 3 0 01-3-3v-.75m19.5 0a3 3 0 00-3-3h-15a3 3 0 00-3 3m19.5 0v.008H2.25V6.75" />
  </svg>
);

export default ServerIcon;
