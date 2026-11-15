/* Timeline integration with real editor UI and controlled local media. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {boot,until}=require('./dom-check.cjs');
const report={environment:'jsdom + real editor UI, controlled local media; no OS/device execution',checks:[],errors:[]};
const plain=v=>JSON.parse(JSON.stringify(v));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let current,exportOptions,pendingExport;
function setup(w,ctx){
 const fixture=fs.readFileSync(path.join(__dirname,'../scripts/fixtures/video.webm'));
 function normalize(s,o={}){const start=Number(o.start??0),end=Number(o.end??60),width=Number(o.width??720);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>s.duration||end-start<0.25||end-start>60)throw Error('Bölüm 0,25–60 saniye olmalı.');return{...o,start,end,duration:end-start,width,height:406};}
 const engine={inspectCapabilities:()=>({supported:true,audioSupported:true,formats:[{id:'webm',label:'WebM',audioSupported:true}]}),
  async open(file){let paused=true;const video=w.document.createElement('video');Object.defineProperty(video,'paused',{get:()=>paused});video.pause=()=>{paused=true;};video.play=async()=>{paused=false;};video.load=()=>{};video.currentTime=0;current={video,width:640,height:360,duration:150,name:file.name,dispose(){this.disposed=true;video.pause();}};return current;},
  normalizeOptions:normalize,draw(canvas,s,o){const n=normalize(s,o);canvas.width=n.width;canvas.height=n.height;return n;},
  async exportClip(s,o){normalize(s,o);exportOptions=o;if(pendingExport)return pendingExport(s,o);return{blob:new w.Blob([fixture],{type:'video/webm'}),dataUrl:'data:video/webm;base64,'+fixture.toString('base64'),mime:'video/webm'};}};
 Object.defineProperty(w,'StudioClip',{get:()=>engine,set(){},configurable:true});
}
function key(w,el,key,options={}){el.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));}
function pointer(w,el,type,x,pointerType='mouse',pointerId=1){const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button:0});Object.defineProperty(e,'pointerId',{value:pointerId});Object.defineProperty(e,'pointerType',{value:pointerType});Object.defineProperty(e,'isPrimary',{value:true});el.dispatchEvent(e);}
function set(app,id,value){const el=app.$(id);el.value=String(value);el.dispatchEvent(new app.w.Event('input',{bubbles:true}));}
function checked(name){report.checks.push(name);console.log('PASS:',name);}
(async()=>{let app;try{
 app=boot({setupWindow:setup});const {w,$,click}=app;await w.StudioApp.ready;const news=plain(w.StudioApp.getProject());click('clipButton');await until(()=>$('clipDialog').open,'clip dialog');
 assert($('clipStartHandle').disabled&&$('clipEndHandle').disabled&&$('clipPlayhead').disabled,'timeline disabled before source');
 app.upload('clipFileInput',Buffer.from('controlled'),'sample.mp4','video/mp4');await until(()=>w.StudioClipUI.getState().hasClip&&!w.StudioClipUI.getState().operation,'clip import');
 const inner=$('clipTimelineInner'),start=$('clipStartHandle'),end=$('clipEndHandle'),head=$('clipPlayhead');inner.getBoundingClientRect=()=>({left:0,right:600,width:600,top:0,bottom:60,height:60});
 assert(!start.disabled&&!end.disabled&&!head.disabled);assert.equal(start.getAttribute('role'),'slider');assert.equal(end.getAttribute('role'),'slider');assert.equal(head.getAttribute('role'),'slider');assert.equal(Number($('clipStart').value),0);assert.equal(Number($('clipEnd').value),60);checked('Valid source enables accessible start, end and playhead on a 150-second timeline');
 pointer(w,start,'pointerdown',0);pointer(w,w.document,'pointermove',120);pointer(w,w.document,'pointerup',120);assert(Math.abs(Number($('clipStart').value)-30)<0.2);assert(Math.abs(current.video.currentTime-30)<0.2,'preview follows the moved start edge');assert.equal(Number(start.getAttribute('aria-valuenow')),Number($('clipStart').value));checked('Pointer drag sets and announces the selected start');
 pointer(w,end,'pointerdown',240);pointer(w,w.document,'pointermove',600);pointer(w,w.document,'pointerup',600);assert(Number($('clipEnd').value)-Number($('clipStart').value)<=60.001,'selection capped at 60 seconds');assert(Number($('clipEnd').value)<=150);assert(Math.abs(current.video.currentTime-Number($('clipEnd').value))<0.2,'preview follows the moved end edge');checked('End drag respects source and one-minute selection bounds');
 key(w,start,'ArrowRight',{shiftKey:true});assert(Number($('clipStart').value)>=30.9);key(w,end,'Home');assert(Number($('clipEnd').value)-Number($('clipStart').value)>=0.249,'range cannot invert');checked('Keyboard controls and extreme keys preserve a valid selection');
 set(app,'clipStart',10);set(app,'clipEnd',25);assert(Math.abs(Number(start.getAttribute('aria-valuenow'))-10)<0.11);assert(Math.abs(Number(end.getAttribute('aria-valuenow'))-25)<0.11);checked('Numeric fields update the same timeline handles');
 pointer(w,inner,'pointerdown',80);pointer(w,w.document,'pointerup',80);assert(Math.abs(current.video.currentTime-20)<0.3);assert(Math.abs(Number(head.getAttribute('aria-valuenow'))-20)<0.3);checked('Track seeking updates preview and announced playhead');
 const initialStart=Number($('clipStart').value),initialEnd=Number($('clipEnd').value),selection=$('clipSelection');pointer(w,selection,'pointerdown',60);pointer(w,w.document,'pointermove',100);pointer(w,w.document,'pointerup',100);assert(Math.abs((Number($('clipEnd').value)-Number($('clipStart').value))-(initialEnd-initialStart))<0.2,'moving range preserves its length');assert(Number($('clipStart').value)>initialStart);assert(Math.abs(current.video.currentTime-Number($('clipStart').value))<0.2,'preview goes to new selection start on release');checked('Dragging selected range moves both edges together');
 set(app,'clipStart',10);set(app,'clipEnd',25);pointer(w,start,'pointerdown',40,'touch',7);pointer(w,w.document,'pointermove',80,'touch',8);assert.equal(Number($('clipStart').value),10,'other finger cannot move active handle');pointer(w,w.document,'pointermove',60,'touch',7);pointer(w,w.document,'pointerup',60,'touch',7);assert(Math.abs(Number($('clipStart').value)-15)<0.2);checked('Touch pointer moves the intended handle and ignores another finger');

 pendingExport=(_s,o)=>new Promise((resolve,reject)=>{o.signal.addEventListener('abort',()=>reject(Object.assign(Error('cancel'),{name:'AbortError'})),{once:true});});click('clipExportButton');await until(()=>w.StudioClipUI.getState().operation==='export','export started');assert(start.disabled&&end.disabled&&head.disabled);assert.equal(exportOptions.start,Number($('clipStart').value));assert.equal(exportOptions.end,Number($('clipEnd').value));click('clipCancelButton');await until(()=>!w.StudioClipUI.getState().operation,'export canceled');assert(!start.disabled&&!end.disabled&&!head.disabled);assert.deepEqual(plain(w.StudioApp.getProject()),news);checked('Export uses selected segment, blocks timeline, and cancel restores editing without changing news project');
 click('clipCloseButton');assert(current.disposed);assert.deepEqual(app.messages,[]);
 }catch(e){report.errors.push(e.stack);console.error(e);process.exitCode=1;}finally{if(app){await wait(50);await app.close();}fs.writeFileSync(path.join(__dirname,'timeline-check-results.json'),JSON.stringify(report,null,2)+'\n');if(!report.errors.length)console.log('All timeline checks passed.');}
})().catch(e=>{console.error(e);process.exitCode=1;});
