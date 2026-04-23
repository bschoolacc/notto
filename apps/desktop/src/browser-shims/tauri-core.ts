export const isTauri = () => false;

export const invoke = (_cmd: string, _args?: unknown): Promise<never> => {
  return Promise.reject(new Error("invoke() is not available in browser mode"));
};
