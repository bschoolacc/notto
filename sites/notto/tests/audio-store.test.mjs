import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { appendAudioPart, audioExtension, beginAudioSession, finishAudioSession, importAudioSession, listAudioSessions, readAudioSession } from "../app/audio-store.ts";

const session=(id,noteId="note")=>({id,noteId,name:"Lecture",mimeType:"audio/webm",createdAt:Date.now(),duration:0,status:"recording"});
test("committed chunks reconstruct in sequence after reopening the database",async()=>{
  const namespace="qa-audio-roundtrip"; const s=session("one");
  await beginAudioSession(s,namespace);
  await appendAudioPart(s.id,1,new Blob(["world"]),namespace);
  await appendAudioPart(s.id,0,new Blob(["hello "]),namespace);
  await appendAudioPart(s.id,2,new Blob([]),namespace);
  await finishAudioSession(s.id,60,namespace);
  const loaded=await listAudioSessions("note",namespace);
  assert.equal(loaded[0].status,"ready"); assert.equal(loaded[0].duration,60);
  assert.equal(await (await readAudioSession(loaded[0],namespace)).text(),"hello world");
});
test("interrupted recording retains committed chunks for recovery",async()=>{
  const namespace="qa-audio-interrupted"; const s=session("partial");
  await beginAudioSession(s,namespace); await appendAudioPart(s.id,0,new Blob(["captured"]),namespace);
  const [loaded]=await listAudioSessions("note",namespace);
  assert.equal(loaded.status,"interrupted"); assert.equal(await (await readAudioSession(loaded,namespace)).text(),"captured");
});
test("separate recording and import sessions never replace each other or cross notes",async()=>{
  const namespace="qa-audio-multiple"; const a=session("a"); const b={...session("b"),createdAt:a.createdAt+1}; const other=session("other","other-note");
  await importAudioSession(a,new Blob(["first"]),namespace);
  await importAudioSession(b,new Blob(["second"]),namespace);
  await importAudioSession(other,new Blob(["private"]),namespace);
  const loaded=await listAudioSessions("note",namespace);
  assert.deepEqual(loaded.map(s=>s.id),["b","a"]);
  assert.equal(await (await readAudioSession(loaded[1],namespace)).text(),"first");
});
test("a duplicate session aborts atomically and does not replace its audio",async()=>{
  const namespace="qa-audio-transaction"; const s=session("a");
  await importAudioSession(s,new Blob(["original"]),namespace);
  await assert.rejects(()=>importAudioSession(s,new Blob(["replacement"]),namespace));
  assert.equal(await (await readAudioSession(s,namespace)).text(),"original");
});
test("recording extensions match the actual encoder type",()=>{
  assert.equal(audioExtension("audio/mp4"),"m4a"); assert.equal(audioExtension("audio/webm;codecs=opus"),"webm"); assert.equal(audioExtension("audio/mpeg"),"mp3"); assert.equal(audioExtension("audio/wav"),"wav");
});
test("recovery keeps captured duration and finishing stores the actual encoder",async()=>{
  const namespace="qa-audio-duration"; const s={...session("duration"),mimeType:""};
  await beginAudioSession(s,namespace);
  await appendAudioPart(s.id,0,new Blob(["captured"]),namespace,12.5);
  const [interrupted]=await listAudioSessions("note",namespace);
  assert.equal(interrupted.duration,12.5); assert.equal(interrupted.status,"interrupted");
  assert.equal(interrupted.mimeType,"audio/webm");
  await finishAudioSession(s.id,13,namespace,"audio/mp4");
  const [ready]=await listAudioSessions("note",namespace);
  assert.equal(ready.mimeType,"audio/mp4"); assert.equal(ready.duration,13);
});
