"use client";

import { lazy, Suspense, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { geminiProvider, GenerationMode, ProviderError, ProviderModel, SourceSnapshot } from "./ai";

import { Note, Summary, parseNotes } from "./note-storage";
import { buildSourceSnapshot } from "./source-snapshot";
import { beginAudioSession, appendAudioPart, finishAudioSession, listAudioSessions, readAudioSession, importAudioSession, audioExtension, type AudioSession } from "./audio-store";
import { buildNoteExport, duplicateNote, latestNoteTime, makeBackup, mergeBackup, parseBackup, safeFilename } from "./notebook";
import { notebookStorageKey } from "./browser-keys";
import type { qaFixtures } from "./qa-fixtures";
import { NotebookDashboard } from "./notebook-dashboard";
import { THEMES, LANGUAGES, DEFAULT_PREFERENCES, parsePreferences, autoNameNote, suggestedTitle, classifyImport, type Preferences } from "./preferences";
import { transcribeAudio, transcriptionRequestPreview, type TranscriptSegment } from "./transcription";
import { buildGenerationPrompt } from "./ai";
import { formatTime, rangeLabel } from "./time";
import { defaultModel, modelCandidates, parseModelPreferences, taskForSnapshot, withModelFallback, type ModelSelection } from "./model-policy";
import { ModelSettings } from "./model-settings";

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechErrorEvent = { error: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
type RecordingSettings = { chunkSeconds: number; pauseSeconds: number; language: string };

const STORAGE_KEY = "notto-notes-v1";
const RECOVERY_KEY = "notto-original-data-v1";
const ACTIVE_NOTE_KEY = "notto-active-note-v1";
const SETTINGS_KEY = "notto-recording-settings-v1";
const AI_SETTINGS_KEY = "notto-ai-settings-v1";
const AI_KEY_STORAGE = "notto-gemini-key-v1";
const DEFAULT_SETTINGS: RecordingSettings = { chunkSeconds: 60, pauseSeconds: 8, language: "en-US" };
const WAVE_BARS = 22;
const SummaryPreview = lazy(() => import("./summary-preview").then((module) => ({ default: module.SummaryPreview })));
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const emptyNote = (): Note => ({
  id: uid(),
  title: "Untitled Note",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  chunks: [],
  typedNotes: [],
  summaries: [],
  summarizedThrough: 0,
});

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/></>,
    sparkle: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    moon: <path d="M20 15.4A8 8 0 0 1 8.6 4a8 8 0 1 0 11.4 11.4Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function Home() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState("");
  const [tab, setTab] = useState<"transcript" | "notes" | "summaries" | "export">("transcript");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused" | "stopping">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [interimStart, setInterimStart] = useState(0);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const [dashboard, setDashboard] = useState(true);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const preferencesRef = useRef(DEFAULT_PREFERENCES);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const importBusyRef = useRef(false);
  const [importing, setImporting] = useState(false);
  const [serviceCheck, setServiceCheck] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState("");
  const [transcriptError, setTranscriptError] = useState("");
  const [transcriptDraft, setTranscriptDraft] = useState<{ noteId: string; sessionId: string; offset: number; segments: TranscriptSegment[]; model: string; fallback: boolean } | null>(null);
  const transcriptDraftRef = useRef(false);
  const transcriptionControllerRef = useRef<AbortController | null>(null);
  const [dark, setDark] = useState(false);
  const [undoTrashId, setUndoTrashId] = useState("");
  const [notice, setNotice] = useState("");
  const [mounted, setMounted] = useState(false);
  const [summaryMenu, setSummaryMenu] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "capture" | "ai" | "data">("appearance");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveApiKey, setSaveApiKey] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelSelection, setModelSelection] = useState<ModelSelection>("recommended");
  const [autoFallback, setAutoFallback] = useState(true);
  const [aiStatus, setAiStatus] = useState<{ state: "unconfigured" | "checking" | "connected" | "error"; message: string }>({ state: "unconfigured", message: "Add a Gemini API key to enable AI notes." });
  const [generation, setGeneration] = useState<{ mode: GenerationMode; label: string } | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [pendingSource, setPendingSource] = useState<SourceSnapshot | null>(null);
  const [startingRecording, setStartingRecording] = useState(false);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "error">("saving");
  const [storageError, setStorageError] = useState("");
  const [storageConflict, setStorageConflict] = useState(false);
  const [recoveryBackup, setRecoveryBackup] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [noteMenu, setNoteMenu] = useState(false);
  const [audioSessions, setAudioSessions] = useState<AudioSession[]>([]);
  const [audioRevision, setAudioRevision] = useState(0);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [audioURL, setAudioURL] = useState("");
  const [audioError, setAudioError] = useState("");
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [ephemeralAudioIds, setEphemeralAudioIds] = useState<string[]>([]);
  const [transcriptionState, setTranscriptionState] = useState<"idle" | "listening" | "unavailable" | "blocked">("idle");
  const [pendingRegeneratedFrom, setPendingRegeneratedFrom] = useState<string | undefined>();
  const qaRef = useRef<ReturnType<typeof qaFixtures>>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioWriteRef = useRef<Promise<void>>(Promise.resolve());
  const fallbackAudioRef = useRef<Record<string, Blob>>({});
  const lastSavedRef = useRef<string | null>(null);
  const latestActiveRef = useRef("");
  const recordingBusyRef = useRef(false);
  const waveformRef = useRef<HTMLDivElement>(null);
  const startingRef = useRef(false);
  const recordingOffsetRef = useRef(0);
  const recognitionSessionRef = useRef(0);
  const elapsedRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelControllerRef = useRef<AbortController | null>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const typedInputRef = useRef<HTMLTextAreaElement>(null);
  const newestChunkRef = useRef<HTMLTextAreaElement>(null);
  const focusChunkRef = useRef(false);
  const storageBlockedRef = useRef(false);
  const latestNotesRef = useRef<Note[]>([]);
  const persistRef = useRef<() => void>(() => {});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingStartedRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const pauseStartedRef = useRef(0);
  const chunkStartRef = useRef(0);
  const bufferRef = useRef("");
  const pauseFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldListenRef = useRef(false);
  const settingsRef = useRef<RecordingSettings>(DEFAULT_SETTINGS);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const generationControllerRef = useRef<AbortController | null>(null);
  const autoConnectRef = useRef(false);

  const active = notes.find((note) => note.id === activeId) ?? notes[0];
  const typedDraft = active?.draftText ?? "";
  const typedAt = active?.draftAt ?? null;
  const selectedAudio = audioSessions.find((session) => session.id === selectedAudioId);
  const deferredSearch = useDeferredValue(search);
  const recordingBusy = recordingState !== "idle" || startingRecording;
  useLayoutEffect(() => {
    transcriptDraftRef.current = Boolean(transcriptDraft);
    latestNotesRef.current = notes;
    latestActiveRef.current = activeId;
    recordingBusyRef.current = recordingBusy;
  }, [notes, activeId, recordingBusy, transcriptDraft]);

  useEffect(() => { if (mounted) window.scrollTo({ top: 0, behavior: "instant" }); }, [activeId, tab, dashboard, mounted]);

  /* Browser storage is intentionally hydrated after mount to avoid server/client drift. */
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
    if (process.env.NODE_ENV === "development") {
      const fixtures = await import("./qa-fixtures");
      if (cancelled) return;
      qaRef.current = fixtures.qaFixtures();
    }
    const readSetting = (key: string) => { try { return localStorage.getItem(notebookStorageKey(key)); } catch { return null; } };
    let loaded: Note[] = [];
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(notebookStorageKey(STORAGE_KEY));
      lastSavedRef.current = saved;
      loaded = saved ? parseNotes(saved) : [];
    } catch {
      storageBlockedRef.current = Boolean(saved);
      setStorageError(saved ? "Stored notes could not be read. The original data is preserved; export new work before leaving." : "Browser storage is unavailable. Export your notes before leaving.");
      setSaveState("error");
    }
    if (!loaded.length) loaded = qaRef.current?.notes.length ? qaRef.current.notes : [emptyNote()];
    setNotes(loaded);
    const selected = loaded.find((note) => note.id === readSetting(ACTIVE_NOTE_KEY) && !note.deletedAt) ?? loaded.find((note) => !note.deletedAt) ?? loaded[0];
    setActiveId(selected.id);
    setElapsed(latestNoteTime(selected));
    setPreferences(parsePreferences(readSetting("notto-preferences-v1")));
    setDark(readSetting("notto-theme") === "dark");
    setRecoveryBackup(readSetting(RECOVERY_KEY) ?? "");
    const savedSettings = readSetting(SETTINGS_KEY);
    if (savedSettings) {
      try {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) } as RecordingSettings;
        if (![45, 60, 90, 120].includes(parsed.chunkSeconds)) parsed.chunkSeconds = 60;
        if (![0, 6, 8, 12, 15].includes(parsed.pauseSeconds)) parsed.pauseSeconds = 8;
        if (!(parsed.language in LANGUAGES)) parsed.language = "en-US";
        settingsRef.current = parsed;
        setSettings(parsed);
      } catch { /* keep safe defaults */ }
    }
    const savedAI = readSetting(AI_SETTINGS_KEY);
    if (savedAI) {
      try {
        const parsed = parseModelPreferences(savedAI);
        setSaveApiKey(Boolean(parsed.saveKey));
        setSelectedModel(parsed.selectedModel);
        setModelSelection(parsed.modelSelection);
        setAutoFallback(parsed.autoFallback);
        if (parsed.saveKey) setApiKey(readSetting(AI_KEY_STORAGE) ?? "");
      } catch { /* keep AI unconfigured */ }
    }
    if (process.env.NODE_ENV === "development" && qaRef.current) {
      setApiKey("qa-key");
    }
    setMounted(true);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mounted && activeId) { try { localStorage.setItem(notebookStorageKey(ACTIVE_NOTE_KEY), activeId); } catch { /* note saving surfaces storage failures */ } }
  }, [mounted, activeId]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== notebookStorageKey(STORAGE_KEY) || event.newValue === lastSavedRef.current || storageBlockedRef.current) return;
      if (!recordingBusyRef.current && !generationControllerRef.current && JSON.stringify(latestNotesRef.current) === lastSavedRef.current && event.newValue) {
        try {
          const loaded = parseNotes(event.newValue);
          if (!loaded.length) loaded.unshift(emptyNote());
          lastSavedRef.current = event.newValue;
          setNotes(loaded);
          const next = loaded.find((note) => note.id === latestActiveRef.current && !note.deletedAt) ?? loaded.find((note) => !note.deletedAt) ?? loaded[0];
          setActiveId(next.id); setElapsed(latestNoteTime(next));
          return;
        } catch { /* preserve current work on invalid external data */ }
      }
      storageBlockedRef.current = true; setStorageConflict(true); setSaveState("error");
      setStorageError("Another tab changed this notebook. Back up this tab, then load the latest notebook to continue.");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* Audio selection is synchronized with the external browser database. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!mounted || !activeId) return;
    let cancelled = false;
    setAudioLoading(true); setAudioError(""); setAudioURL("");
    void listAudioSessions(activeId, notebookStorageKey("notto-audio-v1")).then((sessions) => {
      if (cancelled) return;
      setAudioSessions(sessions); setSelectedAudioId(sessions[0]?.id ?? "");
      const through = Math.max(0, ...sessions.filter((session) => session.offset !== undefined).map((session) => (session.offset ?? 0) + session.duration));
      if (through > 0 && !recordingBusyRef.current) {
        setNotes((current) => current.map((note) => note.id === activeId && through > (note.recordedThrough ?? 0) ? { ...note, recordedThrough: through } : note));
        setElapsed((current) => Math.max(current, through)); elapsedRef.current = Math.max(elapsedRef.current, through);
      }
    }).catch(() => { if (!cancelled) { setAudioSessions([]); setAudioError("Saved audio could not be opened on this device. Your text notes are still available."); } }).finally(() => { if (!cancelled) setAudioLoading(false); });
    return () => { cancelled = true; };
  }, [activeId, mounted, audioRevision]);

  useEffect(() => {
    if (!selectedAudioId) return;
    const session = audioSessions.find((item) => item.id === selectedAudioId);
    if (!session) return;
    let cancelled = false; let url = "";
    setAudioLoading(true); setAudioURL("");
    void (fallbackAudioRef.current[session.id] ? Promise.resolve(fallbackAudioRef.current[session.id]) : readAudioSession(session, notebookStorageKey("notto-audio-v1"))).then((blob) => {
      if (cancelled) return;
      if (!blob.size) { setAudioError("This recording ended before audio was saved. Record another session to continue."); return; }
      url = URL.createObjectURL(blob); setAudioURL(url);
    }).catch(() => { if (!cancelled) setAudioError("This audio could not be opened. Try again after freeing device storage."); }).finally(() => { if (!cancelled) setAudioLoading(false); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [selectedAudioId, audioSessions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      shellRef.current?.style.setProperty("--keyboard-inset", `${inset}px`);
    };
    viewport?.addEventListener("resize", sync); viewport?.addEventListener("scroll", sync);
    return () => { viewport?.removeEventListener("resize", sync); viewport?.removeEventListener("scroll", sync); };
  }, [mounted]);

  useEffect(() => {
    if (recordingState !== "recording" || !("wakeLock" in navigator)) return;
    let disposed = false; let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || lock && !lock.released) return;
      try { const next = await navigator.wakeLock.request("screen"); if (disposed) await next.release(); else lock = next; }
      catch { /* capture remains usable when the device declines a wake lock */ }
    };
    void acquire(); document.addEventListener("visibilitychange", acquire);
    return () => { disposed = true; document.removeEventListener("visibilitychange", acquire); void lock?.release().catch(() => {}); };
  }, [recordingState]);

  useEffect(() => {
    const beforeLeave = (event: BeforeUnloadEvent) => {
      persistRef.current();
      if (recordingBusyRef.current || generationControllerRef.current || transcriptionControllerRef.current || transcriptDraftRef.current || storageBlockedRef.current || Object.keys(fallbackAudioRef.current).length || JSON.stringify(latestNotesRef.current) !== lastSavedRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeLeave);
    return () => window.removeEventListener("beforeunload", beforeLeave);
  }, []);

  // Typing updates immediately; serialize once after a short idle period.
  useEffect(() => {
    if (!mounted || !notes.length) return;
    const persist = () => {
      if (storageBlockedRef.current) { setSaveState("error"); return; }
      try {
        const key = notebookStorageKey(STORAGE_KEY);
        const current = localStorage.getItem(key);
        const next = JSON.stringify(latestNotesRef.current);
        if (current !== lastSavedRef.current && current !== next) {
          storageBlockedRef.current = true;
          setStorageConflict(true); setSaveState("error");
          setStorageError("Another tab saved newer notes. Download a backup of this tab, then load the latest notebook to continue.");
          return;
        }
        localStorage.setItem(key, next);
        lastSavedRef.current = next;
        setSaveState("saved");
        setStorageError("");
      } catch {
        setSaveState("error");
        setStorageError("Notes could not be saved on this device. Keep this tab open and export your work.");
      }
    };
    persistRef.current = persist;
    const timer = setTimeout(persist, 450);
    const onHidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onHidden);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); document.removeEventListener("visibilitychange", onHidden); };
  }, [notes, mounted]);

  useEffect(() => {
    preferencesRef.current = preferences;
    if (mounted) { try { localStorage.setItem(notebookStorageKey("notto-preferences-v1"), JSON.stringify(preferences)); } catch { showNotice("Preferences changed for this tab but could not be saved."); } }
  }, [preferences, mounted]);

  useEffect(() => {
    settingsRef.current = settings;
    if (mounted) {
      try { localStorage.setItem(notebookStorageKey(SETTINGS_KEY), JSON.stringify(settings)); }
      catch { showNotice("Recording preferences could not be saved on this device."); }
    }
  }, [settings, mounted]);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(notebookStorageKey(AI_SETTINGS_KEY), JSON.stringify({ provider: "gemini", saveKey: saveApiKey, selectedModel, modelSelection, autoFallback }));
      if (saveApiKey && apiKey.trim()) localStorage.setItem(notebookStorageKey(AI_KEY_STORAGE), apiKey.trim());
      else localStorage.removeItem(notebookStorageKey(AI_KEY_STORAGE));
    } catch { showNotice("AI preferences could not be saved. The key remains available in this tab."); }
  }, [apiKey, mounted, saveApiKey, selectedModel, modelSelection, autoFallback]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
    disposedRef.current = true;
    persistRef.current();
    startingRef.current = false;
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    void audioContextRef.current?.close().catch(() => {});
    if (pauseFlushRef.current) clearTimeout(pauseFlushRef.current);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    generationControllerRef.current?.abort();
    modelControllerRef.current?.abort();
    transcriptionControllerRef.current?.abort();
    qaRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (recordingState !== "recording") return;
    const tick = window.setInterval(() => {
      const now = Date.now();
      const value = recordingOffsetRef.current + Math.max(0, Math.floor((now - recordingStartedRef.current - pausedTotalRef.current) / 1000));
      elapsedRef.current = value;
      setElapsed(value);
      if (value - chunkStartRef.current >= settingsRef.current.chunkSeconds && bufferRef.current.trim()) flushTranscript(value);
    }, 250);
    return () => window.clearInterval(tick);
  // flushTranscript is deliberately read from the current render on each timer setup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingState, activeId]);

  const updateActive = (recipe: (note: Note) => Note, nameFromContent = false) => {
    setSaveState(storageBlockedRef.current ? "error" : "saving");
    setNotes((all) => all.map((note) => note.id === activeId ? { ...(nameFromContent ? autoNameNote(recipe(note), preferencesRef.current.autoName) : recipe(note)), updatedAt: Date.now() } : note));
  };

  function flushTranscript(end = elapsedRef.current) {
    if (pauseFlushRef.current) clearTimeout(pauseFlushRef.current);
    const text = bufferRef.current.trim();
    if (!text || !activeId) return;
    const start = chunkStartRef.current;
    const safeEnd = Math.max(start + 1, end);
    updateActive((note) => ({ ...note, chunks: [...note.chunks, { id: uid(), start, end: safeEnd, text }] }), true);
    bufferRef.current = "";
    setInterim("");
    chunkStartRef.current = safeEnd;
  }

  function showNotice(message: string) {
    setUndoTrashId("");
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 5500);
  }

  const stopAudioAnalyser = () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
    waveformRef.current?.querySelectorAll<HTMLElement>("i").forEach((bar) => { bar.style.height = "4px"; });
  };

  const startAudioAnalyser = (stream: MediaStream) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    context.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = context;
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      analyser.getByteFrequencyData(data);
      const next = Array.from({ length: WAVE_BARS }, (_, index) => {
        const bin = Math.min(data.length - 1, 1 + Math.floor(index * 1.65));
        const nearby = (data[bin] + data[Math.min(data.length - 1, bin + 1)]) / 2;
        return Math.max(3, Math.min(29, 3 + (nearby / 255) * 30));
      });
      waveformRef.current?.querySelectorAll<HTMLElement>("i").forEach((bar, index) => { bar.style.height = `${next[index]}px`; });
      animationFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  };

  const startRecognition = () => {
    if (preferencesRef.current.liveService === "off") { setTranscriptionState("idle"); return; }
    const SpeechRecognition = qaRef.current?.SpeechRecognition || (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscriptionState("unavailable");
      showNotice("Live transcription is unavailable in this browser. Recording and typed notes still work; Chrome desktop is recommended.");
      return;
    }
    const session = ++recognitionSessionRef.current;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = settingsRef.current.language;
    recognition.onresult = (event: SpeechResultEvent) => {
      if (session !== recognitionSessionRef.current || disposedRef.current) return;
      let temporary = "";
      let confirmed = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) confirmed += ` ${phrase}`;
        else temporary += ` ${phrase}`;
      }
      if (confirmed.trim()) {
        bufferRef.current = `${bufferRef.current} ${confirmed}`.trim();
        setInterimStart(chunkStartRef.current);
        setInterim(bufferRef.current);
        if (!shouldListenRef.current) { flushTranscript(); return; }
        if (pauseFlushRef.current) clearTimeout(pauseFlushRef.current);
        const silenceSeconds = settingsRef.current.pauseSeconds;
        if (silenceSeconds > 0) pauseFlushRef.current = setTimeout(() => flushTranscript(), silenceSeconds * 1000);
      }
      if (temporary.trim()) { setInterimStart(chunkStartRef.current); setInterim(`${bufferRef.current} ${temporary}`.trim()); }
    };
    recognition.onerror = (event: SpeechErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldListenRef.current = false;
        setTranscriptionState("blocked");
        showNotice("Live transcription was blocked. Audio recording continues; add typed notes or allow speech recognition.");
      } else if (event.error === "network") {
        shouldListenRef.current = false;
        setTranscriptionState("blocked");
        showNotice("Speech recognition lost its connection. Audio recording continues; pause and resume to retry transcription.");
      }
    };
    recognition.onend = () => {
      if (shouldListenRef.current && session === recognitionSessionRef.current) {
        try { recognition.start(); } catch { /* browser is already restarting */ }
      }
    };
    recognitionRef.current = recognition;
    shouldListenRef.current = true;
    try { recognition.start(); setTranscriptionState("listening"); } catch { setTranscriptionState("unavailable"); }
  };

  const startRecording = async () => {
    if (startingRef.current || recordingState !== "idle") return;
    if (!qaRef.current && !navigator.mediaDevices?.getUserMedia) {
      const message = "This browser cannot access the microphone. Try Chrome on a secure connection.";
      setAudioError(message); showNotice(message);
      return;
    }
    startingRef.current = true;
    setStartingRecording(true);
    setAudioError("");
    try {
      const stream = await (qaRef.current ? qaRef.current.getUserMedia() : navigator.mediaDevices.getUserMedia({ audio: true }));
      if (!startingRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      if (typeof MediaRecorder === "undefined") throw new Error("Audio recording is unavailable in this browser.");
      try { startAudioAnalyser(stream); } catch { /* a visualizer must never prevent audio capture */ }
      const pendingParts = new Map<number, Blob>();
      audioRef.current?.pause();
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 64000, ...(mimeType ? { mimeType } : {}) });
      const noteId = activeId;
      const session: AudioSession = { id: uid(), noteId, name: "Recorded lecture", mimeType: recorder.mimeType, createdAt: Date.now(), duration: 0, offset: active ? latestNoteTime(active) : 0, status: "recording" };
      const namespace = notebookStorageKey("notto-audio-v1");
      let storageHealthy = true;
      let sequence = 0;
      try { await beginAudioSession(session, namespace); }
      catch { storageHealthy = false; setAudioError("Audio storage is unavailable. Download this recording before closing the tab."); }
      audioWriteRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        const index = sequence++;
        const capturedDuration = Math.max(0, ((pauseStartedRef.current || Date.now()) - recordingStartedRef.current - pausedTotalRef.current) / 1000);
        pendingParts.set(index, event.data);
        audioWriteRef.current = audioWriteRef.current.then(async () => {
          if (!storageHealthy) return;
          try { await appendAudioPart(session.id, index, event.data, namespace, capturedDuration); pendingParts.delete(index); }
          catch { storageHealthy = false; if (!disposedRef.current) setAudioError("Audio could not be saved. Download this session before leaving."); }
        });
      };
      recorder.onstop = async () => {
        shouldListenRef.current = false;
        try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
        stream.getTracks().forEach((track) => track.stop());
        stopAudioAnalyser();
        if (!disposedRef.current) { flushTranscript(); setRecordingState("stopping"); setTranscriptionState("idle"); }
        const duration = Math.max(0, ((pauseStartedRef.current || Date.now()) - recordingStartedRef.current - pausedTotalRef.current) / 1000);
        await audioWriteRef.current;
        if (storageHealthy) {
          try { await finishAudioSession(session.id, duration, namespace, recorder.mimeType); }
          catch { storageHealthy = false; }
        }
        if (disposedRef.current) return;
        const through = (session.offset ?? 0) + duration;
        setNotes((current) => current.map((note) => note.id === noteId ? { ...note, recordedThrough: Math.max(note.recordedThrough ?? 0, through), updatedAt: Date.now() } : note));
        setElapsed(through); elapsedRef.current = through;
        setRecordingState("idle"); mediaRecorderRef.current = null;
        if (storageHealthy) {
          setAudioRevision((value) => value + 1);
          showNotice("Recording saved on this device");
        } else {
          let committed = new Blob([]);
          try { committed = await readAudioSession(session, namespace); } catch { /* the committed prefix remains recoverable if storage becomes available */ }
          const blob = new Blob([committed, ...[...pendingParts.entries()].sort((a, b) => a[0] - b[0]).map((item) => item[1])], { type: recorder.mimeType });
          fallbackAudioRef.current[session.id] = blob;
          setEphemeralAudioIds((all) => [...all, session.id]);
          setAudioSessions((current) => [{ ...session, status: "interrupted", duration }, ...current]);
          setSelectedAudioId(session.id);
          setAudioError("This session is only available in this tab. Download it before leaving; device storage did not save it.");
        }
      };
      recorder.onerror = () => { showNotice("Audio recording encountered a problem. Your saved text is still available."); if (recorder.state !== "inactive") recorder.stop(); };
      recorder.start(5000);
      mediaRecorderRef.current = recorder;
      recordingStartedRef.current = Date.now();
      pausedTotalRef.current = 0;
      pauseStartedRef.current = 0;
      chunkStartRef.current = active ? latestNoteTime(active) : 0;
      recordingOffsetRef.current = chunkStartRef.current;
      elapsedRef.current = chunkStartRef.current;
      setElapsed(chunkStartRef.current);
      setRecordingState("recording");
      startRecognition();
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopAudioAnalyser();
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone access was denied. Allow it in your browser and try again." : "The microphone could not start. Check that an audio input is available and try again.";
      setAudioError(message); showNotice(message);
    } finally { startingRef.current = false; setStartingRecording(false); }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state !== "recording") return;
    mediaRecorderRef.current.pause();
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    pauseStartedRef.current = Date.now();
    void audioContextRef.current?.suspend().catch(() => {});
    flushTranscript(elapsedRef.current);
    setRecordingState("paused");
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state !== "paused") return;
    mediaRecorderRef.current.resume();
    pausedTotalRef.current += Date.now() - pauseStartedRef.current;
    pauseStartedRef.current = 0;
    void audioContextRef.current?.resume().catch(() => {});
    setRecordingState("recording");
    startRecognition();
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    flushTranscript(elapsedRef.current);
    recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    stopAudioAnalyser();
    setRecordingState("stopping");

  };

  const createNote = () => {
    if (recordingBusy) return;
    const note = emptyNote();
    setDashboard(false);
    setNotes((all) => [note, ...all]);
    setActiveId(note.id);
    setTab("transcript");
    setElapsed(0);
    setSidebarOpen(false);
    setShowTrash(false);
    setSaveState("saving");
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const handleAudioImport = async (file: File) => {
    if (recordingBusy) return;
    try { if (classifyImport(file) !== "audio") throw new Error("Choose an audio file."); } catch (error) { showNotice((error as Error).message); return; }
    const target = active.deletedAt ? emptyNote() : active;
    const noteId = target.id;
    if (target.id !== activeId) { setNotes((all) => [target, ...all]); setActiveId(target.id); setElapsed(0); }
    const session: AudioSession = { id: uid(), noteId, name: file.name, mimeType: file.type && file.type !== "application/octet-stream" ? file.type : ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/m4a", mp4: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac" } as Record<string, string>)[file.name.split(".").at(-1)?.toLowerCase() ?? ""] || "audio/webm", createdAt: Date.now(), duration: 0, status: "ready" };
    setAudioLoading(true);
    try { await importAudioSession(session, file, notebookStorageKey("notto-audio-v1")); }
    catch { setAudioError("The imported audio could not be saved. Free device storage and try again."); setAudioLoading(false); return; }
    if (latestActiveRef.current === noteId) setAudioRevision((value) => value + 1);
    setNotes((all) => all.map((note) => note.id === noteId ? autoNameNote({ ...note, audioName: file.name, updatedAt: Date.now() }, preferencesRef.current.autoName) : note));
    if (latestActiveRef.current === noteId) { setTab("transcript"); setDashboard(false); }
    showNotice("Audio loaded locally. You can play it while adding or editing transcript text.");
  };

  const handleFileImport = async (file: File) => {
    if (!file || recordingBusy || generation || transcribing || importBusyRef.current) { showNotice("Finish the current capture or import first."); return; }
    importBusyRef.current = true; setImporting(true);
    try {
      const kind = classifyImport(file);
      if (kind === "backup") await importBackup(file);
      else await handleAudioImport(file);
    } catch (error) { showNotice(error instanceof Error ? error.message : "The file could not be imported."); }
    finally { importBusyRef.current = false; setImporting(false); }
  };

  const runTranscription = async () => {
    if (transcriptionControllerRef.current || recordingBusy || transcriptDraft || !selectedAudio || active.deletedAt) return;
    const candidates = modelCandidates(models, "audio", { modelSelection, selectedModel, autoFallback, transcriptionInstructions: preferences.transcriptionInstructions });
    if (aiStatus.state !== "connected" || !candidates.length) {
      setTranscriptError(aiStatus.state === "connected" ? "This manual model is not supported for audio transcription. Choose Recommended or an audio-compatible Gemini model in AI settings." : "Connect Gemini in AI settings to transcribe saved audio.");
      setSettingsSection("ai"); setSettingsOpen(true); return;
    }
    const session = selectedAudio;
    const noteId = activeId;
    const duration = Number.isFinite(audioRef.current?.duration) ? audioRef.current!.duration : session.duration;
    const controller = new AbortController(); transcriptionControllerRef.current = controller;
    setTranscribing(true); setTranscriptError(""); setTranscriptionProgress("Loading saved audio…");
    try {
      const audio = fallbackAudioRef.current[session.id] ?? await readAudioSession(session, notebookStorageKey("notto-audio-v1"));
      const result = await withModelFallback(candidates, (model) => qaRef.current ? qaRef.current.transcribe(apiKey, controller.signal) : transcribeAudio(apiKey, model, audio, preferences.transcriptionInstructions, settings.language, duration, controller.signal), controller.signal, (model, attempt, reason) => {
        setTranscriptionProgress(`${attempt ? `Fallback ${attempt}: ${reason}. ` : ""}${model.displayName} is transcribing…`);
      });
      const segments = result.value;
      if (controller.signal.aborted) throw new Error("Transcription cancelled. No text was added.");
      if (!segments.length) { showNotice("No speech was detected. Existing text was kept."); return; }
      setTranscriptDraft({ noteId, sessionId: session.id, offset: session.offset ?? 0, segments, model: result.model.name, fallback: result.attemptedModels.length > 1 });
      setActiveId(noteId); setDashboard(false); setTab("transcript");
      showNotice("Transcript ready to review. Nothing has been added yet.");
    } catch (error) { setTranscriptError(controller.signal.aborted ? "Transcription cancelled. No text was added." : error instanceof Error ? error.message : "Transcription failed. No text was added."); }
    finally { if (transcriptionControllerRef.current === controller) transcriptionControllerRef.current = null; setTranscribing(false); }
  };

  const testCaptureService = async () => {
    setServiceCheck("Checking microphone access…");
    try {
      const stream = await (qaRef.current ? qaRef.current.getUserMedia() : navigator.mediaDevices.getUserMedia({ audio: true }));
      stream.getTracks().forEach((track) => track.stop());
      const speech = Boolean(qaRef.current?.SpeechRecognition || (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition);
      setServiceCheck(preferences.liveService === "off" ? "Microphone opened successfully. Live transcription is off; audio stays on this device." : speech ? "Microphone opened. Browser speech recognition is available; record a short sample to check its accuracy and connection." : "Microphone opened. This browser has no live speech service. You can record audio and transcribe a saved clip with Gemini.");
    } catch { setServiceCheck("Microphone access failed. Allow microphone access in browser settings and check your input device."); }
  };

  const refreshModels = async (announce = true) => {
    if (!apiKey.trim()) {
      setAiStatus({ state: "unconfigured", message: "Paste a Gemini API key before refreshing models." });
      return;
    }
    modelControllerRef.current?.abort();
    const controller = new AbortController();
    modelControllerRef.current = controller;
    setAiStatus({ state: "checking", message: "Contacting Gemini…" });
    try {
      const available = await (qaRef.current?.provider ?? geminiProvider).listModels(apiKey, controller.signal);
      if (controller.signal.aborted || modelControllerRef.current !== controller) return;
      if (!available.length) throw new ProviderError("unavailable_model", "No compatible note or saved-audio transcription models are available to this key.");
      setModels(available);
      const savedStillExists = available.some((model) => model.name === selectedModel);
      const next = modelSelection === "manual" && savedStillExists ? selectedModel : defaultModel(available)?.name ?? "";
      setSelectedModel(next);
      const switched = modelSelection === "manual" && Boolean(selectedModel) && !savedStillExists;
      setAiStatus({ state: "connected", message: switched ? `Connected. ${selectedModel} disappeared, so Notto selected ${next || "Recommended"}.` : `Connected to Google. ${countLabel(available.length, "compatible AI model")} found.` });
      if (announce) showNotice(switched ? `Model changed to ${next}` : "Gemini connection verified");
    } catch (error) {
      if (controller.signal.aborted || modelControllerRef.current !== controller) return;
      const message = error instanceof ProviderError ? error.message : "Could not verify the Gemini connection.";
      setAiStatus({ state: "error", message });
      setModels([]);
    }
  };

  const runGeneration = async (snapshot: SourceSnapshot, regeneratedFrom?: string) => {
    if (generationControllerRef.current) return;
    const candidates = modelCandidates(models, taskForSnapshot(snapshot), { modelSelection, selectedModel, autoFallback });
    if (!apiKey.trim() || aiStatus.state !== "connected" || !candidates.length) {
      setSettingsSection("ai"); setSettingsOpen(true);
      setAiStatus((current) => ({ ...current, message: current.state === "connected" ? "No compatible model is selected for this source. Choose a model manually or refresh models." : "Add and test a Gemini API key, then select a model before generating notes." }));
      return;
    }
    const noteId = snapshot.noteId;
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setPendingSource(snapshot);
    setPendingRegeneratedFrom(regeneratedFrom);
    setGenerationError("");
    setGeneration({ mode: snapshot.mode, label: regeneratedFrom ? "Regenerating with Gemini…" : "Gemini is writing your notes…" });
    setTab("summaries");
    setSummaryMenu(false);
    const started = Date.now();
    try {
      let modelLabel = "";
      const completed = await withModelFallback(candidates, (model) => (qaRef.current?.provider ?? geminiProvider).generate(apiKey, model, snapshot, controller.signal, (label) => { if (!controller.signal.aborted) setGeneration({ mode: snapshot.mode, label: `${modelLabel} · ${label}` }); }), controller.signal, (model, attempt, reason) => {
        modelLabel = `${attempt ? `Fallback ${attempt} (${reason}): ` : ""}${model.displayName}`;
        setGeneration({ mode: snapshot.mode, label: `${modelLabel} · Starting…` });
      });
      const result = completed.value;
      if (controller.signal.aborted) throw new ProviderError("cancelled", "Generation was cancelled. The source range is ready to retry.");
      setSaveState("saving");
      const summary: Summary = {
        id: uid(), kind: snapshot.mode, start: snapshot.start, end: snapshot.end, source: result.source,
        createdAt: Date.now(), provider: "Google Gemini API", model: completed.model.name, generationTimeMs: Date.now() - started,
        fallbackFrom: completed.attemptedModels.slice(0, -1),
        regeneratedFrom, usedMultiStage: result.usedMultiStage,
      };
      setNotes((all) => all.map((note) => note.id === noteId ? {
        ...note,
        summaries: [summary, ...note.summaries],
        summarizedThrough: snapshot.mode === "quick" && !regeneratedFrom ? Math.max(note.summarizedThrough, snapshot.end) : note.summarizedThrough,
        summarizedTypedIds: snapshot.mode === "quick" && !regeneratedFrom ? [...new Set([...(note.summarizedTypedIds ?? []), ...snapshot.typedNotes.map((item) => item.id)])] : note.summarizedTypedIds,
        updatedAt: Date.now(),
      } : note));
      setPendingSource(null);
      showNotice(`${snapshot.mode === "study" ? "Study guide" : snapshot.mode === "concise" ? "Basic notes" : "Catch Me Up"} saved with ${completed.model.displayName}${completed.attemptedModels.length > 1 ? " (fallback)" : ""}${result.usedMultiStage ? " · complete multi-stage synthesis" : ""}`);
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : "Gemini could not generate these notes. The source range is ready to retry.";
      setGenerationError(message);
    } finally {
      if (generationControllerRef.current === controller) generationControllerRef.current = null;
      setGeneration(null);
    }
  };

  const generateSummary = (kind: GenerationMode, options?: { wholeLecture?: boolean; regenerate?: Summary }) => {
    if (generation) return;
    if (!apiKey.trim() || aiStatus.state !== "connected" || !selectedModel) {
      setSettingsSection("ai"); setSettingsOpen(true);
      showNotice("Connect Gemini in Settings to generate AI notes");
      return;
    }
    const start = options?.regenerate ? options.regenerate.start : kind === "quick" && !options?.wholeLecture ? active.summarizedThrough : 0;
    const snapshot = buildSourceSnapshot(active, kind, start, options?.regenerate?.end, Boolean(options?.regenerate), kind === "quick" && !options?.wholeLecture && !options?.regenerate);
    if (!snapshot) {
      showNotice(kind === "quick" ? "Nothing new to summarize yet. Only completed transcript chunks are used." : "Add confirmed transcript or typed notes before generating study notes.");
      return;
    }
    void runGeneration({ ...snapshot, instructions: preferences.summaryInstructions }, options?.regenerate?.id);
  };

  const saveTypedNote = () => {
    if (!typedDraft.trim()) return;
    updateActive((note) => ({ ...note, typedNotes: [...note.typedNotes, { id: uid(), time: typedAt ?? elapsed, text: typedDraft.trim() }], draftText: "", draftAt: null }), true);
    showNotice("Typed note added");
    typedInputRef.current?.focus();
  };

  const addTranscriptChunk = () => {
    if (recordingBusy) return;
    focusChunkRef.current = true;
    const start = Math.max(elapsed, latestNoteTime(active));
    updateActive((note) => ({ ...note, chunks: [...note.chunks, { id: uid(), start, end: start + settings.chunkSeconds, text: "" }] }));
    showNotice(`Blank ${settings.chunkSeconds}-second transcript chunk added`);
  };

  const downloadFile = (contents: string, filename: string, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadBackup = () => {
    downloadFile(makeBackup(latestNotesRef.current), `Notto-notebook-${new Date().toISOString().slice(0, 10)}.json`);
    showNotice("Notebook backup download started. Audio is downloaded separately.");
  };

  const importBackup = async (file: File) => {
    if (recordingBusy || generation) return;
    if (file.size > 10 * 1024 * 1024) { showNotice("Choose a notebook backup under 10 MB."); return; }
    try {
      const incoming = parseBackup(await file.text());
      const merged = mergeBackup(latestNotesRef.current, incoming, uid);
      setNotes(merged.notes); setSaveState("saving");
      showNotice(`${merged.added} notes restored. Existing notes were kept.`);
    } catch (error) { showNotice(error instanceof SyntaxError ? "This backup could not be read. Choose a valid Notto .json backup; existing notes were kept." : error instanceof Error ? error.message : "The backup could not be restored. Existing notes were kept."); }
  };

  const loadLatestNotebook = () => {
    if (recordingBusy || generation) return;
    try {
      const raw = localStorage.getItem(notebookStorageKey(STORAGE_KEY));
      const loaded = raw ? parseNotes(raw) : [];
      if (!loaded.length) loaded.unshift(emptyNote());
      storageBlockedRef.current = false; lastSavedRef.current = raw;
      setNotes(loaded); setStorageConflict(false); setStorageError(""); setShowTrash(false);
      const next = loaded.find((note) => !note.deletedAt) ?? loaded[0]; setActiveId(next.id); setElapsed(latestNoteTime(next));
      showNotice("Latest notebook loaded");
    } catch { showNotice("Stored data could not be read. Download a backup of this tab to protect your work."); }
  };

  const recoverStorage = () => {
    try {
      const raw = localStorage.getItem(notebookStorageKey(STORAGE_KEY));
      if (raw) {
        const previous = localStorage.getItem(notebookStorageKey(RECOVERY_KEY));
        let copies: unknown = [];
        try { copies = previous ? JSON.parse(previous) : []; } catch { copies = previous ? [previous] : []; }
        const preserved = JSON.stringify([...(Array.isArray(copies) ? copies : [previous]), raw]);
        localStorage.setItem(notebookStorageKey(RECOVERY_KEY), preserved);
        setRecoveryBackup(preserved);
        downloadFile(raw, "Notto-original-unreadable-data.json");
      }
      lastSavedRef.current = raw; storageBlockedRef.current = false;
      setStorageError(""); setSaveState("saving"); setNotes((all) => [...all]);
      showNotice("Original data preserved on this device. Backup download started; saving is enabled.");
    } catch { showNotice("Browser storage is unavailable. Keep exporting your work."); }
  };

  const copyNote = () => {
    if (recordingBusy) return;
    setDashboard(false);
    const copy = duplicateNote(active, uid); setNotes((all) => [copy, ...all]); setActiveId(copy.id); setShowTrash(false);
    setElapsed(latestNoteTime(copy)); setNoteMenu(false); setSaveState("saving");
    showNotice("Note duplicated. Audio stays with the original note.");
  };

  const trashNote = (id = activeId) => {
    if (recordingBusy || generation || transcribing || transcriptDraft?.noteId === id) { showNotice("Finish or discard the transcript draft before moving this note to Trash."); return; }
    const remaining = notes.find((note) => note.id !== id && !note.deletedAt);
    setNotes((all) => all.map((note) => note.id === id ? { ...note, deletedAt: Date.now(), updatedAt: Date.now() } : note));
    if (remaining) { setActiveId(remaining.id); setElapsed(latestNoteTime(remaining)); }
    else setDashboard(true);
    setNoteMenu(false); setSaveState("saving");
    showNotice("Note moved to Trash"); setUndoTrashId(id);
  };

  const restoreNote = (id: string) => {
    const restored = notes.find((note) => note.id === id);
    if (restored) setElapsed(latestNoteTime(restored));
    setNotes((all) => all.map((note) => note.id === id ? { ...note, deletedAt: undefined, updatedAt: Date.now() } : note));
    setSaveState("saving"); setShowTrash(false); setActiveId(id); showNotice("Note restored");
  };

  // Development-only buttons exercise the real import handlers without an OS file picker.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !qaRef.current) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== "notto-development-test") return;
      if (event.data.action === "import-audio") void handleFileImport(qaRef.current!.sampleAudio());
      if (event.data.action === "restore-backup") void handleFileImport(qaRef.current!.sampleBackup());
      if (event.data.action === "drop-audio" || event.data.action === "drop-invalid" || event.data.action === "show-drop") {
        const transfer = new DataTransfer();
        transfer.items.add(event.data.action === "drop-invalid" ? new File(["not audio"], "image.png", { type: "image/png" }) : qaRef.current!.sampleAudio());
        shellRef.current?.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
        if (event.data.action !== "show-drop") shellRef.current?.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
      }
      if (event.data.action === "invalid-backup") void importBackup(new File(["{broken"], "invalid.json", { type: "application/json" }));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  // Import handlers must use this render's note and recording state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, activeId, active?.deletedAt, recordingBusy, generation, transcribing]);

  useEffect(() => {
    if (!mounted || autoConnectRef.current || !apiKey.trim()) return;
    autoConnectRef.current = true;
    void refreshModels(false);
  // A saved key is verified once after hydration; subsequent checks are explicit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  useEffect(() => {
    if (focusChunkRef.current && tab === "transcript") {
      focusChunkRef.current = false;
      newestChunkRef.current?.focus();
    }
  }, [active?.chunks.length, tab]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isMobile || !sidebarOpen || settingsOpen) return;
    const panel = sidebarRef.current;
    const menu = mobileMenuRef.current;
    const workspace = shellRef.current?.querySelector<HTMLElement>(".workspace");
    if (workspace) workspace.inert = true;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSidebarOpen(false); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      if (workspace) workspace.inert = false;
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKey);
      menu?.focus();
    };
  }, [isMobile, sidebarOpen, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const panel = settingsPanelRef.current;
    const menu = mobileMenuRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(shellRef.current?.children ?? []).filter((element) => !element.classList.contains("settings-overlay") && !element.classList.contains("toast")) as HTMLElement[];
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSettingsOpen(false); }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]'));
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      background.forEach((element, index) => { element.inert = previousInert[index]; });
      document.body.style.overflow = oldOverflow;
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus();
      else menu?.focus();
    };
  }, [settingsOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (settingsOpen || event.isComposing) return;
      if (event.key === "Escape") { setDragging(false); dragDepth.current = 0; setSidebarOpen(false); setSummaryMenu(false); setNoteMenu(false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSidebarOpen(true); setPreferences((current) => ({ ...current, collapsed: false })); requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.altKey && event.key.toLowerCase() === "n" && !recordingBusy) { event.preventDefault(); createNote(); }
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element)?.closest(".summary-actions")) setSummaryMenu(false);
      if (!(event.target as Element)?.closest(".note-actions")) setNoteMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", outside); };
  // Handlers use the current recording and note context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, recordingBusy, activeId]);

  const filteredNotes = useMemo(() => notes.filter((note) => Boolean(note.deletedAt) === showTrash && `${note.title} ${note.chunks.map((chunk) => chunk.text).join(" ")} ${note.typedNotes.map((item) => item.text).join(" ")} ${note.summaries.map((item) => item.source).join(" ")}`.toLowerCase().includes(deferredSearch.trim().toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt), [notes, deferredSearch, showTrash]);

  if (!mounted || !active) return <main className="loading-screen" role="status">Opening Notto…</main>;

  const typedComposer = <div className="typed-strip">
    <div className="composer-label"><strong>Capture a thought</strong><time>{formatTime(typedAt ?? elapsed)}</time><small>Ctrl / ⌘ + Enter to add</small></div>
    <div className="composer-field"><textarea ref={typedInputRef} aria-label="Add a typed note" rows={2} value={typedDraft} onChange={(event) => updateActive((note) => ({ ...note, draftText: event.target.value, draftAt: note.draftAt ?? elapsed }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); saveTypedNote(); } }} placeholder="A question, idea, or point to remember…"/><button disabled={!typedDraft.trim() || Boolean(active.deletedAt)} onClick={saveTypedNote}><Icon name="plus" size={16}/> Add note</button></div>
  </div>;

  return (
    <main ref={shellRef} data-palette={preferences.palette} className={`app-shell ${dark ? "dark" : ""} ${preferences.collapsed ? "sidebar-collapsed" : ""}`} onDragEnd={() => { dragDepth.current = 0; setDragging(false); }} onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = recordingBusy || importing ? "none" : "copy"; } }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); const files = Array.from(event.dataTransfer.files); if (files.length !== 1) { showNotice("Drop one audio file or notebook backup at a time."); return; } void handleFileImport(files[0]); }}>
      {dragging && <div className="drop-overlay" aria-live="polite"><div><span>↥</span><h2>{recordingBusy ? "Finish recording first" : "Drop it into your notebook"}</h2><p>One audio file or Notto .json backup</p></div></div>}
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside ref={sidebarRef} id="notes-sidebar" inert={isMobile ? !sidebarOpen : preferences.collapsed} role={isMobile && sidebarOpen ? "dialog" : undefined} aria-modal={isMobile && sidebarOpen ? true : undefined} aria-label="Notes navigation" className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row"><div className="brand-mark">N</div><span>Notto</span><span className="local-pill">local</span><button className="collapse-sidebar" aria-label="Collapse sidebar" onClick={() => { setPreferences((current) => ({ ...current, collapsed: true })); requestAnimationFrame(() => shellRef.current?.querySelector<HTMLButtonElement>(".expand-sidebar")?.focus()); }}>‹</button><button className="drawer-close" aria-label="Close notes navigation" onClick={() => setSidebarOpen(false)}>×</button></div>
        <button className="new-note" disabled={recordingBusy} title={recordingBusy ? "Stop recording before creating another note" : "New note (Alt+N)"} onClick={createNote}><Icon name="plus" /> New note <kbd>Alt N</kbd></button>
        <label className="search-box"><Icon name="search" size={16}/><input ref={searchRef} aria-label="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" /></label>
        <button className={`dashboard-nav ${dashboard && !showTrash ? "active" : ""}`} disabled={recordingBusy} onClick={() => { setDashboard(true); setShowTrash(false); setSidebarOpen(false); }}>▦ <span>All notes</span><small>{notes.filter((note) => !note.deletedAt).length}</small></button>
        <p className="sidebar-label">{showTrash ? "TRASH · RESTORE ANYTIME" : "RECENT NOTES"}</p>
        <nav className="note-list" aria-label="Recent notes">
          {filteredNotes.map((note) => (
            <button key={note.id} disabled={recordingBusy && note.id !== activeId} aria-current={note.id === activeId ? "page" : undefined} title={recordingBusy && note.id !== activeId ? "Stop recording before switching notes" : note.title} className={note.id === activeId ? "note-link active" : "note-link"} onClick={() => { setDashboard(false); setActiveId(note.id); setElapsed(latestNoteTime(note)); setSummaryMenu(false); setNoteMenu(false); setSidebarOpen(false); }}>
              <span>{note.title || "Untitled Note"}</span><small>{new Date(note.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</small>
            </button>
          ))}
          {!filteredNotes.length && <p className="search-empty">{search.trim() ? `No notes match “${search}”.` : showTrash ? "Trash is empty." : "No notes yet."}</p>}
        </nav>
        <div className="sidebar-bottom">
          <button disabled={recordingBusy} aria-pressed={showTrash} onClick={() => { setShowTrash((value) => !value); setDashboard(true); setSidebarOpen(false); }}><Icon name="trash" size={17}/>{showTrash ? "Back to notes" : `Trash${notes.some((note) => note.deletedAt) ? ` (${notes.filter((note) => note.deletedAt).length})` : ""}`}</button>
          <button onClick={() => { setDark((v) => !v); try { localStorage.setItem(notebookStorageKey("notto-theme"), dark ? "light" : "dark"); } catch { showNotice("Theme changed for this tab; it could not be saved."); } }}><Icon name="moon" size={17}/> {dark ? "Light mode" : "Dark mode"}</button>
          <button onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }}><Icon name="settings" size={17}/> Settings</button>
          <p role="status"><span className={`save-dot ${saveState}`}/>{saveState === "saved" ? "Saved on this device" : saveState === "saving" ? "Saving…" : "Not saved · export your work"}</p>
        </div>
      </aside>

      <section className="workspace">
        {!dashboard && <h1 className="sr-only">{active.title || "Untitled Note"}</h1>}
        <header className="topbar">
          <button ref={mobileMenuRef} className="mobile-menu" aria-controls="notes-sidebar" aria-expanded={sidebarOpen} aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Icon name="menu"/></button>
          <button className="expand-sidebar" aria-label="Expand sidebar" onClick={() => setPreferences((current) => ({ ...current, collapsed: false }))}><Icon name="menu"/></button>
          <div className="breadcrumbs"><button disabled={recordingBusy} onClick={() => { setDashboard(true); setShowTrash(false); }}>My notes</button>{!dashboard && <><b>/</b><strong>{active.title}</strong></>}</div>
          <div className="top-actions">
            <label className={`import-button ${recordingBusy ? "disabled" : ""}`}><Icon name="upload" size={16}/> Import audio<input type="file" accept="audio/*" aria-label="Import audio" disabled={recordingBusy} onChange={(e) => { if (e.target.files?.[0]) void handleFileImport(e.target.files[0]); e.target.value = ""; }} /></label>
            {!dashboard && <button aria-label="Catch me up" className="catch-up" disabled={aiStatus.state !== "connected" || Boolean(generation)} title={aiStatus.state === "connected" ? modelSelection === "recommended" ? "Use the recommended model for this source" : `Generate with ${selectedModel}` : "Connect Gemini in Settings"} onClick={() => generateSummary("quick")}><Icon name="sparkle" size={16}/> {generation?.mode === "quick" ? "Generating…" : "Catch me up"}</button>}
            {!dashboard && <div className="note-actions"><button className="note-menu-trigger" aria-label="Note actions" aria-expanded={noteMenu} aria-controls="note-actions-menu" onClick={() => setNoteMenu((value) => !value)}>•••</button>{noteMenu && <div className="summary-menu note-menu" id="note-actions-menu"><button onClick={() => { updateActive((note) => ({ ...note, title: suggestedTitle(note), titleMode: "auto" })); setNoteMenu(false); showNotice("Title generated from this note"); }}><strong>Auto-name from content</strong><small>Suggest a title without sending data</small></button><button onClick={() => { setNoteMenu(false); titleRef.current?.focus(); }}><strong>Rename manually</strong><small>Choose your own title</small></button><button disabled={recordingBusy} onClick={copyNote}><strong>Duplicate note</strong><small>Copy text, notes, and summaries</small></button><button disabled={recordingBusy || Boolean(generation)} onClick={active.deletedAt ? () => restoreNote(active.id) : () => trashNote()}><strong>{active.deletedAt ? "Restore note" : "Move to Trash"}</strong><small>Your note and audio can be restored</small></button></div>}</div>}
          </div>
        </header>

        {dashboard && storageError && <div className="storage-error" role="alert">{storageError}<button onClick={downloadBackup}>Back up this tab</button><button onClick={() => setDashboard(false)}>Open recovery options</button></div>}
        {dashboard ? <NotebookDashboard saveLabel={saveState === "saved" ? "saved on this device" : saveState === "saving" ? "saving…" : "not saved — export your work"} notes={notes} trash={showTrash} busy={recordingBusy || Boolean(generation) || transcribing || importing} open={(note) => { setActiveId(note.id); setElapsed(latestNoteTime(note)); setDashboard(false); setTab("transcript"); }} create={createNote} moveToTrash={trashNote} restore={restoreNote} pin={(id) => setNotes((all) => all.map((note) => note.id === id ? { ...note, pinned: !note.pinned } : note))} importFile={(file) => void handleFileImport(file)} showTrash={setShowTrash}/> : <div className="document-wrap">
          <div className="document-head">
            <div className="eyebrow"><span className={recordingState === "recording" ? "status-dot live" : "status-dot"}/>{recordingState === "recording" ? "Recording in progress" : "Lecture note"}<span>•</span><span>{new Date(active.createdAt).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</span></div>
            <textarea ref={titleRef} className="title-input" rows={1} value={active.title} aria-label="Note title" onChange={(e) => updateActive((note) => ({ ...note, title: e.target.value.replace(/\n/g, " "), titleMode: "manual" }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }}/>
            <p className="document-meta">{countLabel(active.chunks.length, "transcript chunk")} · {countLabel(active.typedNotes.length, "typed note")} · {saveState === "saved" ? "saved" : saveState === "saving" ? "saving…" : "not saved"}</p>
          </div>

          {active.deletedAt && <div className="storage-error">This note is in Trash.<button onClick={() => restoreNote(active.id)}>Restore note</button></div>}
          {storageError && <div className="storage-error" role="alert">{storageError}<div className="recovery-actions"><button onClick={downloadBackup}>Back up this tab</button>{storageConflict ? <button disabled={recordingBusy || Boolean(generation)} onClick={loadLatestNotebook}>Load latest notebook</button> : <button onClick={recoverStorage}>Keep original & enable saving</button>}</div></div>}
          {generation && pendingSource?.noteId !== active.id && <div className="generation-state" role="status"><span className="spinner"/><div><strong>{generation.label}</strong><p>Working on {pendingSource?.noteTitle || "another note"}.</p></div><button disabled={recordingBusy} onClick={() => { if (pendingSource) setActiveId(pendingSource.noteId); setTab("summaries"); }}>View note</button><button onClick={() => generationControllerRef.current?.abort()}>Cancel</button></div>}
          {recordingBusy && <div className={`capture-stage ${recordingState}`}><div className="capture-stage-icon"><Icon name="mic" size={24}/></div><div className="capture-stage-copy"><strong>{recordingState === "paused" ? "Take your time. We’re paused." : recordingState === "stopping" ? "Saving your recording…" : startingRecording ? "Waiting for microphone access…" : "Recording your lecture"}</strong><span>{preferences.liveService === "off" ? "Audio-only · add your own notes" : transcriptionState === "listening" ? "Live transcription is listening" : "Audio capture · speech status below"}</span></div><div ref={waveformRef} className={`waveform ${recordingState === "recording" ? "active" : ""}`} aria-label="Live microphone level">{Array.from({ length: WAVE_BARS }, (_, index) => <i key={index} style={{ height: 4 }}/>)}</div><span className="capture-badge">{recordingState === "recording" ? "LIVE" : recordingState === "paused" ? "PAUSED" : startingRecording ? "WAITING" : "SAVING"}</span></div>}
          <div className="tabs" role="tablist" aria-label="Note views">
            {(["transcript", "notes", "summaries", "export"] as const).map((item) => <button key={item} role="tab" id={`tab-${item}`} aria-label={item === "notes" ? "Typed notes" : item} aria-controls="note-panel" tabIndex={tab === item ? 0 : -1} aria-selected={tab === item} className={tab === item ? "active" : ""} onKeyDown={(event) => { const items = ["transcript", "notes", "summaries", "export"] as const; const index = items.indexOf(item); const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1; if (next >= 0) { event.preventDefault(); setTab(items[next]); document.getElementById(`tab-${items[next]}`)?.focus(); } }} onClick={() => { setTab(item); setSummaryMenu(false); }}>{item === "notes" ? <><span className="wide-tab">Typed notes</span><span className="compact-tab">Notes</span></> : item}</button>)}
          </div>

          <div className="tab-content" id="note-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "transcript" && (
              <section className="transcript-section">
                <div className="section-heading"><div><h2>Transcript</h2><p>Capture speech or paste text, then edit any section</p></div><div className="transcript-tools"><button disabled={recordingBusy || Boolean(active.deletedAt)} onClick={addTranscriptChunk}><Icon name="plus" size={14}/> Add chunk</button><span className="language-pill">{LANGUAGES[settings.language as keyof typeof LANGUAGES]}</span></div></div>
                {transcriptError && <div className="audio-error" role="alert">{transcriptError}<button className="secondary-action" onClick={() => setTranscriptError("")}>Dismiss</button></div>}
                {transcriptDraft?.noteId === active.id && <section className="transcription-review"><div><h3>Review your transcript</h3><p>{countLabel(transcriptDraft.segments.length, "segment")} · {transcriptDraft.model}{transcriptDraft.fallback ? " · fallback used" : ""} · appending keeps your existing text</p></div><div className="transcription-review-text">{transcriptDraft.segments.map((segment, index) => <label key={index}><time>{rangeLabel(segment.start + transcriptDraft.offset, segment.end + transcriptDraft.offset)}</time><textarea aria-label={`Transcription draft segment ${index + 1}`} value={segment.text} onChange={(event) => setTranscriptDraft((current) => current ? { ...current, segments: current.segments.map((item, i) => i === index ? { ...item, text: event.target.value } : item) } : null)}/></label>)}</div><div className="ai-button-row"><button className="summary-button" disabled={Boolean(active.deletedAt) || !transcriptDraft.segments.some((item) => item.text.trim())} onClick={() => { const draft = transcriptDraft; updateActive((note) => ({ ...note, chunks: [...note.chunks, ...draft.segments.filter((item) => item.text.trim()).map((item) => ({ ...item, id: uid(), start: item.start + draft.offset, end: item.end + draft.offset }))].sort((a, b) => a.start - b.start) }), true); setTranscriptDraft(null); showNotice("Reviewed transcript added. Existing text was kept."); }}>Add to transcript</button><button className="secondary-action" onClick={() => setTranscriptDraft(null)}>Discard draft</button></div></section>}
                {audioError && <div className="audio-error" role="alert">{audioError}</div>}
                {audioSessions.length > 0 && !recordingBusy && <div className="transcribe-controls"><div><strong>Transcribe saved audio</strong><p>Send this session to Gemini · up to 12 MB and 20 minutes · review before adding</p></div>{transcribing ? <button className="secondary-action" onClick={() => transcriptionControllerRef.current?.abort()}>Cancel transcription</button> : <button className="secondary-action" disabled={recordingBusy || audioLoading || !selectedAudioId || Boolean(transcriptDraft) || Boolean(active.deletedAt)} onClick={() => void runTranscription()}>{aiStatus.state === "connected" ? "Transcribe with Gemini" : "Connect Gemini"}</button>}{transcribing && <p role="status"><span className="spinner"/> {transcriptionProgress}</p>}</div>}
                {audioSessions.length > 0 && <div className="audio-import-panel"><div className="audio-session-heading"><Icon name="mic" size={18}/><span><strong>Audio sessions</strong><small>{audioSessions.length} {audioSessions.length === 1 ? "session" : "sessions"} · {ephemeralAudioIds.includes(selectedAudioId) ? "download before leaving" : selectedAudio?.status === "interrupted" ? "interrupted session recovered" : "saved on this device"}</small></span></div><select aria-label="Audio session" value={selectedAudioId} onChange={(event) => { setSelectedAudioId(event.target.value); setAudioError(""); }}>{audioSessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {new Date(session.createdAt).toLocaleString()}</option>)}</select>{audioLoading ? <p role="status">Opening audio…</p> : audioURL && <audio ref={audioRef} aria-label="Recorded audio" controls preload="metadata" src={audioURL} onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = playbackSpeed; }} onError={() => setAudioError("This browser could not play the selected audio. Download the file or try another browser.")}/>}<div className="audio-actions"><label>Speed<select aria-label="Playback speed" value={playbackSpeed} onChange={(event) => { const speed = Number(event.target.value); setPlaybackSpeed(speed); if (audioRef.current) audioRef.current.playbackRate = speed; }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>{audioURL && <a href={audioURL} download={`${safeFilename(active.title)}-${selectedAudioId}.${audioExtension(selectedAudio?.mimeType ?? "")}`}>Download audio</a>}</div><p>Imported audio stays separate from your text. Play it while adding or correcting transcript sections.</p></div>}
                {recordingBusy && <div className="capture-feedback" role="status"><span className="connection-dot"/><span>{recordingState === "paused" ? "Audio is paused. Your notes still save as you type." : recordingState === "stopping" ? "Finishing the audio file…" : recordingState === "recording" && preferences.liveService === "off" ? "Microphone is recording · live transcription is off" : transcriptionState === "listening" ? "Microphone is recording · live transcription is listening" : transcriptionState === "blocked" || transcriptionState === "unavailable" ? "Audio is recording · live transcription is unavailable. You can keep adding typed notes." : "Preparing your recording…"}</span></div>}
                <div className="transcript-body">
                  {!active.chunks.length && !interim && <div className="empty-state"><div className="empty-icon"><Icon name="mic" size={24}/></div><h3>Make room for your next idea</h3><p>Start recording a lecture, add a transcript section, or capture a thought below. Your text saves automatically.</p><button className="secondary-action" disabled={recordingBusy || Boolean(active.deletedAt)} onClick={addTranscriptChunk}>Paste transcript text</button></div>}
                  {active.chunks.map((chunk) => <div className="transcript-row" key={chunk.id}><time>{audioURL && selectedAudio ? <button className="timestamp-button" title="Jump to this time in the selected recording" onClick={() => { if (!audioRef.current) return; const point = chunk.start - (selectedAudio.offset ?? 0); const duration = selectedAudio.duration || (Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 0); if (point < 0 || (duration > 0 && point > duration)) { showNotice("Choose the audio session that contains this time."); return; } audioRef.current.currentTime = point; void audioRef.current.play().catch(() => showNotice("Press play on the audio player to continue.")); }}>{rangeLabel(chunk.start, chunk.end)}</button> : rangeLabel(chunk.start, chunk.end)}</time><textarea ref={chunk.id === active.chunks.at(-1)?.id ? newestChunkRef : undefined} rows={3} placeholder="Paste or correct this part of the transcript…" aria-label={`Transcript ${rangeLabel(chunk.start, chunk.end)}`} value={chunk.text} onBlur={() => updateActive((note) => note, true)} onChange={(e) => updateActive((note) => ({ ...note, chunks: note.chunks.map((item) => item.id === chunk.id ? { ...item, text: e.target.value } : item) }))}/></div>)}
                  {interim && <div className="transcript-row appearing"><time>{rangeLabel(interimStart, elapsed)}</time><p className="interim-text">{interim}<span className="caret"/></p></div>}
                </div>
                {typedComposer}
              </section>
            )}
            {tab !== "transcript" && <WorkspaceTab key={active.id} composer={typedComposer} tab={tab} note={active} updateActive={updateActive} showNotice={showNotice} summaryMenu={summaryMenu} setSummaryMenu={setSummaryMenu} generateSummary={generateSummary} aiReady={aiStatus.state === "connected" && !active.deletedAt} selectedModel={modelSelection === "recommended" ? "recommended models, chosen for each task" : selectedModel} generation={pendingSource?.noteId === active.id ? generation : null} generationError={pendingSource?.noteId === active.id ? generationError : ""} pendingSource={pendingSource?.noteId === active.id ? pendingSource : null} generationBusy={Boolean(generation)} retryGeneration={() => pendingSource && void runGeneration(pendingSource, pendingRegeneratedFrom)} cancelGeneration={() => generationControllerRef.current?.abort()} openAISettings={() => { setSettingsSection("ai"); setSettingsOpen(true); }} />}
          </div>
        </div>}

        {!dashboard && <div className="recording-dock" aria-label="Recording controls">
          <div className="dock-status"><span className={recordingState === "recording" ? "big-record-dot pulse" : "big-record-dot"}/><div><strong>{recordingState === "recording" ? "Recording" : recordingState === "paused" ? "Paused" : recordingState === "stopping" ? "Finishing recording" : startingRecording ? "Awaiting microphone" : "Ready to record"}</strong><span>{formatTime(elapsed)}</span></div></div>
          <div className={recordingState === "recording" ? "waveform active" : "waveform"} aria-label={recordingState === "recording" ? "Live microphone level" : "Microphone inactive"}>{Array.from({ length: WAVE_BARS }, (_, index) => <i key={index} style={{ height: 4 }}/>)}</div>
          <div className="dock-controls">
            {recordingState === "idle" && <button className="start-button" disabled={startingRecording || Boolean(active.deletedAt)} onClick={startRecording}><Icon name="mic" size={17}/> {startingRecording ? "Requesting mic…" : "Start recording"}</button>}
            {recordingState === "recording" && <><button className="control-button" onClick={pauseRecording}><Icon name="pause" size={17}/> Pause</button><button className="stop-button" onClick={stopRecording}><Icon name="stop" size={15}/> Stop</button></>}
            {recordingState === "stopping" && <button className="control-button" disabled>Saving audio…</button>}
            {recordingState === "paused" && <><button className="start-button" onClick={resumeRecording}><Icon name="mic" size={17}/> Resume</button><button className="stop-button" onClick={stopRecording}><Icon name="stop" size={15}/> Stop</button></>}
          </div>
        </div>}
      </section>
      {settingsOpen && <div className="settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section ref={settingsPanelRef} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><span>NOTTO PREFERENCES</span><h2 id="settings-title">Settings</h2></div><button aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></header>
          <div className="settings-sections" role="group" aria-label="Settings categories">{(["appearance", "capture", "ai", "data"] as const).map((section) => <button key={section} aria-pressed={settingsSection === section} onClick={() => { setSettingsSection(section); settingsPanelRef.current?.scrollTo({ top: 0 }); }}>{section === "ai" ? "AI" : section === "data" ? "Notebook" : section === "capture" ? "Recording" : "Appearance"}</button>)}</div>
          {settingsSection === "appearance" && <>
          <div className="setting-group"><div><strong>Make it yours</strong><p>A quiet palette for your workspace. Colors adapt to light and dark mode.</p></div><div className="theme-options" role="group" aria-label="Theme color">{THEMES.map((theme) => <button key={theme.id} aria-pressed={preferences.palette === theme.id} onClick={() => setPreferences((current) => ({ ...current, palette: theme.id }))}><span style={{ background: theme.color }}>{preferences.palette === theme.id ? "✓" : ""}</span>{theme.name}</button>)}</div><label className="save-key"><input type="checkbox" checked={dark} onChange={(event) => { setDark(event.target.checked); try { localStorage.setItem(notebookStorageKey("notto-theme"), event.target.checked ? "dark" : "light"); } catch { showNotice("Theme changed for this tab only."); } }}/><span>Dark mode</span></label><label className="save-key"><input type="checkbox" checked={preferences.autoName} onChange={(event) => setPreferences((current) => ({ ...current, autoName: event.target.checked }))}/><span>Automatically name new notes from their content</span></label><p>Typing a title makes it manual. Use Note actions to generate a new title anytime.</p></div>
          </>}
          {settingsSection === "capture" && <>
          <div className="setting-group"><div><strong>Live transcription</strong><p>Choose how to capture your lecture.</p></div><select aria-label="Live transcription service" disabled={recordingBusy} value={preferences.liveService} onChange={(event) => { setPreferences((current) => ({ ...current, liveService: event.target.value as "browser" | "off" })); setServiceCheck(""); }}><option value="browser">Browser speech · live, no API key</option><option value="off">Audio only · no live transcription</option></select><p>{preferences.liveService === "browser" ? "Browser speech support varies. It may send microphone audio to an online speech service; no custom AI prompt is supported." : "Audio is recorded locally. Add typed notes or explicitly send a saved clip to Gemini later."}</p><button className="secondary-action" disabled={recordingBusy} onClick={() => void testCaptureService()}>Test microphone & speech support</button>{serviceCheck && <p className="connection-status" role="status">{serviceCheck}</p>}</div>
          </>}
          {settingsSection === "ai" && <>
          <div className="setting-group ai-settings">
            <div><strong>AI notes</strong><p>Provider: Google Gemini. Recording and editing continue to work without AI.</p></div>
            <label className="field-label">API key</label>
            <div className="key-field"><input aria-label="Gemini API key" type={showApiKey ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="Paste your Google AI Studio key" value={apiKey} onChange={(event) => { modelControllerRef.current?.abort(); setApiKey(event.target.value); setAiStatus({ state: "unconfigured", message: event.target.value.trim() ? "Test the connection to enable AI notes." : "Add a Gemini API key to enable AI notes." }); setModels([]); }}/><button type="button" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? "Hide" : "Show"}</button></div>
            <label className="save-key"><input type="checkbox" checked={saveApiKey} onChange={(event) => setSaveApiKey(event.target.checked)}/><span>Save key on this device</span></label>
            <div className="ai-button-row"><button className="secondary-action" disabled={!apiKey.trim() || aiStatus.state === "checking"} onClick={() => void refreshModels()}>{aiStatus.state === "checking" ? "Testing…" : "Test Connection"}</button><button className="secondary-action" disabled={!apiKey.trim() || aiStatus.state === "checking"} onClick={() => void refreshModels(false)}>Refresh Models</button></div>
            <ModelSettings models={models} selectedModel={selectedModel} selection={modelSelection} autoFallback={autoFallback} transcriptionInstructions={preferences.transcriptionInstructions} busy={Boolean(generation) || transcribing || aiStatus.state === "checking"} onSelection={(value) => { setModelSelection(value); if (value === "recommended") setSelectedModel(defaultModel(models)?.name ?? ""); }} onModel={setSelectedModel} onFallback={setAutoFallback}/>
            <div role="status" className={`connection-status ${aiStatus.state}`}><span className="connection-dot"/>{aiStatus.message}</div>
            <div className="ai-button-row"><button className="clear-key" disabled={!apiKey} onClick={() => { modelControllerRef.current?.abort(); setApiKey(""); setModels([]); setSelectedModel(""); setSaveApiKey(false); try { localStorage.removeItem(notebookStorageKey(AI_KEY_STORAGE)); } catch { showNotice("The saved key could not be cleared. Check browser storage permissions."); } setAiStatus({ state: "unconfigured", message: "API key cleared. AI note generation is unavailable." }); }}>Clear API Key</button><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a Gemini API key ↗</a></div>
            <p className="security-note">Your key is sent directly to Google Gemini. Save it only on a device you trust. Access, usage charges, and limits depend on your Google project.</p>
          </div>
          <div className="setting-group"><div><strong>AI instructions</strong><p>Set the wording and focus you want. These preferences are included in each new request.</p></div><label className="field-label" htmlFor="summary-instructions">Summary preferences</label><textarea id="summary-instructions" className="prompt-input" maxLength={4000} value={preferences.summaryInstructions} placeholder="Example: Use concise bullet points. Highlight exam topics and define technical terms." onChange={(event) => setPreferences((current) => ({ ...current, summaryInstructions: event.target.value }))}/><label className="field-label" htmlFor="transcription-instructions">Gemini Flash transcription preferences</label><textarea id="transcription-instructions" className="prompt-input" maxLength={4000} value={preferences.transcriptionInstructions} placeholder="Example: The lecturer discusses biology. Preserve terms such as mitochondria and ATP. Keep filler words." onChange={(event) => setPreferences((current) => ({ ...current, transcriptionInstructions: event.target.value }))}/><p>Free-form instructions use Gemini Flash. Leave this empty to prefer dedicated speech-to-text in Recommended mode. Accuracy and timestamp rules stay in place.</p><details className="prompt-details"><summary>View transcription request</summary><pre>{transcriptionRequestPreview(modelCandidates(models, "audio", { modelSelection, selectedModel, autoFallback, transcriptionInstructions: preferences.transcriptionInstructions })[0], preferences.transcriptionInstructions, settings.language)}</pre></details><details className="prompt-details"><summary>View summary prompt for this note</summary><pre>{buildGenerationPrompt({ noteId: active.id, noteTitle: active.title, mode: "concise", start: 0, end: latestNoteTime(active), chunks: active.chunks, typedNotes: active.typedNotes, instructions: preferences.summaryInstructions })}</pre></details><button className="secondary-action" onClick={() => setPreferences((current) => ({ ...current, summaryInstructions: "", transcriptionInstructions: "" }))}>Reset custom instructions</button></div>
          </>}
          {settingsSection === "capture" && <>
          <div className="setting-group"><div><strong>Transcript chunk length</strong><p>Larger chunks keep connected ideas together.</p></div><select aria-label="Transcript chunk length" value={settings.chunkSeconds} disabled={recordingState !== "idle"} onChange={(event) => setSettings((current) => ({ ...current, chunkSeconds: Number(event.target.value) }))}><option value={45}>45 seconds</option><option value={60}>60 seconds (recommended)</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select></div>
          <div className="setting-group"><div><strong>Split after silence</strong><p>Wait this long before treating a pause as the end of a chunk.</p></div><select aria-label="Split after silence" value={settings.pauseSeconds} disabled={recordingState !== "idle"} onChange={(event) => setSettings((current) => ({ ...current, pauseSeconds: Number(event.target.value) }))}><option value={0}>Never</option><option value={6}>6 seconds</option><option value={8}>8 seconds (recommended)</option><option value={12}>12 seconds</option><option value={15}>15 seconds</option></select></div>
          <div className="setting-group"><div><strong>Lecture language</strong><p>Used by your browser&apos;s live speech service. It may send microphone audio for online processing.</p></div><select aria-label="Lecture language" value={settings.language} disabled={recordingState !== "idle"} onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value }))}>{Object.entries(LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          </>}
          {settingsSection === "data" && <>
          <div className="setting-group"><div><strong>Your notebook</strong><p>Your notebook and recordings are saved on this device. AI requests send the chosen source to Google. Back up text, summaries, and drafts together; download each audio session from its note.</p></div><div className="ai-button-row"><button className="secondary-action" onClick={downloadBackup}>Back up notebook</button><label className={`backup-import ${recordingBusy || generation ? "disabled" : ""}`}>Restore backup<input type="file" accept=".json,application/json" aria-label="Restore notebook backup" disabled={recordingBusy || Boolean(generation)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.target.value = ""; }}/></label></div><p>Restoring merges notes without overwriting existing work. Backups contain no API keys. Clearing browser data removes locally saved work.</p></div>
          {recoveryBackup && <div className="setting-group"><div><strong>Preserved original data</strong><p>Unreadable notebook data was kept before enabling saving. This recovery file contains the original copies.</p></div><button className="secondary-action" onClick={() => { downloadFile(recoveryBackup, "Notto-original-data-recovery.json"); showNotice("Original recovery data download started"); }}>Download original recovery data</button></div>}
          </>}
          <div className="settings-note"><Icon name="check" size={16}/><span>Preferences save automatically on this device.{recordingState !== "idle" ? " Stop the current recording to change recording settings." : ""}</span></div>
        </section>
      </div>}
      <div className={notice ? "toast" : "toast empty"} role="status" aria-live="polite" aria-atomic="true">{notice && <><span>{notice}</span>{undoTrashId && <button className="toast-undo" onClick={() => restoreNote(undoTrashId)}>Undo</button>}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></>}</div>
    </main>
  );
}

