import type { ReleaseInfo } from "../../../types/sharedTypes";
import type { InstallMode } from "../../../hooks/useVersionCheck";

interface VersionUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    releaseInfo: ReleaseInfo | null;
    currentVersion: string;
    latestVersion: string | null;
    installMode: InstallMode;
}

export function VersionUpgradeModal(props: VersionUpgradeModalProps) {
    void props;
    return null;
}
