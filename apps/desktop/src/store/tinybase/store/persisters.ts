import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { getCurrentWebviewWindowLabel } from "@hypr/plugin-windows";

import { useInitializeStore } from "./initialize";
import { type Store } from "./main";
import { registerSaveHandler } from "./save";

import { useBrowserMainPersisters } from "~/store/tinybase/persister/browser/main";
import { useCalendarPersister } from "~/store/tinybase/persister/calendar";
import { useChatPersister } from "~/store/tinybase/persister/chat";
import { useDailyNotePersister } from "~/store/tinybase/persister/daily-note";
import { useEventsPersister } from "~/store/tinybase/persister/events";
import { useHumanPersister } from "~/store/tinybase/persister/human";
import { useOrganizationPersister } from "~/store/tinybase/persister/organization";
import { useSessionPersister } from "~/store/tinybase/persister/session";
import { useTaskPersister } from "~/store/tinybase/persister/tasks";
import { useValuesPersister } from "~/store/tinybase/persister/values";

export function useMainPersisters(store: Store) {
  const valuesPersister = useValuesPersister(store);
  const sessionPersister = useSessionPersister(store);
  const organizationPersister = useOrganizationPersister(store);
  const humanPersister = useHumanPersister(store);
  const eventPersister = useEventsPersister(store);
  const chatPersister = useChatPersister(store);
  const calendarPersister = useCalendarPersister(store);
  const dailyNotePersister = useDailyNotePersister(store);
  const taskPersister = useTaskPersister(store);

  // Browser mode: IndexedDB persister handles its own init and save registration.
  // Returns true once the initial load + initialization is complete.
  const browserReady = useBrowserMainPersisters(store);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    if (getCurrentWebviewWindowLabel() !== "main") {
      return;
    }

    const persisters = [
      { id: "values", persister: valuesPersister },
      { id: "session", persister: sessionPersister },
      { id: "organization", persister: organizationPersister },
      { id: "human", persister: humanPersister },
      { id: "event", persister: eventPersister },
      { id: "chat", persister: chatPersister },
      { id: "calendar", persister: calendarPersister },
      { id: "dailyNote", persister: dailyNotePersister },
      { id: "task", persister: taskPersister },
    ];

    const unsubscribes = persisters
      .filter(({ persister }) => persister)
      .map(({ id, persister }) =>
        registerSaveHandler(id, async () => {
          await persister!.save();
        }),
      );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [
    valuesPersister,
    sessionPersister,
    organizationPersister,
    humanPersister,
    eventPersister,
    chatPersister,
    calendarPersister,
    dailyNotePersister,
    taskPersister,
  ]);

  // Tauri mode only: wait for native persisters before initializing default data.
  // In browser mode, useBrowserMainPersisters initializes after IDB load.
  useInitializeStore(store, {
    session: isTauri() ? sessionPersister : browserReady,
    human: isTauri() ? humanPersister : browserReady,
    values: isTauri() ? valuesPersister : browserReady,
  });

  return {
    valuesPersister,
    sessionPersister,
    organizationPersister,
    humanPersister,
    eventPersister,
    chatPersister,
    calendarPersister,
    dailyNotePersister,
    taskPersister,
  };
}
