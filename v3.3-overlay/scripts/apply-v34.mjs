import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.argv[2]||'.'),serverFile=path.join(root,'server.js'),accountFile=path.join(root,'lib/account.js'),htmlFile=path.join(root,'index.html');
let account=fs.readFileSync(accountFile,'utf8');
if(!account.includes('export async function getV34Operations')) account+=`\nexport async function getV34Status(){return remote("/v1/v34/status",{auth:true});}\nexport async function getV34Operations(){return remote("/v1/v34/operations",{auth:true});}\nexport async function getV34Replay(query=""){return remote(\`/v1/v34/replay\${String(query||"")}\`,{auth:true});}\nexport async function getV34AircraftProfile(icao){return remote(\`/v1/v34/aircraft-profile?icao=\${encodeURIComponent(icao||"")}\`,{auth:true});}\nexport async function saveV34AircraftNote(payload){return remote("/v1/v34/aircraft-note",{method:"POST",body:payload,auth:true});}\n`;
fs.writeFileSync(accountFile,account);
let server=fs.readFileSync(serverFile,'utf8');
if(!server.includes('getV34Operations')){
  const marker='  deleteCloudItem, ingestAccountHistory, getAccountHistory, getAccountHistoryExport\n} from "./lib/account.js";';
  if(!server.includes(marker))throw new Error('V3.4 could not locate account import in server.js');
  server=server.replace(marker,'  deleteCloudItem, ingestAccountHistory, getAccountHistory, getAccountHistoryExport,\n  getV34Status, getV34Operations, getV34Replay, getV34AircraftProfile, saveV34AircraftNote\n} from "./lib/account.js";');
}
if(!server.includes('url.pathname === "/api/v34/operations"')){
  const marker='    if (url.pathname === "/api/config") return json(res, 200, {';
  if(!server.includes(marker))throw new Error('V3.4 could not locate API config route in server.js');
  const routes=`    if (url.pathname === "/api/v34/status" && req.method === "GET") return json(res, 200, await getV34Status());\n    if (url.pathname === "/api/v34/operations" && req.method === "GET") return json(res, 200, await getV34Operations());\n    if (url.pathname === "/api/v34/replay" && req.method === "GET") return json(res, 200, await getV34Replay(url.search));\n    if (url.pathname === "/api/v34/aircraft-profile" && req.method === "GET") return json(res, 200, await getV34AircraftProfile(p.get("icao")));\n    if (url.pathname === "/api/v34/aircraft-note" && req.method === "POST") return json(res, 200, await saveV34AircraftNote(await readJsonBody(req)));\n\n`;
  server=server.replace(marker,routes+marker);
}
server=server.replace('accountCloudSync: true, cloudReplay: true, airportIntelligence: true','accountCloudSync: true, cloudReplay: true, airportIntelligence: true, operationsLayer: true, aircraftProfiles: true, globalReplay: true, webApp: true');
fs.writeFileSync(serverFile,server);
let html=fs.readFileSync(htmlFile,'utf8');
if(!html.includes('/v3.4-features.js')){
  const target='<script src="/v3.3-codes.js"></script>';
  if(!html.includes(target))throw new Error('V3.4 could not locate commerce scripts in index.html');
  html=html.replace(target,`${target}\n<script src="/v3.4-features.js"></script>`);
}
fs.writeFileSync(htmlFile,html);
console.log('Applied SkyTrace V3.4 Operations/Replay/Profile feature layer.');