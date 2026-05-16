export {};

declare global {
  interface Window {
    __ROUTER_BASENAME__?: string;
    refreshProjects?: () => void | Promise<void>;
    openSettings?: (tab?: string) => void;
    argusDesktop?: {
      selectProjectRoot?: (options?: {
        defaultPath?: string;
        title?: string;
        buttonLabel?: string;
      }) => Promise<{
        canceled: boolean;
        path?: string;
        error?: string;
      }>;
      selectDirectory?: (options?: {
        defaultPath?: string;
        title?: string;
        buttonLabel?: string;
      }) => Promise<{
        canceled: boolean;
        path?: string;
        error?: string;
      }>;
      selectCodeGraphScope?: (options?: {
        defaultPath?: string;
        title?: string;
        buttonLabel?: string;
      }) => Promise<{
        canceled: boolean;
        path?: string;
        paths?: string[];
        error?: string;
      }>;
	      browserOpen?: (options: {
	        url: string;
	        projectPath?: string;
	      }) => Promise<{
        success?: boolean;
        url?: string;
	        error?: string;
	      }>;
      browserAttach?: (options: {
        url?: string;
        projectPath?: string;
        bounds: { x: number; y: number; width: number; height: number };
      }) => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserResize?: (options: {
        bounds: { x: number; y: number; width: number; height: number };
      }) => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserNavigate?: (options: {
        url: string;
        projectPath?: string;
      }) => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserBack?: () => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserForward?: () => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserRefresh?: () => Promise<{
        success?: boolean;
        url?: string;
        error?: string;
      }>;
      browserScreenshot?: (options: {
        url: string;
        projectPath?: string;
      }) => Promise<{
        success?: boolean;
        dataUrl?: string;
        error?: string;
      }>;
	      browserClose?: () => Promise<{
	        success?: boolean;
	        error?: string;
	      }>;
      browserDetach?: () => Promise<{
        success?: boolean;
        error?: string;
      }>;
      notify?: (options: {
        title: string;
        body?: string;
        tag?: string;
        urgency?: 'normal' | 'critical';
      }) => Promise<{
        success?: boolean;
        error?: string;
      }>;
	    };
  }

  interface EventSourceEventMap {
    result: MessageEvent;
    progress: MessageEvent;
    done: MessageEvent;
  }
}
