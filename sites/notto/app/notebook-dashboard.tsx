"use client";
import { useMemo, useState } from "react";
import type { Note } from "./note-storage";

export function NotebookDashboard({ saveLabel, notes, trash, busy, open, create, moveToTrash, restore, pin, importFile, showTrash }: {
  saveLabel: string; notes: Note[]; trash: boolean; busy: boolean; open: (note: Note) => void; create: () => void;
  moveToTrash: (id: string) => void; restore: (id: string) => void; pin: (id: string) => void;
  importFile: (file: File) => void; showTrash: (value: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const visible = useMemo(() => notes.filter((note) => Boolean(note.deletedAt) === trash && [note.title, ...note.chunks.map((item) => item.text), ...note.typedNotes.map((item) => item.text), ...note.summaries.map((item) => item.source)].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt)), [notes, trash, query, sort]);
  const total = notes.filter((note) => !note.deletedAt).length;
  return <div className="dashboard">
    <header className="dashboard-heading"><div><p className="eyebrow">YOUR PERSONAL NOTEBOOK</p><h1>{trash ? "Trash" : "My notes"}</h1><p>{trash ? "Notes and their recordings stay here until you restore them." : `${total} ${total === 1 ? "note" : "notes"} · ${saveLabel}`}</p></div><button className="summary-button" disabled={busy} onClick={create}>＋ New note</button></header>
    <div className="dashboard-toolbar"><div className="dashboard-filters" aria-label="Notebook filters"><button aria-pressed={!trash} onClick={() => showTrash(false)}>All notes</button><button aria-pressed={trash} onClick={() => showTrash(true)}>Trash <span>{notes.filter((note) => note.deletedAt).length}</span></button></div><input type="search" aria-label="Search notebook" placeholder="Search titles and content…" value={query} onChange={(event) => setQuery(event.target.value)}/><select aria-label="Sort notes" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Recently edited</option><option value="created">Newest first</option><option value="title">Title A–Z</option></select></div>
    {!trash && <label className={`dashboard-import ${busy ? "disabled" : ""}`}><span className="import-glyph">↥</span><span><strong>Bring a recording or notebook</strong><small>Drop audio or a Notto backup anywhere · or choose a file</small></span><input type="file" aria-label="Import audio or notebook" accept="audio/*,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ""; }}/></label>}
    <div className="dashboard-results" role="status">{query ? `${visible.length} ${visible.length === 1 ? "match" : "matches"}` : trash ? `${visible.length} restorable ${visible.length === 1 ? "note" : "notes"}` : "Your notes"}</div>
    <div className="note-grid">{visible.map((note) => <article className="note-card" key={note.id}>
      <button className="note-card-open" disabled={busy} onClick={() => open(note)}><span className="note-card-top"><span className="note-card-icon">{note.pinned ? "✦" : "≡"}</span><time>{new Date(note.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</time></span><h2>{note.title || "Untitled Note"}</h2><p>{note.chunks.find((item) => item.text.trim())?.text || note.typedNotes[0]?.text || note.draftText || (note.audioName ? "Audio ready for listening and transcription." : "A fresh page for your next idea.")}</p><span className="note-card-meta">{note.chunks.length} transcript · {note.typedNotes.length} typed · {note.summaries.length} summaries</span></button>
      <footer>{trash ? <button disabled={busy} onClick={() => restore(note.id)}>↶ Restore</button> : <><button aria-pressed={Boolean(note.pinned)} aria-label={`${note.pinned ? "Unpin" : "Pin"} ${note.title}`} onClick={() => pin(note.id)}>{note.pinned ? "✦ Pinned" : "☆ Pin"}</button><button disabled={busy} aria-label={`Move ${note.title} to Trash`} onClick={() => moveToTrash(note.id)}>Move to Trash</button></>}</footer>
    </article>)}</div>
    {!visible.length && <div className="empty-state dashboard-empty"><span className="empty-glyph">{trash ? "↶" : "⌕"}</span><h2>{query ? "No matching notes" : trash ? "Trash is empty" : "Your notebook starts here"}</h2><p>{query ? "Try another word from the title, transcript, or notes." : trash ? "Notes you move to Trash can be restored here." : "Start a note or drop in a recording."}</p>{query && <button className="secondary-action" onClick={() => setQuery("")}>Clear search</button>}</div>}
  </div>;
}
