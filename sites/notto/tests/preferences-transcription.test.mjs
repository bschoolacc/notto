import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, autoNameNote, suggestedTitle, classifyImport } from '../app/preferences.ts';
import { parseTranscriptResponse, transcriptionPrompt, transcribeAudio, MAX_TRANSCRIPTION_BYTES } from '../app/transcription.ts';
import { buildGenerationPrompt } from '../app/ai.ts';

const note = { id:'note', title:'Untitled Note', createdAt:1, updatedAt:1, chunks:[{id:'a',start:0,end:30,text:'How spaced repetition helps us learn more effectively.'}], typedNotes:[], summaries:[], summarizedThrough:0 };
const model = { name:'test-model', displayName:'Test', description:'', preview:false, outputTokenLimit:20000 };

test('preferences migrate old settings and reject malformed values', () => {
  assert.equal(parsePreferences(null).palette,'paper');
  assert.equal(parsePreferences('{broken').autoName,true);
  assert.deepEqual(parsePreferences('{"palette":"sage","liveService":"bad","collapsed":true,"summaryInstructions":4}'), { palette:'sage',liveService:'browser',collapsed:true,autoName:true,summaryInstructions:'',transcriptionInstructions:'' });
  assert.equal(parsePreferences(JSON.stringify({transcriptionInstructions:'a'.repeat(5000)})).transcriptionInstructions.length,4000);
});
test('automatic names use content but preserve manual titles and disabled naming', () => {
  assert.equal(autoNameNote(note,true).title,'How spaced repetition helps us learn more effectively');
  assert.equal(autoNameNote({...note,title:'My own title',titleMode:'manual'},true).title,'My own title');
  assert.equal(autoNameNote({...note,title:'',titleMode:'manual'},true).title,'');
  assert.equal(autoNameNote(note,false).title,'Untitled Note');
  assert.equal(suggestedTitle({...note,chunks:[],audioName:'My lecture.wav'}),'My lecture');
});
test('drop classification allows audio or backups and rejects empty, oversize, and disguised files', () => {
  assert.equal(classifyImport({name:'lecture.MP3',type:'',size:2}),'audio');
  assert.equal(classifyImport({name:'backup.json',type:'application/json',size:2}),'backup');
  assert.throws(()=>classifyImport({name:'photo.png',type:'image/png',size:2}));
  assert.throws(()=>classifyImport({name:'sound.wav',type:'',size:0}));
  assert.throws(()=>classifyImport({name:'backup.json',type:'',size:11*1024*1024}));
});
test('custom preferences reach both generation prompts without removing accuracy rules', () => {
  const prompt = buildGenerationPrompt({noteId:'note',noteTitle:'Title',mode:'concise',start:0,end:30,chunks:note.chunks,typedNotes:[],instructions:'Use short paragraphs.'});
  assert.match(prompt,/Use short paragraphs/); assert.match(prompt,/Never invent/);
  assert.match(transcriptionPrompt('Preserve filler words.','en-US'),/Preserve filler words/);
  assert.match(transcriptionPrompt('','en-US'),/JSON only/);
});
test('transcript validation handles silence and rejects bad timestamps before saving', () => {
  assert.deepEqual(parseTranscriptResponse('{"segments":[]}',10),[]);
  assert.deepEqual(parseTranscriptResponse('```json\n{"segments":[{"start":0,"end":1,"text":" Hi "}]}\n```',10),[{start:0,end:1,text:'Hi'}]);
  for(const invalid of ['bad','{}','{"segments":[{"start":-1,"end":1,"text":"a"}]}','{"segments":[{"start":0,"end":15,"text":"a"}]}','{"segments":[{"start":0,"end":1,"text":""}]}']) assert.throws(()=>parseTranscriptResponse(invalid,10));
});
test('Gemini audio request includes real audio and custom prompt, normalizes MIME and checks completion', async () => {
  const original = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, options) => { body=JSON.parse(options.body); return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"segments":[{"start":0,"end":1,"text":"Hello"}]}'}]}}]}); };
  try {
    const result=await transcribeAudio('key',model,new Blob(['abc'],{type:'audio/webm;codecs=opus'}),'Keep names.','en-US',5);
    assert.equal(result[0].text,'Hello');
    assert.equal(body.contents[0].parts[1].inlineData.mimeType,'audio/webm');
    assert.equal(body.contents[0].parts[1].inlineData.data,'YWJj');
    assert.match(body.contents[0].parts[0].text,/Keep names/);
    globalThis.fetch = async () => Response.json({candidates:[{finishReason:'MAX_TOKENS'}]});
    await assert.rejects(transcribeAudio('key',model,new Blob(['abc'],{type:'audio/wav'}),'','en-US',5),/No partial/);
  } finally { globalThis.fetch=original; }
});
test('unsupported, oversized, long, and cancelled audio never reaches the provider', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('unexpected network request');};
  try {
    await assert.rejects(transcribeAudio('key',model,new Blob(['x'],{type:'image/png'}),'','en-US',1),/not supported/);
    await assert.rejects(transcribeAudio('key',model,new Blob([new Uint8Array(MAX_TRANSCRIPTION_BYTES+1)],{type:'audio/wav'}),'','en-US',1),/12 MB/);
    await assert.rejects(transcribeAudio('key',model,new Blob(['x'],{type:'audio/wav'}),'','en-US',1201),/20 minutes/);
    await assert.rejects(transcribeAudio('key',model,new Blob(['x'],{type:'audio/wav'}),'','en-US',1,AbortSignal.abort()),/cancelled/);
  } finally {globalThis.fetch=original;}
});
