import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2]||'.'),serverFile=path.join(root,'server.js'),accountFile=path.join(root,'lib/account.js'),htmlFile=path.join(root,'index.html');
const overlayRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const entitlementSyncSource=path.join(overlayRoot,'v3.3-entitlement-sync.js'),entitlementSyncTarget=path.join(root,'v3.3-entitlement-sync.js');
const airportTrafficSource=path.join(overlayRoot,'v3.4-airport-traffic-fix.js'),airportTrafficTarget=path.join(root,'v3.4-airport-traffic-fix.js');
if(!fs.existsSync(entitlementSyncSource))throw new Error('V3.4 entitlement sync source is missing');
if(!fs.existsSync(airportTrafficSource))throw new Error('V3.4 airport traffic renderer source is missing');
fs.copyFileSync(entitlementSyncSource,entitlementSyncTarget);
fs.copyFileSync(airportTrafficSource,airportTrafficTarget);
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
const codes='<script src="/v3.3-codes.js"></script>';
if(!html.includes('/v3.3-entitlement-sync.js')){
  if(!html.includes(codes))throw new Error('V3.4 could not locate commerce scripts in index.html');
  html=html.replace(codes,`${codes}\n<script src="/v3.3-entitlement-sync.js"></script>`);
}
if(!html.includes('/v3.4-features.js')){
  const sync='<script src="/v3.3-entitlement-sync.js"></script>';
  if(!html.includes(sync))throw new Error('V3.4 could not locate entitlement sync script in index.html');
  html=html.replace(sync,`${sync}\n<script src="/v3.4-features.js"></script>`);
}
if(!html.includes('/v3.4-airport-traffic-fix.js')){
  const features='<script src="/v3.4-features.js"></script>';
  if(!html.includes(features))throw new Error('V3.4 could not locate feature script in index.html');
  html=html.replace(features,`${features}\n<script src="/v3.4-airport-traffic-fix.js"></script>`);
}
fs.writeFileSync(htmlFile,html);
console.log('Applied SkyTrace V3.4 Operations/Replay/Profile feature layer, entitlement sync and observed-airport-traffic renderer.');
