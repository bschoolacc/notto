export const commands = new Proxy(
  {},
  {
    get: () =>
      () =>
        Promise.resolve({ status: "ok" as const, data: null }),
  },
);
