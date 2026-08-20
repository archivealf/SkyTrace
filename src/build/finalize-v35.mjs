import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

function replaceRequiredOrAlready(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`Could not finalize V3.5: missing ${label} patch marker.`);
  return text.replace(from, to);
}

let main = read("mac-native-main.js");
main = replaceRequiredOrAlready(
  main,
  '    path.join(path.dirname(__dirname), "assets", "SkyTrace.png"),',
  '    path.join(__dirname, "assets", "SkyTrace.png"),',
  "tray asset path"
);
main = replaceRequiredOrAlready(
  main,
  '    if (!force && stat.size < replayLimitBytes() * 0.75 && stat.mtimeMs > cutoff) return;\n',
  '',
  "replay retention enforcement"
);
write("mac-native-main.js", main);

let server = read("server.js");
server = replaceRequiredOrAlready(
  server,
  '      if (rateLimited(req)) return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });',
  '      if (!globalThis.__SKYTRACE_DESKTOP__ && rateLimited(req)) return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });',
  "desktop refresh isolation"
);
write("server.js", server);

let forge = read("forge.config.cjs");
if (!forge.includes('/^\\/src($|\\/)/')) {
  const marker = '    ignore: [\n      /^\\/out($|\\/)/,';
  if (!forge.includes(marker)) throw new Error("Could not finalize V3.5: Forge ignore-list marker changed.");
  forge = forge.replace(marker, '    ignore: [\n      /^\\/src($|\\/)/,\n      /^\\/out($|\\/)/,');
}
write("forge.config.cjs", forge);

if (main.includes('path.join(path.dirname(__dirname), "assets", "SkyTrace.png")')) throw new Error("V3.5 tray path finalization did not apply.");
if (main.includes('stat.size < replayLimitBytes() * 0.75 && stat.mtimeMs > cutoff')) throw new Error("V3.5 replay retention shortcut survived finalization.");
if (!server.includes('!globalThis.__SKYTRACE_DESKTOP__ && rateLimited(req)')) throw new Error("V3.5 desktop refresh isolation did not apply.");
if (!forge.includes('/^\\/src($|\\/)/')) throw new Error("V3.5 canonical source exclusion did not apply.");

console.log("Finalized V3.5 runtime with fail-closed tray, replay-retention, desktop-refresh and packaged-source invariants.");
