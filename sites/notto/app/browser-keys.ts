export function qaScenario() {
  return process.env.NODE_ENV === "development" && typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("qa") : null;
}

export function notebookStorageKey(key: string) {
  const scenario = qaScenario();
  return scenario ? `notto-qa-${scenario}:${key}` : key;
}
