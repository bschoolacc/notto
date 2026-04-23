import { isTauri } from "@tauri-apps/api/core";
import { createIndexedDbPersister } from "tinybase/persisters/persister-indexed-db";
import { useEffect, useState } from "react";

import type { Store } from "~/store/tinybase/store/main";
import { registerSaveHandler } from "~/store/tinybase/store/save";

const IDB_KEY = "notto-main";

export function useBrowserMainPersisters(store: Store): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isTauri()) {
      return;
    }

    const persister = createIndexedDbPersister(store as any, IDB_KEY);

    void persister.startAutoLoad().then(() => {
      setReady(true);
      return persister.startAutoSave();
    });

    const unregister = registerSaveHandler("browser-main", async () => {
      await persister.save();
    });

    return () => {
      unregister();
      void persister.stopAutoLoad();
      void persister.stopAutoSave();
    };
  }, [store]);

  return ready;
}

