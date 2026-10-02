import assert from "node:assert/strict";
import test from "node:test";
import { buildNoteExport, duplicateNote, latestNoteTime, makeBackup, mergeBackup, parseBackup, safeFilename, withoutMathDelimiters } from "../app/notebook.ts";
import { formatTime, rangeLabel } from "../app/time.ts";

const note = { id:"lecture", title:"Learning", createdAt:1, updatedAt:2, chunks:[{id:"c",start:0,end:60,text:"A concept costs $5 to demonstrate."}], typedNotes:[{id:"n",time:20,text:"Ask a question"}], summaries:[{id:"s",kind:"quick",start:0,end:60,source:"## Action Items\nReview $x^2$",createdAt:3}], summarizedThrough:60,summarizedTypedIds:["n"],draftText:"A thought in progress",draftAt:42 };
const selection = {transcript:true,notes:true,draft:true,quick:true,concise:true,study:true,actions:true,timestamps:true,latex:true};

test("notebook backup round-trips drafts, checkpoints, summaries, and recoverable trash",()=>{
  const trashed = {...note,id:"trash",deletedAt:9};
  const backup = makeBackup([note,trashed]);
  assert.deepEqual(parseBackup(backup),[note,trashed]);
  assert.ok(!backup.includes("apiKey"));
  assert.throws(()=>parseBackup('{"format":"other","notes":[]}'));
});
test("restore keeps current work, skips identical notes, and copies conflicting notes",()=>{
  let index=0;
  const restored=mergeBackup([note],[note,{...note,title:"Old title"}],()=>`new-${++index}`);
  assert.equal(restored.added,1); assert.equal(restored.notes[0],note);
  assert.equal(restored.notes[1].title,"Old title (imported)");
  assert.notEqual(restored.notes[1].id,note.id);
});
test("duplicating remaps checkpoint IDs and separates audio from the original",()=>{
  let index=0;
  const copy=duplicateNote({...note,audioName:"lecture.webm",deletedAt:9},()=>`new-${++index}`);
  assert.equal(copy.deletedAt,undefined); assert.equal(copy.audioName,undefined);
  assert.equal(copy.summarizedTypedIds[0],copy.typedNotes[0].id);
  assert.notEqual(copy.chunks[0].id,note.chunks[0].id);
  assert.notEqual(copy.summaries[0].id,note.summaries[0].id);
  assert.equal(copy.draftText,note.draftText);
});
test("export preserves currency, separates selections, and protects unsubmitted thoughts",()=>{
  const all=buildNoteExport(note,{...selection,latex:false});
  assert.ok(all.includes("$5")); assert.ok(all.includes("x^2")); assert.ok(!all.includes("$x^2$"));
  assert.ok(all.includes("A thought in progress")); assert.ok(all.includes("[00:00–01:00]"));
  const draft=buildNoteExport(note,{...selection,transcript:false,notes:false,quick:false,timestamps:false});
  assert.ok(draft.includes("Current")===false); assert.ok(draft.includes("thought in progress")); assert.ok(!draft.includes("concept costs"));
  assert.equal(buildNoteExport(note,{...selection,transcript:false,notes:false,draft:false,quick:false}),"");
});
test("math delimiters are removed without eating currency or escaped dollars",()=>{
  assert.equal(withoutMathDelimiters("Costs $5 and $20; use $x+y$ or $$x^2$$; \\$literal."),"Costs $5 and $20; use x+y or x^2; \\$literal.");
});
test("timeline offset uses the maximum end even when blocks are out of order",()=>{
  assert.equal(latestNoteTime({...note,chunks:[{id:"a",start:0,end:500,text:""},{id:"b",start:0,end:30,text:""}],typedNotes:[{id:"n",time:700,text:""},{id:"m",time:20,text:""}]}),700);
  assert.equal(latestNoteTime({...note,recordedThrough:800}),800);
  assert.equal(latestNoteTime({...note,chunks:[],typedNotes:[],recordedThrough:300}),300);
});
test("time labels and filenames handle long lectures and invalid characters",()=>{
  assert.equal(formatTime(10800.9),"03:00:00"); assert.equal(formatTime(-1),"00:00"); assert.equal(formatTime(NaN),"00:00");
  assert.equal(rangeLabel(0,65),"00:00–01:05"); assert.equal(safeFilename('A/B:C?*'),"A_B_C__"); assert.equal(safeFilename("  "),"Notto note");
});
