const STORAGE_KEY = "notto-settings";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | Partial<{ [key in string]: JsonValue }>;

export type ObsidianVault = { path: string };

export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

export const commands = {
  settingsPath: (): Promise<Result<string, string>> =>
    Promise.resolve({ status: "ok", data: "browser" }),

  globalBase: (): Promise<Result<string, string>> =>
    Promise.resolve({ status: "ok", data: "browser" }),

  vaultBase: (): Promise<Result<string, string>> =>
    Promise.resolve({ status: "ok", data: "browser" }),

  copyVault: (_newPath: string): Promise<Result<null, string>> =>
    Promise.resolve({ status: "ok", data: null }),

  moveVault: (_newPath: string): Promise<Result<null, string>> =>
    Promise.resolve({ status: "ok", data: null }),

  setVaultBase: (_newPath: string): Promise<Result<null, string>> =>
    Promise.resolve({ status: "ok", data: null }),

  load: (): Promise<Result<JsonValue, string>> => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return Promise.resolve({ status: "ok", data });
    } catch {
      return Promise.resolve({ status: "ok", data: {} });
    }
  },

  save: (settings: JsonValue): Promise<Result<null, string>> => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return Promise.resolve({ status: "ok", data: null });
    } catch (e) {
      return Promise.resolve({
        status: "error",
        error: String(e),
      });
    }
  },

  obsidianVaults: (): Promise<Result<ObsidianVault[], string>> =>
    Promise.resolve({ status: "ok", data: [] }),
};
