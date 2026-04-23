export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };

export const commands = {
  openUrl: (url: string, _openWith?: string | null): Promise<Result<null, string>> => {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve({ status: "ok", data: null });
  },

  openPath: (_path: string, _openWith?: string | null): Promise<Result<null, string>> =>
    Promise.resolve({ status: "ok", data: null }),

  revealItemInDir: (_path: string): Promise<Result<null, string>> =>
    Promise.resolve({ status: "ok", data: null }),
};
