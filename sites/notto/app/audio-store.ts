export type AudioSession = {
  id: string; noteId: string; name: string; mimeType: string; createdAt: number;
  duration: number; offset?: number; status: "recording" | "ready" | "interrupted";
};
type AudioPart = { id: string; sessionId: string; sequence: number; blob: Blob };

function openAudioDB(namespace = "notto-audio-v1"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(namespace, 1);
    request.onupgradeneeded = () => {
      const sessions = request.result.createObjectStore("sessions", { keyPath: "id" });
      sessions.createIndex("noteId", "noteId");
      const parts = request.result.createObjectStore("parts", { keyPath: "id" });
      parts.createIndex("sessionId", "sessionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Audio storage is unavailable."));
    request.onblocked = () => reject(new Error("Another tab is blocking audio storage."));
  });
}

// Resolve only after the transaction commits: a successful put is not a saved recording.
async function transaction<T>(stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction, done: (value: T) => void) => void, namespace?: string): Promise<T> {
  const db = await openAudioDB(namespace);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Audio could not be saved.")); };
    tx.onerror = () => { /* onabort reports transaction failure */ };
    try { operation(tx, (value) => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}

export function beginAudioSession(session: AudioSession, namespace?: string) {
  return transaction<void>(["sessions"], "readwrite", (tx) => { tx.objectStore("sessions").add(session); }, namespace);
}

export function appendAudioPart(sessionId: string, sequence: number, blob: Blob, namespace?: string, duration?: number) {
  if (!blob.size) return Promise.resolve();
  return transaction<void>(["parts", "sessions"], "readwrite", (tx) => {
    tx.objectStore("parts").put({ id: `${sessionId}:${sequence}`, sessionId, sequence, blob } satisfies AudioPart);
    if (duration !== undefined && Number.isFinite(duration) && duration >= 0) {
      const sessions = tx.objectStore("sessions");
      const request = sessions.get(sessionId);
      request.onsuccess = () => { if (request.result) sessions.put({ ...request.result, duration: Math.max(request.result.duration, duration) }); };
    }
  }, namespace);
}

export function finishAudioSession(id: string, duration: number, namespace?: string, mimeType?: string) {
  return transaction<void>(["sessions"], "readwrite", (tx) => {
    const store = tx.objectStore("sessions");
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, status: "ready", duration, mimeType: mimeType || request.result.mimeType });
    };
  }, namespace);
}

export function listAudioSessions(noteId: string, namespace?: string): Promise<AudioSession[]> {
  return transaction<AudioSession[]>(["sessions"], "readonly", (tx, done) => {
    const request = tx.objectStore("sessions").index("noteId").getAll(noteId);
    request.onsuccess = () => done((request.result as AudioSession[]).sort((a, b) => b.createdAt - a.createdAt).map((item) => ({ ...item, mimeType: item.mimeType || "audio/webm", status: item.status === "recording" ? "interrupted" : item.status })));
  }, namespace);
}

export async function readAudioSession(session: AudioSession, namespace?: string): Promise<Blob> {
  const blob = await transaction<Blob>(["parts"], "readonly", (tx, done) => {
    const request = tx.objectStore("parts").index("sessionId").getAll(session.id);
    request.onsuccess = () => done(new Blob((request.result as AudioPart[]).sort((a, b) => a.sequence - b.sequence).map((part) => part.blob), { type: session.mimeType }));
  }, namespace);
  if (session.mimeType.includes("webm") && session.duration > 0 && blob.size) {
    try {
      const { fixWebmDuration } = await import("@fix-webm-duration/fix");
      return await fixWebmDuration(blob, session.duration * 1000, { logger: false });
    } catch { /* original audio remains playable even when metadata cannot be repaired */ }
  }
  return blob;
}

export async function importAudioSession(session: AudioSession, blob: Blob, namespace?: string) {
  await transaction<void>(["sessions", "parts"], "readwrite", (tx) => {
    tx.objectStore("sessions").add({ ...session, status: "ready" });
    tx.objectStore("parts").add({ id: `${session.id}:0`, sessionId: session.id, sequence: 0, blob } satisfies AudioPart);
  }, namespace);
}

export function audioExtension(mimeType: string) {
  return mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("wav") ? "wav" : mimeType.includes("webm") ? "webm" : "audio";
}
