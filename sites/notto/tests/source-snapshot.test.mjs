import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceSnapshot } from "../app/source-snapshot.ts";
const note = { id: "n", title: "Lecture", chunks: [], typedNotes: [{ id: "a", time: 0, text: "First" }], summaries: [], summarizedThrough: 0 };

test("same-second typed notes are included once per successful checkpoint", () => {
  assert.equal(buildSourceSnapshot(note, "quick", 0, undefined, false, true).typedNotes[0].id, "a");
  assert.equal(buildSourceSnapshot({ ...note, summarizedTypedIds: ["a"] }, "quick", 0, undefined, false, true), null);
  const next = buildSourceSnapshot({ ...note, summarizedTypedIds: ["a"], typedNotes: [...note.typedNotes, { id: "b", time: 0, text: "Second" }] }, "quick", 0, undefined, false, true);
  assert.deepEqual(next.typedNotes.map((item) => item.id), ["b"]);
});

test("late-added thoughts retain their capture time without being skipped", () => {
  const next = buildSourceSnapshot({ ...note, summarizedTypedIds: ["a"], typedNotes: [...note.typedNotes, { id: "late", time: 20, text: "Remember this" }] }, "quick", 60, undefined, false, true);
  assert.equal(next.start, 20);
  assert.deepEqual(next.typedNotes.map((item) => item.id), ["late"]);
});
