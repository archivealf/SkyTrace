import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`V3.5 audit repair could not locate ${label}.`);
  return text.replace(before, after);
}

// Expose the existing MapLibre instance to the V3.5 native renderer. This is a
// reference only; the base app remains the owner of map lifecycle/state.
let app = read("app.v3.js");
if (!app.includes("window.__SKYTRACE_MAP__=state.map=new maplibregl.Map(")) {
  app = replaceRequired(
    app,
    "state.map=new maplibregl.Map(",
    "window.__SKYTRACE_MAP__=state.map=new maplibregl.Map(",
    "MapLibre map exposure"
  );
}
write("app.v3.js", app);

// The V3.4 polish layer used a generic `.loading` fallback. That can match
// unrelated component spinners and turn them into a full-screen startup layer.
// Keep startup detection limited to known launch-screen markers.
let polish = read("v3.4-polish.js");
const unsafeStartupSelector = 'document.getElementById("loading") || document.querySelector(".loading, .loading-screen, .startup-screen, [data-loading]")';
const safeStartupSelector = 'document.getElementById("loading") || document.querySelector(".loading-screen, .startup-screen, .skytrace-startup, [data-loading=\\"true\\"]")';
if (polish.includes(unsafeStartupSelector)) {
  polish = polish.replace(unsafeStartupSelector, safeStartupSelector);
}
if (polish.includes('document.querySelector(".loading, .loading-screen')) {
  throw new Error("V3.5 startup polish still contains the unsafe generic .loading selector.");
}
write("v3.4-polish.js", polish);

let main = read("mac-native-main.js");

// Child windows use the same privileged preload as the main app. Prevent them
// from navigating that preload to arbitrary web origins.
if (!main.includes("function hardenChildWindowNavigation")) {
  main = replaceRequired(
    main,
    "function sharedWindowOptions() {",
    `function hardenChildWindowNavigation(window, localUrl) {\n  const allowedOrigin = new URL(localUrl).origin;\n  window.webContents.setWindowOpenHandler(({ url: target }) => {\n    if (/^https:\\/\\//i.test(target)) void shell.openExternal(target);\n    return { action: \"deny\" };\n  });\n  window.webContents.on(\"will-navigate\", (event, target) => {\n    try {\n      if (new URL(target).origin === allowedOrigin) return;\n      event.preventDefault();\n      if (/^https:\\/\\//i.test(target)) void shell.openExternal(target);\n    } catch {\n      event.preventDefault();\n    }\n  });\n}\n\nfunction sharedWindowOptions() {`,
    "child-window navigation guard"
  );
}

if (!main.includes("hardenChildWindowNavigation(state.settingsWindow, url);")) {
  main = replaceRequired(
    main,
    '  state.settingsWindow.once("ready-to-show", () => state.settingsWindow?.show());',
    '  hardenChildWindowNavigation(state.settingsWindow, url);\n  state.settingsWindow.once("ready-to-show", () => state.settingsWindow?.show());',
    "Settings navigation guard"
  );
}

if (!main.includes("hardenChildWindowNavigation(window, url);")) {
  main = replaceRequired(
    main,
    "  state.detachedWindows.add(window);",
    "  hardenChildWindowNavigation(window, url);\n  state.detachedWindows.add(window);",
    "detached-window navigation guard"
  );
}

// Prevent multiple renderer windows from racing append/prune operations and
// cap duplicate samples from high-frequency flight refreshes.
if (!main.includes("replayQueue: Promise.resolve()")) {
  main = replaceRequired(
    main,
    "  lastPruneAt: 0\n};",
    "  lastPruneAt: 0,\n  lastReplayIngestAt: 0,\n  replayQueue: Promise.resolve()\n};",
    "replay serialization state"
  );
}

const oldIngest = `async function ingestReplay(snapshot) {\n  const settings = replaySettings();\n  if (!settings.enabled || !Array.isArray(snapshot?.flights)) return;\n  const recordedAt = Number(snapshot.recordedAt) || Date.now();\n  const lines = snapshot.flights.slice(0, 4000).map(f => compactFlight(f, recordedAt)).filter(Boolean).map(p => JSON.stringify(p));\n  if (!lines.length) return;\n  fs.mkdirSync(path.dirname(state.replayPath), { recursive: true });\n  await fs.promises.appendFile(state.replayPath, \`${'${lines.join("\\n")}'}\\n\`, { encoding: \"utf8\", mode: 0o600 }).catch(() => {});\n  void pruneReplay(false);\n}`;
if (main.includes(oldIngest)) {
  const newIngest = `async function ingestReplay(snapshot) {\n  const settings = replaySettings();\n  if (!settings.enabled || !Array.isArray(snapshot?.flights)) return;\n  const now = Date.now();\n  if (now - state.lastReplayIngestAt < 10_000) return;\n  state.lastReplayIngestAt = now;\n  const requestedAt = Number(snapshot.recordedAt);\n  const recordedAt = Number.isFinite(requestedAt) ? Math.max(now - 300_000, Math.min(now + 60_000, requestedAt)) : now;\n  const lines = snapshot.flights.slice(0, 4000).map(f => compactFlight(f, recordedAt)).filter(Boolean).map(p => JSON.stringify(p));\n  if (!lines.length) return;\n  const writeReplay = async () => {\n    fs.mkdirSync(path.dirname(state.replayPath), { recursive: true });\n    await fs.promises.appendFile(state.replayPath, \`${'${lines.join("\\n")}'}\\n\`, { encoding: \"utf8\", mode: 0o600 });\n    await pruneReplay(false);\n  };\n  state.replayQueue = state.replayQueue.then(writeReplay, writeReplay);\n  await state.replayQueue.catch(() => {});\n}`;
  main = main.replace(oldIngest, newIngest);
}

if (!main.includes("await state.replayQueue.catch(() => {});\n  const settings = replaySettings();")) {
  main = replaceRequired(
    main,
    "async function queryReplay(options = {}) {\n  const settings = replaySettings();",
    "async function queryReplay(options = {}) {\n  await state.replayQueue.catch(() => {});\n  const settings = replaySettings();",
    "replay query serialization"
  );
}
write("mac-native-main.js", main);

console.log("Applied V3.5 audited runtime repairs: safe startup selector, map exposure, privileged child-window navigation guards, replay throttling and replay write serialization.");