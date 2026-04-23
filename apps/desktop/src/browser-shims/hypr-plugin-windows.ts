const noop = () => {};
const noopUnlisten = () => Promise.resolve(noop);

function makeNoopEventObj() {
  return {
    listen: noopUnlisten,
    once: noopUnlisten,
    emit: () => Promise.resolve(),
  };
}

export type WindowLabel =
  | "main"
  | "composer"
  | `note-${string}`
  | "calendar"
  | "settings";

export const getCurrentWebviewWindowLabel = (): WindowLabel => "main";

export const commands = new Proxy(
  {},
  {
    get: () =>
      () =>
        Promise.resolve({ status: "ok" as const, data: null }),
  },
);

export const events = new Proxy(
  {},
  {
    get: () => makeNoopEventObj(),
  },
);

export const init = () => {
  const allowDropAttribute = "[data-allow-file-drop='true']";
  const shouldAllow = (event: DragEvent) => {
    if (!(event.target instanceof Element)) {
      return false;
    }
    return Boolean(event.target.closest(allowDropAttribute));
  };

  const preventUnlessAllowed = (event: DragEvent) => {
    const allowed = shouldAllow(event);

    if (event.type === "dragover" || event.type === "drop") {
      event.preventDefault();
      if (!allowed) {
        event.stopPropagation();
      }
      return;
    }

    if (!allowed) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  document.addEventListener("dragover", preventUnlessAllowed);
  document.addEventListener("drop", preventUnlessAllowed);
  document.addEventListener("dragenter", preventUnlessAllowed);
  document.addEventListener("dragleave", preventUnlessAllowed);
};

export const openUrlWithInstruction = async (
  _url: string,
  _instructionType: string,
  openUrl: (url: string) => Promise<{ status: "ok" | "error"; error?: unknown }>,
) => {
  await openUrl(_url);
};

export const dismissInstruction = async () => {};

export type AppWindow = { type: "main" } | { type: "composer" };
export type Anchor =
  | "TopRight"
  | "TopLeft"
  | "BottomRight"
  | "BottomLeft"
  | "Center";
export type Navigate = {
  path: string;
  search: Partial<{ [key in string]: unknown }> | null;
};
export type OpenTab = { tab: unknown };
export type SessionsState = { view: unknown | null; autoStart: boolean | null };
export type SettingsState = { tab: string | null };
export type VisibilityEvent = { window: AppWindow; visible: boolean };
export type WindowDestroyed = { window: AppWindow };
export type Result<T, E> =
  | { status: "ok"; data: T }
  | { status: "error"; error: E };
