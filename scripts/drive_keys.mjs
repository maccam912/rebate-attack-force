#!/usr/bin/env node
// Attach to an existing tab (by URL substring), send key presses, screenshot.
// Usage: node scripts/drive_keys.mjs <urlSubstring> <keys e.g. "m,r"> <out.png> [settleMs]

import { writeFileSync } from "node:fs";

const [match, keysArg, out, settleArg] = process.argv.slice(2);
const settleMs = Number(settleArg ?? 3000);
const cdp = "http://127.0.0.1:9222";

const tabs = await (await fetch(`${cdp}/json/list`)).json();
const tab = tabs.find((t) => t.url.includes(match));
if (!tab) {
  console.error("no tab matching", match);
  process.exit(1);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  return new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
for (const k of keysArg.split(",")) {
  const code = "Key" + k.toUpperCase();
  const vk = k.toUpperCase().charCodeAt(0);
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
  await sleep(80);
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
  await sleep(400);
}
await sleep(settleMs);

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot -> ${out}`);
}
ws.close();
process.exit(0);
