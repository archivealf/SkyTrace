import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] || path.join(sourceRoot, ".."));

function copy(from, to) {
  const source = path.join(sourceRoot, from);
  const target = path.join(root, to);
  if (!fs.existsSync(source)) throw new Error(`Missing V3.5 UI source file: ${from}`);
  fs.copyFileSync(source, target);
}

function syntaxCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
}

copy("renderer/mac-ui-fixes.js", "mac-ui-fixes.js");
copy("renderer/mac-ui-fixes.css", "mac-ui-fixes.css");
syntaxCheck(path.join(root, "mac-ui-fixes.js"));

const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
if (!html.includes('/mac-ui-fixes.css')) {
  if (!html.includes("</head>")) throw new Error("V3.5 UI fix could not locate </head>.");
  html = html.replace("</head>", '  <link rel="stylesheet" href="/mac-ui-fixes.css">\n</head>');
}
if (!html.includes('/mac-ui-fixes.js')) {
  if (!html.includes("</body>")) throw new Error("V3.5 UI fix could not locate </body>.");
  html = html.replace("</body>", '  <script src="/mac-ui-fixes.js"></script>\n</body>');
}
fs.writeFileSync(indexPath, html);

console.log("Applied V3.5 Mac UI fixes: isolated Mac tab activation, visible/narrow native panel, collapsible map controls, compact status HUD, unified freshness and adaptive label density.");
