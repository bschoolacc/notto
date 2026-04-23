export const listen = (
  _event: string,
  _handler: unknown,
): Promise<() => void> => Promise.resolve(() => {});

export const once = (
  _event: string,
  _handler: unknown,
): Promise<() => void> => Promise.resolve(() => {});

export const emit = (_event: string, _payload?: unknown): Promise<void> =>
  Promise.resolve();
