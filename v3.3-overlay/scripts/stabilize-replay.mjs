import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const file = path.join(root, "v3.4-features.js");
let text = fs.readFileSync(file, "utf8");

const oldLoop = "for(const p of state.replay.slice(0,end)){";
const newLoop = "for(let i=0;i<end;i++){const p=state.replay[i];";
if (!text.includes(oldLoop)) throw new Error("Could not locate V3.4 replay redraw loop.");
text = text.replace(oldLoop, newLoop);

const oldPlayback = "function playReplay(){if(state.timer){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play';return}if(!state.replay.length)return toast('Load Replay+ first.');$('replayPlay').textContent='Pause';const speed=Number($('replaySpeed').value)||1;state.timer=setInterval(()=>{state.index++;if(state.index>=state.replay.length){clearInterval(state.timer);state.timer=null;state.index=state.replay.length-1;$('replayPlay').textContent='Play'}$('replayTimeline').value=state.index;drawReplay()},Math.max(30,240/speed))}";
const newPlayback = "function playReplay(){if(state.timer){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play';return}if(!state.replay.length)return toast('Load Replay+ first.');if(state.index>=state.replay.length-1)state.index=0;$('replayTimeline').value=state.index;drawReplay();$('replayPlay').textContent='Pause';const speed=Number($('replaySpeed').value)||1,step=Math.max(1,Math.ceil(state.replay.length/300));state.timer=setInterval(()=>{state.index=Math.min(state.replay.length-1,state.index+step);$('replayTimeline').value=state.index;drawReplay();if(state.index>=state.replay.length-1){clearInterval(state.timer);state.timer=null;$('replayPlay').textContent='Play'}},Math.max(60,300/speed))}";
if (!text.includes(oldPlayback)) throw new Error("Could not locate V3.4 replay playback loop.");
text = text.replace(oldPlayback, newPlayback);

fs.writeFileSync(file, text);
console.log("Applied bounded V3.4 Replay+ rendering and playback stepping.");
