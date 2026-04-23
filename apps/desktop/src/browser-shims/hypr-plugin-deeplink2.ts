export const events = {
  deepLinkEvent: {
    listen: () => Promise.resolve(() => {}),
    once: () => Promise.resolve(() => {}),
    emit: () => Promise.resolve(),
  },
};

export const commands = {
  startCallbackServer: (_scheme: string): Promise<{ status: "ok"; data: number } | { status: "error"; error: string }> =>
    Promise.resolve({ status: "ok", data: 0 }),

  stopCallbackServer: (): Promise<{ status: "ok"; data: null } | { status: "error"; error: string }> =>
    Promise.resolve({ status: "ok", data: null }),
};
