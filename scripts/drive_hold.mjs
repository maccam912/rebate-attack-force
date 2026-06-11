#!/usr/bin/env node
// Like drive_keys.mjs, but each entry may hold a key: "d:2500" holds KeyD
// for 2500 ms ("r" alone is a tap). Screenshot at the end.
// Usage: node scripts/drive_hold.mjs <urlSubstring> <keys e.g. "r,d:2500"> <out.png> [settleMs]

import { writeFileSync } from "node:fs";

const [match, keysArg, out, settleArg] = process.argv.slice(2);
const settleMs = Number(settleArg ?? 1500);
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
  } else if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    console.log(`[console.${msg.params.type}]`, text.slice(0, 300));
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
await send("Runtime.enable");
const SPECIAL = { enter: ["Enter", "Enter", 13], space: ["Space", " ", 32] };
for (const entry of keysArg.split(",")) {
  const [k, holdArg] = entry.split(":");
  const holdMs = Number(holdArg ?? 80);
  const [code, key, vk] = SPECIAL[k.toLowerCase()] ?? [
    "Key" + k.toUpperCase(),
    k,
    k.toUpperCase().charCodeAt(0),
  ];
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
  await sleep(holdMs);
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });
  await sleep(250);
}
await sleep(settleMs);

const shot = await send("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) {
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot -> ${out}`);
}
ws.close();
process.exit(0);
