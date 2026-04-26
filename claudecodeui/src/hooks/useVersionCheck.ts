import { version } from '../../package.json';
import type { ReleaseInfo } from '../types/sharedTypes';

export type InstallMode = 'bundled' | 'npm';

export const useVersionCheck = (_owner: string, _repo: string) => {
  return {
    updateAvailable: false,
    latestVersion: null as string | null,
    currentVersion: version,
    releaseInfo: null as ReleaseInfo | null,
    installMode: 'bundled' as InstallMode,
  };
};
