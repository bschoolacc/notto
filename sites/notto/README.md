# Notto

Notto is a browser-first personal lecture notetaker. It records microphone audio, keeps editable timestamped transcript chunks and typed notes, and uses a user-configured Google Gemini model to create Catch Me Up checkpoints, Concise Notes, and Detailed Study Guides.

## Core behavior

- Notes, transcripts, typed notes, and AI-generated blocks autosave in browser `localStorage` with no account.
- Microphone audio uses `MediaRecorder`. Live speech uses the browser Web Speech API when available.
- Confirmed speech is chunked at 60 seconds by default or after about 8 seconds of silence. Both thresholds are configurable.
- The recording waveform is driven by the real microphone stream through the Web Audio API.
- Catch Me Up uses only completed chunks after the previous successful checkpoint by default. A separate option covers the whole confirmed lecture so far. In-progress recognition text is never sent.
- All note modes send the timestamped source range and matching typed notes to Gemini. There is no local/template summary fallback.
- Gemini responses are saved as editable versioned blocks with provider, model, generation time, and source range. Regeneration preserves the prior block.
- Generated Markdown and LaTeX render in the Summary tab; their source remains editable.
- Export selections can be copied or downloaded as text. API keys are never included.

## Configure Gemini AI notes

1. Open [Google AI Studio’s API key page](https://aistudio.google.com/apikey), sign in, and create or select a key for a Google project.
2. In Notto, open **Settings → AI** and paste the key.
3. Leave **Save key on this device** off for session-only use, or enable it to keep the key in this browser’s local storage.
4. Press **Test Connection**. Notto calls Gemini’s live Models API and lists only suitable text-generation models available to that key.
5. Choose a model. Notto prefers a stable Gemini Flash model with a large context window when one is available; preview or experimental models are labeled.

The key is not present in source code, logs, notes, or exports. It is sent only to Google’s Gemini API in the `x-goog-api-key` request header. Browser storage is accessible to code running in the app, so a saved key is appropriate only for a trusted personal installation. Use **Clear API Key** to remove it.

Free-tier model access and quotas depend on the Google project and can change. Notto does not claim that every listed model is free. Check the project’s current limits in [Google AI Studio](https://aistudio.google.com/) and Google’s [Gemini rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).

## Generation and long lectures

Notto calls Gemini’s `countTokens` endpoint when possible and compares the source with the selected model’s reported input limit, reserving room for instructions and output. A selected range that fits is sent in one request for global context. Only an oversized range is divided at existing transcript-chunk boundaries; Gemini creates factual intermediate notes and then performs one final synthesis. Source is never silently truncated.

Every mode uses its own complete prompt. Optional headings are flexible and omitted when empty. **Action Items** is the only required section; when none exist the model is instructed to write: “No explicit action items were mentioned.” A response that violates these structural rules is sent back to Gemini for one corrective pass, never repaired with fabricated local content.

Temporary rate limits and service failures receive a small bounded retry. Invalid keys and apparent daily quota exhaustion do not. Failed requests keep the pending source range available for retry and never advance the Catch Me Up checkpoint.

## Troubleshooting

- **Missing or invalid key:** create/copy the key again in AI Studio, clear the old key in Notto, paste the new one, and test the connection.
- **No models:** refresh models. The saved model may have been retired or may not be available to this project.
- **Rate limit:** wait briefly and retry. Requests-per-minute and tokens-per-minute limits are project-specific.
- **Quota reached:** inspect current project usage in AI Studio and wait for the applicable quota reset or use another eligible project/model.
- **Network/provider failure:** recording and text autosave continue. Retry the preserved source range when connectivity returns.
- **Context too large:** choose a listed model with a larger context window. Notto will not discard lecture content to make a request fit.

## Browser limitations

- Chrome desktop is recommended. Browser speech-recognition support varies and may use an online browser service.
- Browser live speech cannot reliably transcribe an uploaded audio element. Imported audio plays locally; the separate **Transcribe** action uses Gemini within the limits described below.
- Recorded audio chunks are committed to IndexedDB in separate sessions. Interrupted sessions can recover committed chunks; recording is stopped if audio cannot be saved. Text uses `localStorage` separately.
- Notes and audio remain on this browser and device. Clearing site data removes them. Notebook JSON backups contain text and metadata; download each audio session separately for an audio backup.
- Long-session reliability depends on browser support, storage quota, and device behavior. Keep the tab open, prevent device sleep, and test before relying on a multi-hour lecture.

## Local development

Install dependencies, run `npm run dev`, and open the local URL. Run `npm run lint`, `npm run build`, or `npm test` before publishing.

## Notebook, appearance, and transcription

- The notes dashboard supports content search, sort, pinning, Trash, restore, and Undo after moving a note to Trash. Audio is retained with its original note.
- Six color palettes work in light and dark mode. The desktop sidebar can collapse; phone navigation uses a focus-managed drawer.
- Drop one audio file (up to 512 MB) or Notto JSON backup (up to 10 MB), or use the file picker. Backups merge rather than replace notes.
- Automatic titles are derived locally from the first content. Editing a title marks it manual. Note actions can suggest a fresh title explicitly.
- Settings has Appearance, Recording, AI, and Notebook categories. Custom AI instructions are bounded to 4,000 characters, saved locally, and included in new provider requests. Exact transcription and current-note summary prompts are inspectable.
- Choose browser live speech or audio-only capture. The microphone diagnostic checks access and feature availability, not provider accuracy. Browser speech may send audio to its own online service.
- Saved-audio Gemini transcription is explicit: it sends the selected audio session and instructions directly to Google. This implementation limits input to 12 MB and 20 minutes, checks output completeness and timestamps, and presents an editable draft before appending. It never replaces existing transcript text. Usage is billed/limited by the user's Google project.
- Production never enables simulated AI. Development QA uses isolated fixtures. Live Gemini transcription accuracy, physical phone microphones, native OS file picking, and three-hour capture require device/provider acceptance testing.

## Development verification

Use Node 22.13+ and npm. Install dependencies with `npm ci`, then run `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run validate:artifact`, and `node --experimental-strip-types --test tests/*.test.mjs`. `/qa` provides isolated responsive and error scenarios only in development and returns 404 in production.
