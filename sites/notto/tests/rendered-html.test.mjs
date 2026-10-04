import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("development QA routes and fixtures are unavailable in the production app", async()=>{
  const {default:worker}=await import(new URL('../dist/server/index.js',import.meta.url).href);
  const env={ASSETS:{fetch:async()=>new Response('Not found',{status:404})}};
  const ctx={waitUntil(){},passThroughOnException(){}};
  const qa=await worker.fetch(new Request('http://localhost/qa'),env,ctx);
  assert.equal(qa.status,404);
  const home=await worker.fetch(new Request('http://localhost/?qa=demo'),env,ctx);
  const html=await home.text(); assert.equal(home.status,200); assert.ok(!html.includes('development QA')); assert.ok(!html.includes('science of better learning'));
});
