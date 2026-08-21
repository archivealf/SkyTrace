import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const file = path.join(root, "server.js");
let server = fs.readFileSync(file, "utf8");

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`V3.5 server audit could not locate ${label}.`);
  return text.replace(before, after);
}

const oldStatic = `function staticFile(res, pathname) {\n  if (pathname === "/config.json" || pathname === "/config.example.json" || pathname.startsWith("/lib/config")) { res.statusCode = 404; return res.end("Not found"); }\n  let rel = pathname === "/" ? "/index.html" : pathname;\n  rel = decodeURIComponent(rel).replace(/\\.\\./g, "");\n  const fp = path.join(__dirname, rel);\n  if (!fp.startsWith(__dirname)) { res.statusCode = 403; return res.end("Forbidden"); }\n  fs.stat(fp, (err, st) => {\n    if (err || !st.isFile()) {\n      const fallback = path.join(__dirname, "index.html");\n      return fs.readFile(fallback, (e, b) => { if (e) { res.statusCode = 404; return res.end("Not found"); } res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(b); });\n    }\n    const ext = path.extname(fp).toLowerCase(); res.setHeader("Content-Type", mime[ext] || "application/octet-stream");\n    const base = path.basename(fp);\n    if (ext === ".html" || ext === ".css" || ext === ".js" || ext === ".webmanifest" || base.startsWith("service-worker")) {\n      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");\n    } else res.setHeader("Cache-Control", "public,max-age=3600");\n    fs.createReadStream(fp).pipe(res);\n  });\n}`;

const newStatic = `function staticFile(res, pathname) {\n  if (pathname === "/config.json" || pathname === "/config.example.json" || pathname.startsWith("/lib/config")) { res.statusCode = 404; return res.end("Not found"); }\n  let rel = pathname === "/" ? "/index.html" : pathname;\n  try { rel = decodeURIComponent(rel); }\n  catch { res.statusCode = 400; return res.end("Bad request"); }\n  if (rel.includes("\\0")) { res.statusCode = 400; return res.end("Bad request"); }\n  const fp = path.resolve(__dirname, \`.${'${rel}'}\`);\n  if (fp !== __dirname && !fp.startsWith(__dirname + path.sep)) { res.statusCode = 403; return res.end("Forbidden"); }\n  fs.stat(fp, (err, st) => {\n    if (err || !st.isFile()) {\n      const fallback = path.join(__dirname, "index.html");\n      return fs.readFile(fallback, (e, b) => { if (e) { res.statusCode = 404; return res.end("Not found"); } res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(b); });\n    }\n    const ext = path.extname(fp).toLowerCase(); res.setHeader("Content-Type", mime[ext] || "application/octet-stream");\n    const base = path.basename(fp);\n    if (ext === ".html" || ext === ".css" || ext === ".js" || ext === ".webmanifest" || base.startsWith("service-worker")) {\n      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"); res.setHeader("Pragma", "no-cache"); res.setHeader("Expires", "0");\n    } else res.setHeader("Cache-Control", "public,max-age=3600");\n    const stream = fs.createReadStream(fp);\n    stream.on("error", () => { if (!res.headersSent) res.statusCode = 500; if (!res.writableEnded) res.end("Read error"); });\n    stream.pipe(res);\n  });\n}`;
server = replaceRequired(server, oldStatic, newStatic, "safe static file resolver");

const oldRoute = `    if (url.pathname.startsWith("/api/")) { const handled = await api(req, res, url); if (handled !== false) return; }\n    staticFile(res, url.pathname);`;
const newRoute = `    if (url.pathname.startsWith("/api/")) {\n      const handled = await api(req, res, url);\n      if (handled !== false) return;\n      return json(res, 404, { ok: false, error: "Unknown SkyTrace API route." });\n    }\n    staticFile(res, url.pathname);`;
server = replaceRequired(server, oldRoute, newRoute, "unknown API 404 routing");

fs.writeFileSync(file, server);
console.log("Applied V3.5 local-server audit repairs: canonical static-path containment, malformed-path handling, stream errors and JSON 404s for unknown API routes.");
