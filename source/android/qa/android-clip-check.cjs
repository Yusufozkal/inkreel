/* Android clip-editor wiring; media and Java calls are controlled, no device codec execution. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {boot,until}=require('./dom-harness.cjs');
const setupAndroid=require('./android-native-mock.cjs');
const report={environment:'Android adapter/mobile UI in jsdom + Napi Canvas; imported video decoding, encoding and Java SAF host mocked; no Android/WebView device execution',checks:[],errors:[]};
const plain=value=>JSON.parse(JSON.stringify(value));
const errorAbort=()=>Object.assign(Error('QA canceled'),{name:'AbortError'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 let pendingImport=false,pendingExport=false,exportSignal=null,resolveExport=null,saveRequest=null,disposed=0;
 let app,storedCore,failWrites=false;
 const fakeEngine={
  inspectCapabilities:()=>({supported:true,audioSupported:true,formats:[{id:'webm',label:'WebM'},{id:'mp4',label:'MP4'}]}),
  normalizeOptions(session,o){if(!session||!Number.isFinite(o.start)||!Number.isFinite(o.end)||o.start<0||o.end>session.duration||o.end-o.start<.25||o.end-o.start>60)throw Error('Geçerli bir video bölümü seçin.');return{...o,duration:o.end-o.start,width:o.width,height:Math.round(o.width*9/16)};},
  draw(canvas){canvas.width=720;canvas.height=405;const context=canvas.getContext('2d');context.fillStyle='#594a90';context.fillRect(0,0,720,405);},
  open(file,{signal}){return new Promise((resolve,reject)=>{
   if(signal.aborted)return reject(errorAbort());
   if(pendingImport){signal.addEventListener('abort',()=>reject(errorAbort()),{once:true});return;}
   const video=new app.w.EventTarget();video.currentTime=0;video.paused=true;video.volume=1;video.muted=false;video.readyState=2;
   video.pause=()=>{video.paused=true;};video.play=async()=>{video.paused=false;};
   let closed=false;resolve({video,width:1280,height:720,duration:90,name:file.name,dispose(){if(!closed){closed=true;disposed++;video.pause();}}});
  });},
  exportClip(_session,o){exportSignal=o.signal;return new Promise((resolve,reject)=>{
   resolveExport=()=>resolve({mime:'video/webm',blob:new app.w.Blob(['QA output'],{type:'video/webm'}),dataUrl:'data:video/webm;base64,GkXfow=='});
   o.onProgress(.4);
   if(o.signal.aborted)return reject(errorAbort());
   o.signal.addEventListener('abort',()=>reject(errorAbort()),{once:true});
   if(!pendingExport)resolveExport();
  });}
 };
 app=boot({setupWindow(w){Object.defineProperty(w,'StudioClip',{configurable:true,get:()=>fakeEngine,set(){}});Object.defineProperty(w,'StudioCore',{configurable:true,get:()=>storedCore,set(value){storedCore=Object.freeze({...value,openDatabase:async()=>{const db=await value.openDatabase();return{...db,put:async(key,record)=>{if(failWrites)throw Error('QA autosave storage exhausted');return db.put(key,record);}};}});}});},setupNative(w,calls,state){
  const mock=setupAndroid(w,calls,state),request=w.KarevoAndroid.request;
  w.KarevoAndroid.request=(action,payload,id)=>{if(action!=='save-video')return request(action,payload,id);saveRequest={action,payload:JSON.parse(payload),id};calls.push({method:'saveVideo',...saveRequest.payload});};return mock;
 }});
 const {w,$,click,input}=app;
 const project=()=>plain(w.StudioApp.getProject());
 function upload(name='Yerel video.mp4'){
  const file=new w.File(['QA local clip'],name,{type:'video/mp4'});
  Object.defineProperty($('clipFileInput'),'files',{value:[file],configurable:true});
  $('clipFileInput').dispatchEvent(new w.Event('change',{bubbles:true}));
 }
 async function idle(){await until(()=>w.StudioClipUI.getState().operation===''&&$('app').dataset.busy!=='true','clip operation releases editor');}
 function checked(name){report.checks.push(name);console.log('PASS:',name);}
 try{
  await w.StudioMobile.ready;input('headline','Video düzenlenirken korunacak haber');$('headline').blur();const before=project();
  assert(w.StudioClipUI,'Shared video editor loaded');click('mobileMenuButton');click(w.document.querySelector('[data-mobile-action="clip"]'));
  await until(()=>$('clipDialog').open,'phone video menu opens editor');assert(!$('mobileMenuDialog').open);
  upload('<img onerror=alert(1)> Haber.mp4');await until(()=>w.StudioClipUI.getState().hasClip,'local clip import');await idle();
  assert.equal($('clipFileName').textContent,'<img onerror=alert(1)> Haber.mp4');assert.equal($('clipFileName').querySelector('img'),null);
  input('clipStart',5);input('clipEnd',25);input('clipText','Telefondan açıklama');assert.equal($('clipExportButton').disabled,false);assert.deepEqual(project(),before);
  $('clipCloseButton').focus();app.keyboard('d',{ctrlKey:true});
  w.dispatchEvent(new w.CustomEvent('studio-command',{detail:'new'}));
  assert.deepEqual(project(),before,'Main-project shortcuts/commands cannot modify work under an idle video dialog');
  checked('Phone menu opens the local clip editor; plain-text names/options do not change the news project');

  // Exercise the shared timeline with touch-like pointer events on the phone UI.
  const pointer=(target,type,seconds,id=1)=>{const rect=$('clipTimelineInner').getBoundingClientRect(),e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{pointerId:{value:id},pointerType:{value:'touch'},clientX:{value:rect.left+seconds/90*rect.width},clientY:{value:30},button:{value:0}});target.dispatchEvent(e);};
  pointer($('clipStartHandle'),'pointerdown',5);pointer(w.document,'pointermove',10);pointer(w.document,'pointerup',10);
  assert(Math.abs(Number($('clipStart').value)-10)<0.15,'Touch drag changes clip start');
  assert.equal(Number($('clipStartHandle').getAttribute('aria-valuenow')),Number($('clipStart').value));
  pointer($('clipEndHandle'),'pointerdown',25);pointer(w.document,'pointermove',35);pointer(w.document,'pointerup',35);
  assert(Math.abs(Number($('clipEnd').value)-35)<0.15,'Touch drag changes clip end');
  pointer($('clipSelection'),'pointerdown',10);pointer(w.document,'pointermove',15);pointer(w.document,'pointerup',15);
  assert(Math.abs(Number($('clipStart').value)-15)<0.15);assert(Math.abs(Number($('clipEnd').value)-40)<0.15);
  const key=new w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true});$('clipStartHandle').dispatchEvent(key);
  assert.equal(Number($('clipStart').value),16,'Keyboard control adjusts the same start time');
  pointer($('clipTimelineInner'),'pointerdown',50);assert(Math.abs(Number($('clipPlayhead').getAttribute('aria-valuenow'))-50)<0.15,'Touch on the track moves the playhead');
  input('clipStart',89.75);input('clipEnd',90);
  pointer($('clipStartHandle'),'pointerdown',89.75);pointer(w.document,'pointermove',89);pointer(w.document,'pointerup',89);
  assert(Math.abs(Number($('clipStart').value)-89)<0.15,'Separate start grip remains usable for a very short selection');
  assert.deepEqual(project(),before,'Timeline editing preserves the news project');
  input('clipStart',5);input('clipEnd',25);
  checked('Phone timeline supports touch trim, clip movement, seek and keyboard access while preserving the project');

  pendingImport=true;upload('Sonradan seçilen.mp4');await until(()=>w.StudioClipUI.getState().operation==='import','pending clip import');
  assert.equal(w.StudioHandleBack(),true);await idle();assert(w.StudioClipUI.getState().hasClip);assert.equal(w.StudioClipUI.getState().filename,'<img onerror=alert(1)> Haber.mp4');assert.equal(disposed,0);pendingImport=false;
  checked('Android Back cancels a pending import and keeps the previous clip and project');

  click('clipPlayButton');await until(()=>$('clipPlayButton').textContent.includes('Duraklat'),'preview playing');w.dispatchEvent(new w.Event('studio-pause'));assert($('clipPlayButton').textContent.includes('Oynat'));assert(w.StudioClipUI.getState().hasClip);
  pendingExport=true;click('clipExportButton');await until(()=>w.StudioClipUI.getState().operation==='export'&&exportSignal,'recording pending');
  w.dispatchEvent(new w.Event('studio-pause'));await idle();assert(exportSignal.aborted);assert.equal(saveRequest,null);assert(w.StudioClipUI.getState().hasClip);assert.deepEqual(project(),before);
  checked('Android pause stops preview and aborts recording before any native file save');

  click('clipExportButton');await until(()=>w.StudioClipUI.getState().operation==='export'&&!exportSignal.aborted,'second recording');
  assert.equal(w.StudioHandleBack(),true);await idle();assert(exportSignal.aborted);assert(w.StudioClipUI.getState().hasClip);assert.deepEqual(project(),before);
  checked('Android Back aborts recording and releases the shared editor lock without closing the clip');

  failWrites=true;w.dispatchEvent(new w.CustomEvent('studio-before-close',{detail:{requestId:73}}));
  await until(()=>app.calls.some(call=>call.method==='finishClose'&&call.requestId===73),'idle clip failed-close acknowledgment');
  const failedClose=app.calls.find(call=>call.method==='finishClose'&&call.requestId===73);
  assert.equal(failedClose.saved,false);assert(w.StudioClipUI.getState().hasClip);assert.equal($('clipDialog').open,true);assert.deepEqual(project(),before);failWrites=false;
  checked('A refused native close after autosave failure retains the idle clip and its correct request token');

  pendingExport=false;click('clipExportButton');await until(()=>w.StudioClipUI.getState().operation==='save'&&saveRequest,'native video save picker');
  const id=saveRequest.id;assert.match(saveRequest.payload.name,/^[a-z0-9-]+-duzenlendi\.webm$/);assert(saveRequest.payload.dataUrl.startsWith('data:video/webm;base64,'));
  w.dispatchEvent(new w.Event('studio-pause'));assert.equal(w.StudioClipUI.getState().operation,'save','Opening Android SAF is not a canceled recording');assert.equal(w.StudioHandleBack(),true);assert.equal($('app').dataset.busy,'true');
  w.StudioAndroidResult({id,ok:false,canceled:true});await idle();assert(w.StudioClipUI.getState().hasClip);assert.deepEqual(project(),before);
  checked('Native save uses a bounded safe name and survives Activity pause; canceled SAF keeps the clip available');

  saveRequest=null;click('clipExportButton');await until(()=>w.StudioClipUI.getState().operation==='save'&&saveRequest,'native save retry');w.StudioAndroidResult({id:saveRequest.id,ok:true,name:saveRequest.payload.name});await idle();
  assert.equal(w.StudioHandleBack(),true);assert(!$('clipDialog').open);assert.equal(w.StudioClipUI.getState().hasClip,false);assert.equal(disposed,1);assert.equal($('app').dataset.busy,'false');assert.deepEqual(project(),before);
  const csp=w.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;assert.match(csp,/media-src blob:/);assert(!/media-src[^;]*(https?:|data:)/.test(csp));assert.deepEqual(app.messages,[]);
  checked('Save retry and normal Back dispose the clip; Blob-only media policy and news project remain intact');
 }finally{failWrites=false;if(saveRequest)w.StudioAndroidResult({id:saveRequest.id,ok:false,canceled:true});w.StudioClipUI?.dispose();resolveExport?.();await pause(25);await app.close();}
}
main().then(()=>{fs.writeFileSync(path.join(__dirname,'android-clip-check-results.json'),JSON.stringify(report,null,2)+'\n');console.log('All',report.checks.length,'Android clip UI groups passed.');}).catch(error=>{report.errors.push(error.stack);fs.writeFileSync(path.join(__dirname,'android-clip-check-results.json'),JSON.stringify(report,null,2)+'\n');console.error(error);process.exitCode=1;setTimeout(()=>process.exit(1),150).unref();});
