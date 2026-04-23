export const commands = new Proxy(
  {},
  {
    get: () =>
      () =>
        Promise.resolve(),
  },
);

export const events = {
  fileChanged: {
    listen: () => Promise.resolve(() => {}),
    once: () => Promise.resolve(() => {}),
    emit: () => Promise.resolve(),
  },
};
