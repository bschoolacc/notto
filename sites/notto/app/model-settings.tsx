import { isTranscriptionModel, type ProviderModel } from "./ai";
import { modelCandidates, type ModelSelection } from "./model-policy";

export function ModelSettings({ models, selectedModel, selection, autoFallback, busy, transcriptionInstructions, onSelection, onModel, onFallback }: {
  models: ProviderModel[]; selectedModel: string; selection: ModelSelection; autoFallback: boolean; busy: boolean;
  transcriptionInstructions: string;
  onSelection: (value: ModelSelection) => void; onModel: (value: string) => void; onFallback: (value: boolean) => void;
}) {
  const preferences = { modelSelection: selection, selectedModel, autoFallback, transcriptionInstructions };
  const tasks = [
    { task: "notes" as const, label: "Basic & study notes" },
    { task: "quick" as const, label: "Short Catch Me Up" },
    { task: "audio" as const, label: "Saved-audio transcription" },
  ];
  return <>
    <label className="field-label" htmlFor="model-selection">Model selection</label>
    <select id="model-selection" value={selection} disabled={busy} onChange={(event) => onSelection(event.target.value as ModelSelection)}>
      <option value="recommended">Recommended · choose for each task</option>
      <option value="manual">Choose a model manually</option>
    </select>
    {selection === "recommended" ? <>
      <dl className="model-recommendations">{tasks.map(({ task, label }) => <div key={task}><dt>{label}</dt><dd>{modelCandidates(models, task, preferences)[0]?.displayName ?? (models.length ? "No compatible model available" : "Connect to load models")}</dd></div>)}</dl>
      <p>Frequent, short checkpoints favor generous usage limits. Full lectures use the Basic model for more capacity. Saved clips prefer dedicated speech-to-text when available; free-form transcription preferences use Gemini Flash.</p>
    </> : <>
      <label className="field-label" htmlFor="gemini-model">Model</label>
      <select id="gemini-model" value={selectedModel} disabled={!models.length || busy} onChange={(event) => onModel(event.target.value)}>
        <option value="">{models.length ? "Choose a model" : "Test connection to load models"}</option>
        {models.filter((model) => !isTranscriptionModel(model)).map((model) => <option key={model.name} value={model.name}>{model.displayName}{model.name.startsWith("gemma-") ? " · text notes only" : ""}{model.preview ? " · Preview / experimental" : ""}</option>)}
      </select>
      <p>Your saved manual choice is kept. Choose Recommended to let Notto select a model for each task.</p>
    </>}
    <label className="save-key"><input type="checkbox" checked={autoFallback} disabled={busy} onChange={(event) => onFallback(event.target.checked)}/><span>Automatically try a fallback for usage limits or an unavailable model</span></label>
    {models.length > 0 && <details className="model-fallbacks"><summary>Models and fallback order</summary>
      <dl className="model-recommendations">{tasks.map(({ task, label }) => <div key={task}><dt>{label}</dt><dd>{modelCandidates(models, task, preferences).map((model) => model.displayName).join(" → ") || "Choose a compatible model"}</dd></div>)}</dl>
      <p>Up to three models per request. Notto shows switches and saves the model used. Model availability and quotas vary by Google project; these are recommended choices, not a live quota reading. <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Check usage ↗</a></p>
    </details>}
  </>;
}
