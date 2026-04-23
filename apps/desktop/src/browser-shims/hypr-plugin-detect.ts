export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

const error = (): Promise<Result<never, string>> =>
  Promise.resolve({ status: "error", error: "not available in browser" });

export const commands = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === "listInstalledApplications" || prop === "listMicUsingApplications") {
        return (): Promise<Result<unknown[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "listDefaultIgnoredBundleIds") {
        return (): Promise<Result<string[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "getPreferredLanguages") {
        return (): Promise<Result<string[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "getCurrentLocaleIdentifier") {
        return (): Promise<Result<string, string>> =>
          Promise.resolve({ status: "ok", data: "en_US" });
      }
      if (prop === "getMicMuted") {
        return (): Promise<Result<boolean, string>> =>
          Promise.resolve({ status: "ok", data: false });
      }
      return error;
    },
  },
);
