import { contextBridge } from "electron";

/**
 * The smallest bridge this app can have.
 *
 * The renderer reads generated files over its own protocol and owns no
 * document, so no IPC command exists. It receives only facts about the shell.
 */
const bridge = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
} as const;

contextBridge.exposeInMainWorld("suiteHelp", bridge);
