import React from 'react';

type ClaudeLogoProps = {
  className?: string;
};

const ClaudeLogo = ({ className = 'w-5 h-5' }: ClaudeLogoProps) => {
  return (
    <img src="/icons/argus-icon.svg" alt="Argus" className={className} />
  );
};

export default ClaudeLogo;


