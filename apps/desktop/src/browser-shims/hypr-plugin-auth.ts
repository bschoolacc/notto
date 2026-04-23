export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

const error = (): Promise<Result<never, string>> =>
  Promise.resolve({ status: "error", error: "not available in browser" });

export const commands = new Proxy(
  {},
  {
    get: () => error,
  },
);
