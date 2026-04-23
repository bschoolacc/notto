const noop = () => Promise.resolve(() => {});

export const commands = new Proxy(
  {},
  {
    get: () =>
      () =>
        Promise.resolve({ status: "ok" as const, data: null }),
  },
);

export const events = {
  updateDownloadFailedEvent: { listen: noop, once: noop, emit: () => Promise.resolve() },
  updateDownloadProgressEvent: {
    listen: noop,
    once: noop,
    emit: () => Promise.resolve(),
  },
  updateDownloadingEvent: { listen: noop, once: noop, emit: () => Promise.resolve() },
  updateReadyEvent: { listen: noop, once: noop, emit: () => Promise.resolve() },
  updatedEvent: { listen: noop, once: noop, emit: () => Promise.resolve() },
};