function WorkspaceTab({ tab, note, composer, updateActive, showNotice, summaryMenu, setSummaryMenu, generateSummary, aiReady, selectedModel, generation, generationError, pendingSource, generationBusy, retryGeneration, cancelGeneration, openAISettings }: { tab: "notes" | "summaries" | "export"; note: Note; composer: React.ReactNode; updateActive: (recipe: (note: Note) => Note) => void; showNotice: (message: string) => void; summaryMenu: boolean; setSummaryMenu: (open: boolean) => void; generateSummary: (kind: GenerationMode, options?: { wholeLecture?: boolean; regenerate?: Summary }) => void; aiReady: boolean; selectedModel: string; generation: { mode: GenerationMode; label: string } | null; generationError: string; pendingSource: SourceSnapshot | null; generationBusy: boolean; retryGeneration: () => void; cancelGeneration: () => void; openAISettings: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [selection, setSelection] = useState({ transcript: true, notes: true, draft: true, quick: true, concise: true, study: true, actions: true, timestamps: true, latex: true });
  if (tab === "notes") return <section><div className="section-heading"><div><h2>Typed notes</h2><p>Questions, connections, and things to remember</p></div></div>{note.typedNotes.length ? note.typedNotes.map((item) => <div className="transcript-row" key={item.id}><time>{formatTime(item.time)}</time><textarea rows={3} aria-label={`Typed note at ${formatTime(item.time)}`} value={item.text} onChange={(e) => updateActive((n) => ({ ...n, typedNotes: n.typedNotes.map((x) => x.id === item.id ? { ...x, text: e.target.value } : x) }))}/></div>) : <div className="empty-state compact"><h3>Keep your own perspective</h3><p>Add a question or key idea below. Each thought keeps its place in the lecture.</p></div>}{composer}</section>;
  if (tab === "summaries") return <section>
    <div className="section-heading"><div><h2>Summaries</h2><p>{aiReady ? `AI notes use ${selectedModel}` : "Connect Gemini to generate real AI notes"}</p></div><div className="summary-actions"><button aria-expanded={summaryMenu} aria-controls="generation-options" className="summary-button" disabled={!aiReady || generationBusy} onClick={() => setSummaryMenu(!summaryMenu)}><Icon name="sparkle" size={16}/> {generation ? "Generating…" : "Generate"}</button>{summaryMenu && <div id="generation-options" className="summary-menu"><button onClick={() => generateSummary("quick")}><strong>Catch Me Up · new only</strong><small>Confirmed chunks since the last successful checkpoint</small></button><button onClick={() => generateSummary("quick", { wholeLecture: true })}><strong>Catch Me Up · whole lecture</strong><small>All confirmed chunks through the moment you press the button</small></button><button onClick={() => generateSummary("concise")}><strong>Basic · concise notes</strong><small>Compact lecture notes with only relevant sections and actions</small></button><button onClick={() => generateSummary("study")}><strong>Detailed study guide</strong><small>Thorough, flexible study notes with Markdown and LaTeX</small></button></div>}</div></div>
    {!aiReady && <div className="ai-unavailable"><div><strong>AI note generation is off</strong><p>Add your own Google AI Studio key and test the connection. Transcript recording, editing, and export still work normally.</p></div><button onClick={openAISettings}>Open AI settings</button></div>}
    {generation && <div className="generation-state" role="status"><span className="spinner"/><div><strong>{generation.label}</strong><p>The completed source range is fixed while recording continues.</p></div><button onClick={cancelGeneration}>Cancel</button></div>}
    {generationError && <div className="generation-error" role={/cancelled/i.test(generationError) ? "status" : "alert"}><div><strong>{/cancelled/i.test(generationError) ? "Generation cancelled" : "Generation failed"}</strong><p>{generationError}</p>{pendingSource && <small>Pending range: {rangeLabel(pendingSource.start, pendingSource.end)}</small>}</div><button disabled={!aiReady || generationBusy} onClick={retryGeneration}>Retry</button></div>}
    {note.summaries.length ? <div className="summary-list">{note.summaries.map((summary) => <article className="summary-block" key={summary.id}>
      <header><div className="summary-meta"><div><span className={`summary-kind ${summary.kind}`}>{summary.kind === "quick" ? "Catch Me Up" : summary.kind === "concise" ? "Concise Notes" : summary.kind === "study" ? "Study Guide" : "Action Items"}</span><time>Generated from {rangeLabel(summary.start, summary.end)}</time></div><small>{summary.provider && summary.model ? `${summary.provider} · ${summary.model} · ${new Date(summary.createdAt).toLocaleString()}` : new Date(summary.createdAt).toLocaleString()}{summary.fallbackFrom?.length ? ` · fallback from ${summary.fallbackFrom.join(" → ")}` : ""}{summary.usedMultiStage ? " · multi-stage" : ""}{summary.regeneratedFrom ? " · regenerated version" : ""}</small></div><div className="summary-block-actions">{summary.kind !== "actions" && <button disabled={!aiReady || generationBusy} title={`Uses the currently selected model: ${selectedModel || "none"}`} onClick={() => generateSummary(summary.kind as GenerationMode, { regenerate: summary })}>Regenerate</button>}<button onClick={() => setEditing(editing === summary.id ? null : summary.id)}>{editing === summary.id ? "Preview" : "Edit source"}</button></div></header>
      {editing === summary.id
        ? <textarea aria-label="Edit summary source" className="summary-source" value={summary.source} onChange={(e) => updateActive((n) => ({ ...n, summaries: n.summaries.map((item) => item.id === summary.id ? { ...item, source: e.target.value } : item) }))}/>
        : <Suspense fallback={<p className="summary-loading" role="status">Opening summary…</p>}><SummaryPreview source={summary.source}/></Suspense>
      }
    </article>)}</div> : <div className="empty-state compact"><h3>No summaries yet</h3><p>{aiReady ? "Use Catch Me Up whenever you need a clear checkpoint." : "Your first AI summary will appear here after Gemini is connected."}</p></div>}
  </section>;

  const groups = [
    { key: "transcript", label: "Transcript", detail: countLabel(note.chunks.length, "chunk") },
    { key: "notes", label: "Typed notes", detail: countLabel(note.typedNotes.length, "note") },
    ...(note.draftText?.trim() ? [{ key: "draft" as const, label: "Current thought", detail: "Include the thought you are still writing" }] : []),
    { key: "quick", label: "Catch Me Up", detail: countLabel(note.summaries.filter((s) => s.kind === "quick").length, "block") },
    { key: "concise", label: "Concise notes", detail: countLabel(note.summaries.filter((s) => s.kind === "concise").length, "block") },
    { key: "study", label: "Detailed study guide", detail: countLabel(note.summaries.filter((s) => s.kind === "study").length, "block") },
    ...(note.summaries.some((s) => s.kind === "actions") ? [{ key: "actions" as const, label: "Older action-item blocks", detail: countLabel(note.summaries.filter((s) => s.kind === "actions").length, "block") }] : []),
    { key: "timestamps", label: "Include timestamps", detail: "Time ranges and note times" },
    { key: "latex", label: "Keep LaTeX source", detail: "Preserve $ and $$ notation" },
  ] as const;
  const text = buildNoteExport(note, selection);
  const downloadText = (extension: "txt" | "md") => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${safeFilename(note.title)}.${extension}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); showNotice(`${extension === "md" ? "Markdown" : "Text"} download started`);
  };
  return <section><div className="section-heading"><div><h2>Export note</h2><p>Select exactly what you want to take with you</p></div></div><div className="export-layout"><div className="export-options">{groups.map((group) => <label key={group.key}><input type="checkbox" checked={selection[group.key]} onChange={(e) => setSelection((current) => ({ ...current, [group.key]: e.target.checked }))}/><span className="custom-check">{selection[group.key] && <Icon name="check" size={14}/>}</span><span><strong>{group.label}</strong><small>{group.detail}</small></span></label>)}</div><div className="export-preview"><div className="preview-label">EXPORT PREVIEW</div><pre>{text || "Select a section with content to export."}</pre><div className="export-buttons"><button disabled={!text} onClick={async () => { try { await navigator.clipboard.writeText(text); showNotice("Selected sections copied"); } catch { showNotice("Copy was blocked. Download the text or select it from the preview."); } }}><Icon name="copy" size={16}/> Copy</button><button disabled={!text} onClick={() => downloadText("md")}>.md</button><button disabled={!text} className="download-button" onClick={() => downloadText("txt")}>Download .txt</button></div></div></div></section>;
}
