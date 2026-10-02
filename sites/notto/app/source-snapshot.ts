import type { Note } from "./note-storage";
import type { GenerationMode, SourceSnapshot } from "./ai";

export function buildSourceSnapshot(note: Note, mode: GenerationMode, start: number, end?: number, exactRange = false, newOnly = false): SourceSnapshot | null {
  const ceiling = end ?? Math.max(0, ...note.chunks.map((chunk) => chunk.end), ...note.typedNotes.map((item) => item.time));
  const chunks = note.chunks.filter((chunk) => chunk.end > start && chunk.start < ceiling && chunk.text.trim()).map((chunk) => ({ ...chunk })).sort((a, b) => a.start - b.start);
  const typedNotes = note.typedNotes.filter((item) => {
    if (!item.text.trim() || item.time > ceiling) return false;
    if (newOnly) return note.summarizedTypedIds ? !note.summarizedTypedIds.includes(item.id) : item.time >= start;
    return exactRange ? item.time >= start : start === 0 ? item.time >= 0 : item.time > start;
  }).map((item) => ({ ...item })).sort((a, b) => a.time - b.time);
  if (!chunks.length && !typedNotes.length) return null;
  const sourceStart = newOnly ? Math.min(start, ...typedNotes.map((item) => item.time)) : start;
  const sourceEnd = Math.max(chunks.at(-1)?.end ?? sourceStart, typedNotes.at(-1)?.time ?? sourceStart);
  return { noteId: note.id, noteTitle: note.title, mode, start: sourceStart, end: sourceEnd, chunks, typedNotes };
}
