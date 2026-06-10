#!/usr/bin/env node
// Headless-Chrome smoke test over the DevTools protocol. No npm deps
// (uses Node >= 21 global fetch/WebSocket).
//
// Usage: node scripts/smoke.mjs <url> <screenshot.png> [waitMs]
// Expects Chrome already running with --remote-debugging-port=9222.

import { writeFileSync } from "node:fs";

const [url, out, waitMsArg] = process.argv.slice(2);
const waitMs = Number(waitMsArg ?? 12000);
const cdp = "http://127.0.0.1:9222";

const tab = await (await fetch(`${cdp}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    logs.push(`[console.${msg.params.type}] ` + msg.params.args.map(a => a.value ?? a.description ?? "").join(" "));
  } else if (msg.method === "Runtime.exceptionThrown") {
    logs.push("[exception] " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  }
};
function send(method, params = {}) {
  return new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
await send("Page.enable");
await new Promise((r) => setTimeout(r, waitMs));

const probe = await send("Runtime.evaluate", {
  expression: `(() => { const c = document.querySelector('canvas');
    return JSON.stringify({ canvas: !!c, w: c?.width ?? 0, h: c?.height ?? 0 }); })()`,
});
console.log("probe:", probe.result?.result?.value);

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot -> ${out}`);
} else {
  console.log("screenshot failed", JSON.stringify(shot).slice(0, 300));
}
for (const l of logs.slice(0, 40)) console.log(l);
ws.close();
process.exit(0);
