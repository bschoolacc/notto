export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

const error = (): Promise<Result<never, string>> =>
  Promise.resolve({ status: "error", error: "not available in browser" });

export const commands = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === "isModelDownloaded" || prop === "isModelDownloading") {
        return (): Promise<Result<boolean, string>> =>
          Promise.resolve({ status: "ok", data: false });
      }
      if (prop === "modelsDir" || prop === "cactusModelsDir") {
        return (): Promise<Result<string, string>> =>
          Promise.resolve({ status: "ok", data: "" });
      }
      return error;
    },
  },
);
