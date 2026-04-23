export const commands = new Proxy(
  {},
  {
    get: () =>
      () =>
        Promise.resolve({ status: "ok" as const, data: null }),
  },
);

export const events = {
  notificationEvent: {
    listen: () => Promise.resolve(() => {}),
    once: () => Promise.resolve(() => {}),
    emit: () => Promise.resolve(),
  },
};
