import assert from "node:assert/strict";
import test from "node:test";
import { parseNotes } from "../app/note-storage.ts";
const note = { id: "n", title: "Lecture", createdAt: 1, updatedAt: 1, chunks: [{ id: "c", start: 0, end: 60, text: "Lecture" }], typedNotes: [], summaries: [], summarizedThrough: 0 };

test("existing notes and unfinished per-note drafts survive a round trip", () => {
  const notes = [note, { ...note, id: "n2", draftText: "unfinished", draftAt: 45 }];
  assert.deepEqual(parseNotes(JSON.stringify(notes)), notes);
});

test("malformed storage, bad timestamps, and duplicate note IDs are rejected", () => {
  for (const raw of ["null", "{}", "not-json", JSON.stringify([{ ...note, chunks: null }]), JSON.stringify([{ ...note, chunks: [{ id: "c", start: 50, end: 0, text: "bad" }] }]), JSON.stringify([note, note])]) {
    assert.throws(() => parseNotes(raw));
  }
});

test("duplicate block IDs and malformed audio/trash metadata cannot corrupt the notebook",()=>{
  const base={id:'n',title:'Title',createdAt:1,updatedAt:1,chunks:[],typedNotes:[],summaries:[],summarizedThrough:0};
  assert.throws(()=>parseNotes(JSON.stringify([{...base,chunks:[{id:'same',start:0,end:1,text:'a'},{id:'same',start:1,end:2,text:'b'}]}])));
  assert.throws(()=>parseNotes(JSON.stringify([{...base,deletedAt:'yesterday'}])));
  assert.throws(()=>parseNotes(JSON.stringify([{...base,audioName:{bad:true}}])));
  assert.throws(()=>parseNotes(JSON.stringify([{...base,recordedThrough:-1}])));
  assert.throws(()=>parseNotes(JSON.stringify([{...base,id:""}])));
});
