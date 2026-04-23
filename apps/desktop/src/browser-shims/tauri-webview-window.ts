export const getCurrentWebviewWindow = () => ({
  label: "main" as const,
  listen: (_event: string, _handler: unknown) => Promise.resolve(() => {}),
  once: (_event: string, _handler: unknown) => Promise.resolve(() => {}),
  emit: (_event: string, _payload?: unknown) => Promise.resolve(),
});
