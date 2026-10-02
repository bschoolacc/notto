import { parseNotes, type Note } from "./note-storage.ts";
import { formatTime, rangeLabel } from "./time.ts";

export function latestNoteTime(note: Note) {
  return Math.max(0, note.recordedThrough ?? 0, ...note.chunks.map((item) => item.end), ...note.typedNotes.map((item) => item.time));
}

export function makeBackup(notes: Note[]) {
  return JSON.stringify({ format: "notto-notebook", version: 1, createdAt: Date.now(), notes }, null, 2);
}

export function parseBackup(raw: string): Note[] {
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== "object" || !("format" in data) || data.format !== "notto-notebook" || !("version" in data) || data.version !== 1 || !("notes" in data)) {
    throw new Error("Choose a Notto notebook backup (.json). Existing notes were kept.");
  }
  return parseNotes(JSON.stringify(data.notes));
}

export function duplicateNote(note: Note, id: () => string): Note {
  const typedIds = new Map(note.typedNotes.map((item) => [item.id, id()]));
  return {
    ...note, id: id(), title: `${note.title || "Untitled Note"} (copy)`, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: undefined, audioName: undefined,
    chunks: note.chunks.map((item) => ({ ...item, id: id() })),
    typedNotes: note.typedNotes.map((item) => ({ ...item, id: typedIds.get(item.id)! })),
    summaries: note.summaries.map((item) => ({ ...item, id: id(), regeneratedFrom: undefined })),
    summarizedTypedIds: note.summarizedTypedIds?.map((item) => typedIds.get(item)).filter((item): item is string => Boolean(item)),
  };
}

export function mergeBackup(current: Note[], incoming: Note[], id: () => string) {
  const notes = [...current];
  let added = 0;
  for (const note of incoming) {
    const existing = notes.find((item) => item.id === note.id);
    if (existing && JSON.stringify(existing) === JSON.stringify(note)) continue;
    notes.push(existing ? { ...duplicateNote(note, id), title: `${note.title || "Untitled Note"} (imported)` } : note);
    added += 1;
  }
  return { notes, added };
}

// Remove mathematical delimiters only. Currency such as $5 or $20 is preserved.
export function withoutMathDelimiters(source: string) {
  return source.replace(/\$\$([\s\S]+?)\$\$/g, "$1").replace(/(?<![\\\w])\$(?!\d+(?:[.,]\d+)?(?=[\s,;:.!?)]|$))([^\s$](?:[^$\n]*?[^\s$])?)\$/g, "$1");
}

export function safeFilename(title: string) {
  return (title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 120) || "Notto note");
}

export type ExportSelection = { transcript: boolean; notes: boolean; draft: boolean; quick: boolean; concise: boolean; study: boolean; actions: boolean; timestamps: boolean; latex: boolean };
export function buildNoteExport(note: Note, selection: ExportSelection) {
  const sections: string[] = [];
  if (selection.transcript && note.chunks.some((chunk) => chunk.text.trim())) sections.push("## Transcript", ...note.chunks.filter((chunk) => chunk.text.trim()).map((chunk) => `${selection.timestamps ? `[${rangeLabel(chunk.start, chunk.end)}] ` : ""}${chunk.text}`));
  if (selection.notes && note.typedNotes.some((item) => item.text.trim())) sections.push("## Typed Notes", ...note.typedNotes.filter((item) => item.text.trim()).map((item) => `${selection.timestamps ? `[${formatTime(item.time)}] ` : ""}${item.text}`));
  if (selection.draft && note.draftText?.trim()) sections.push("## Draft thought", note.draftText);
  note.summaries.filter((summary) => selection[summary.kind] && summary.source.trim()).slice().reverse().forEach((summary) => sections.push(selection.timestamps ? `Generated from ${rangeLabel(summary.start, summary.end)}` : "", summary.source));
  if (!sections.length) return "";
  const text = [`# ${note.title || "Untitled Note"}`, ...sections].filter(Boolean).join("\n\n");
  return selection.latex ? text : withoutMathDelimiters(text);
}
