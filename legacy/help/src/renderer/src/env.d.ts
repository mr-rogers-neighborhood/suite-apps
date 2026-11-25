/// <reference types="vite/client" />

interface SuiteHelpBridge {
  readonly platform: string;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
  };
}

interface Window {
  readonly suiteHelp?: SuiteHelpBridge;
}
