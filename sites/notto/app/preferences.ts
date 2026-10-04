import type { Note } from "./note-storage.ts";

export const THEMES = [
  { id: "paper", name: "Paper", color: "#6f4e37" },
  { id: "sage", name: "Sage", color: "#416349" },
  { id: "ocean", name: "Ocean", color: "#356680" },
  { id: "lavender", name: "Lavender", color: "#715586" },
  { id: "rose", name: "Rose", color: "#995462" },
  { id: "graphite", name: "Graphite", color: "#505866" },
] as const;
export const LANGUAGES = { "en-US": "English (US)", "en-GB": "English (UK)", "es-ES": "Español", "fr-FR": "Français", "de-DE": "Deutsch", "pt-BR": "Português", "zh-TW": "繁體中文", "ja-JP": "日本語", "ko-KR": "한국어", "hi-IN": "हिन्दी" };
export type Preferences = {
  palette: string; collapsed: boolean; autoName: boolean;
  liveService: "browser" | "off";
  summaryInstructions: string; transcriptionInstructions: string;
};
export const DEFAULT_PREFERENCES: Preferences = { palette: "paper", collapsed: false, autoName: true, liveService: "browser", summaryInstructions: "", transcriptionInstructions: "" };
export function parsePreferences(raw: string | null): Preferences {
  try {
    const value = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object") return { ...DEFAULT_PREFERENCES };
    return {
      palette: THEMES.some((theme) => theme.id === value.palette) ? value.palette : "paper",
      collapsed: value.collapsed === true, autoName: value.autoName !== false,
      liveService: value.liveService === "off" ? "off" : "browser",
      summaryInstructions: typeof value.summaryInstructions === "string" ? value.summaryInstructions.slice(0, 4000) : "",
      transcriptionInstructions: typeof value.transcriptionInstructions === "string" ? value.transcriptionInstructions.slice(0, 4000) : "",
    };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}
export function suggestedTitle(note: Note): string {
  const text = note.chunks.find((chunk) => chunk.text.trim())?.text || note.typedNotes.find((item) => item.text.trim())?.text || note.draftText || note.audioName?.replace(/\.[^.]+$/, "") || "";
  return text.replace(/\s+/g, " ").trim().split(" ").slice(0, 9).join(" ").slice(0, 80).replace(/[.,!?;:]+$/, "") || "Untitled Note";
}
export function autoNameNote(note: Note, enabled: boolean): Note {
  return enabled && note.titleMode !== "manual" && (!note.title.trim() || note.title === "Untitled Note") ? { ...note, title: suggestedTitle(note), titleMode: "auto" } : note;
}
export function classifyImport(file: { name: string; type: string; size: number }): "audio" | "backup" {
  if (!file.size) throw new Error("This file is empty. Choose an audio file or a Notto backup.");
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    if (file.size > 10 * 1024 * 1024) throw new Error("Choose a notebook backup under 10 MB.");
    return "backup";
  }
  if ((!file.type || file.type === "application/octet-stream") ? /\.(mp3|wav|m4a|mp4|webm|ogg|opus|aac|flac|aiff?)$/i.test(file.name) : file.type.startsWith("audio/")) {
    if (file.size > 512 * 1024 * 1024) throw new Error("Choose an audio file under 512 MB.");
    return "audio";
  }
  throw new Error("Choose an audio file or a Notto .json backup.");
}
