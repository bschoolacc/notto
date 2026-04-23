export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

const error = (): Promise<Result<never, string>> =>
  Promise.resolve({ status: "error", error: "not available in browser" });

export const commands = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (
        prop === "isSupportedLanguagesLive" ||
        prop === "isSupportedLanguagesBatch"
      ) {
        return (): Promise<Result<boolean, string>> =>
          Promise.resolve({ status: "ok", data: false });
      }
      if (prop === "suggestProvidersForLanguagesLive" || prop === "suggestProvidersForLanguagesBatch") {
        return (): Promise<Result<string[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "listDocumentedLanguageCodesLive" || prop === "listDocumentedLanguageCodesBatch") {
        return (): Promise<Result<string[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "listMicrophoneDevices") {
        return (): Promise<Result<string[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "getCurrentMicrophoneDevice") {
        return (): Promise<Result<null, string>> =>
          Promise.resolve({ status: "ok", data: null });
      }
      if (prop === "getMicMuted") {
        return (): Promise<Result<boolean, string>> =>
          Promise.resolve({ status: "ok", data: false });
      }
      if (prop === "getCaptureState") {
        return (): Promise<Result<string, string>> =>
          Promise.resolve({ status: "ok", data: "idle" });
      }
      if (prop === "renderTranscriptSegments") {
        return (): Promise<Result<unknown[], string>> =>
          Promise.resolve({ status: "ok", data: [] });
      }
      if (prop === "exportToVtt") {
        return (): Promise<Result<string, string>> =>
          Promise.resolve({ status: "ok", data: "" });
      }
      return error;
    },
  },
);

export const events = new Proxy(
  {},
  {
    get: () => ({
      listen: () => Promise.resolve(() => {}),
      once: () => Promise.resolve(() => {}),
      emit: () => Promise.resolve(),
    }),
  },
);
