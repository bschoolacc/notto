export type Chunk = { id: string; start: number; end: number; text: string };
export type TypedNote = { id: string; time: number; text: string };
export type Summary = {
  id: string; kind: "quick" | "concise" | "study" | "actions";
  start: number; end: number; source: string; createdAt: number;
  provider?: string; model?: string; generationTimeMs?: number;
  regeneratedFrom?: string; usedMultiStage?: boolean;
};
export type Note = {
  id: string; title: string; createdAt: number; updatedAt: number;
  chunks: Chunk[]; typedNotes: TypedNote[]; summaries: Summary[];
  titleMode?: "auto" | "manual"; pinned?: boolean;
  summarizedThrough: number; summarizedTypedIds?: string[]; audioName?: string; recordedThrough?: number; draftText?: string; draftAt?: number | null; deletedAt?: number;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const seconds = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const range = (value: Record<string, unknown>) => seconds(value.start) && seconds(value.end) && value.end >= value.start;

// Reject corrupt storage before it can reach controlled inputs or overwrite a backup.
export function parseNotes(raw: string): Note[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((note) => object(note)
    && typeof note.id === "string" && note.id.length > 0 && typeof note.title === "string"
    && seconds(note.createdAt) && seconds(note.updatedAt) && seconds(note.summarizedThrough)
    && Array.isArray(note.chunks) && note.chunks.every((chunk) => object(chunk) && typeof chunk.id === "string" && typeof chunk.text === "string" && range(chunk))
    && Array.isArray(note.typedNotes) && note.typedNotes.every((item) => object(item) && typeof item.id === "string" && typeof item.text === "string" && seconds(item.time))
    && Array.isArray(note.summaries) && note.summaries.every((item) => object(item) && typeof item.id === "string" && typeof item.source === "string" && ["quick", "concise", "study", "actions"].includes(String(item.kind)) && range(item) && seconds(item.createdAt))
    && (note.titleMode === undefined || note.titleMode === "auto" || note.titleMode === "manual")
    && (note.pinned === undefined || typeof note.pinned === "boolean")
    && (note.draftText === undefined || typeof note.draftText === "string")
    && (note.deletedAt === undefined || seconds(note.deletedAt))
    && (note.recordedThrough === undefined || seconds(note.recordedThrough))
    && (note.audioName === undefined || typeof note.audioName === "string")
    && (note.summarizedTypedIds === undefined || (Array.isArray(note.summarizedTypedIds) && note.summarizedTypedIds.every((id) => typeof id === "string")))
    && (note.draftAt === undefined || note.draftAt === null || seconds(note.draftAt)))) {
    throw new Error("Stored notes could not be read. The original data has been kept.");
  }
  if (new Set(parsed.map((note) => note.id)).size !== parsed.length) throw new Error("Stored notes contain duplicate IDs. The original data has been kept.");
  const notes = parsed as Note[];
  for (const note of notes) {
    for (const items of [note.chunks, note.typedNotes, note.summaries]) {
      if (items.some((item) => !item.id) || new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Stored notes contain duplicate or missing block IDs. The original data has been kept.");
    }
  }
  return notes;
}
