import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text);

function replaceIfPresent(text, from, to) {
  return text.includes(from) ? text.replace(from, to) : text;
}

let main = read("mac-native-main.js");
main = replaceIfPresent(main,
  '    path.join(path.dirname(__dirname), "assets", "SkyTrace.png"),',
  '    path.join(__dirname, "assets", "SkyTrace.png"),');
main = replaceIfPresent(main,
  '    if (!force && stat.size < replayLimitBytes() * 0.75 && stat.mtimeMs > cutoff) return;\n',
  '');
write("mac-native-main.js", main);

let server = read("server.js");
server = replaceIfPresent(server,
  '      if (rateLimited(req)) return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });',
  '      if (!globalThis.__SKYTRACE_DESKTOP__ && rateLimited(req)) return json(res, 429, { ok: false, error: "Refreshing too quickly. Wait a moment." });');
write("server.js", server);

let forge = read("forge.config.cjs");
if (!forge.includes('/^\\/src($|\\/)/')) {
  forge = replaceIfPresent(forge,
    '    ignore: [\n      /^\\/out($|\\/)/,',
    '    ignore: [\n      /^\\/src($|\\/)/,\n      /^\\/out($|\\/)/,');
}
write("forge.config.cjs", forge);

console.log("Finalized V3.5 runtime: replay retention, desktop refresh isolation and packaged source exclusions applied.");
