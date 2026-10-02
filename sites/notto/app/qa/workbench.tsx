"use client";
import { useRef, useState } from "react";

export default function QAWorkbench() {
  const [width, setWidth] = useState(390);
  const [scenario, setScenario] = useState("demo");
  const [revision, setRevision] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const test = (action: string) => frame.current?.contentWindow?.postMessage({ type: "notto-development-test", action }, window.location.origin);
  return <main className="qa-workbench">
    <header><strong>Notto · development QA</strong><label>Viewport <select aria-label="QA viewport" value={width} onChange={(event) => setWidth(Number(event.target.value))}><option value={320}>Small phone · 320</option><option value={390}>Phone · 390</option><option value={768}>Tablet · 768</option><option value={960}>Laptop · 960</option><option value={1200}>Desktop · 1200</option></select></label><label>Scenario <select aria-label="QA scenario" value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="demo">Populated notebook</option><option value="empty">Empty notebook</option><option value="slow">Slow AI / cancellation</option><option value="mic-error">Microphone denied</option><option value="storage-error">Corrupt notes</option></select></label><button onClick={() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith(`notto-qa-${scenario}:`)) localStorage.removeItem(key);
      if (scenario === "storage-error") localStorage.setItem(`notto-qa-${scenario}:notto-notes-v1`, "{broken");
      const request = indexedDB.deleteDatabase(`notto-qa-${scenario}:notto-audio-v1`);
      request.onsuccess = () => setRevision((value) => value + 1);
      request.onerror = () => setRevision((value) => value + 1);
    }}>Reset fixture</button><button onClick={() => setRevision((value) => value + 1)}>Reload app</button></header>
    <p>Isolated sample data. Simulated speech and AI; real browser audio encoding and local storage. This page is unavailable in production.</p>
    <header><button onClick={() => test("import-audio")}>Import sample audio</button><button onClick={() => test("drop-audio")}>Drop sample audio</button><button onClick={() => test("drop-invalid")}>Drop invalid file</button><button onClick={() => test("show-drop")}>Preview drop target</button><button onClick={() => test("restore-backup")}>Restore sample backup</button><button onClick={() => test("invalid-backup")}>Try invalid backup</button><button onClick={() => {
      const key = `notto-qa-${scenario}:notto-notes-v1`;
      const notes = JSON.parse(localStorage.getItem(key) || "[]");
      if (notes[0]) { notes[0].title = "Changed in another tab"; notes[0].updatedAt = Date.now(); localStorage.setItem(key, JSON.stringify(notes)); }
    }}>Simulate another tab</button></header>
    <iframe ref={frame} title="Notto QA viewport" key={`${scenario}-${revision}`} src={`/?qa=${scenario}`} style={{ width, height: 844 }}/>
  </main>;
}
