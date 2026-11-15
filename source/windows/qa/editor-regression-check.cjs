/* Focused regressions for delayed project opening, preparation cancellation and update recovery. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('@napi-rs/canvas');
const {boot,until}=require('./dom-check.cjs');
const {installNativeMock}=require('./update-ui-check.cjs');
const report={environment:'jsdom22 + fake-indexeddb + Napi Canvas; delayed project reads, image loading, codecs and native update I/O controlled; no Windows or Android execution',checks:[],errors:[]};
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const abortError=()=>Object.assign(Error('Canceled'),{name:'AbortError'});
const fakeVideo=record=>({inspectCapabilities:()=>({supported:true,formats:[{id:'webm',mime:'video/webm',label:'WebM'}]}),record});
function fileInput(app,file){Object.defineProperty(app.$('projectInput'),'files',{value:[file],configurable:true});app.$('projectInput').dispatchEvent(new app.w.Event('change',{bubbles:true}));}
async function nativeProjectOpening(){
 const app=boot(),{w,$,click,input}=app;let pending=deferred(),opens=0;
 try{
  await w.StudioApp.ready;input('projectName','Açılıştan önceki proje');input('headline','Korunması gereken başlık');const previous=plain(w.StudioApp.getProject());
  const incoming=w.StudioCore.createProject();incoming.name='Gecikmeli açılan proje';incoming.boards[0].state.headline='Dosyadaki başlık';
  w.StudioDesktop.openProject=()=>{opens++;return pending.promise;};click('openProjectButton');
  assert.equal($('app').dataset.busy,'true','Project opening must lock editing before awaiting the native picker/read');
  input('headline','Açılış sırasında girilmemeli');w.dispatchEvent(new w.CustomEvent('studio-command',{detail:'new'}));click('openProjectButton');
  assert.equal(opens,1,'A second project open is not started while the first read is pending');assert.deepEqual(plain(w.StudioApp.getProject()),previous);
  pending.resolve({ok:true,json:w.StudioCore.serialize(incoming)});await until(()=>w.StudioApp.getProject().name===incoming.name&&!$('busyDialog').open,'native pending open completes');
  click('undoButton');assert.equal(w.StudioApp.getProject().name,previous.name);assert.deepEqual(plain(w.StudioApp.getProject().boards),previous.boards);
  const preserved=plain(w.StudioApp.getProject());pending=deferred();click('openProjectButton');pending.resolve({ok:true,json:'{"invalid":'});await until(()=>!$('busyDialog').open,'invalid project read unlocks');assert.deepEqual(plain(w.StudioApp.getProject()),preserved);
  pending=deferred();click('openProjectButton');pending.resolve({ok:false,canceled:true});await until(()=>!$('busyDialog').open,'canceled native open unlocks');assert.deepEqual(plain(w.StudioApp.getProject()),preserved);assert.deepEqual(app.messages,[]);
 }finally{pending.resolve({ok:false,canceled:true});await wait(10);await app.close();}
}
async function browserProjectOpening(){
 const app=boot({native:false}),{w,$,input}=app,pending=deferred();let firstReads=0,secondReads=0;
 try{
  await w.StudioApp.ready;input('projectName','Tarayıcıdaki açık proje');const previous=plain(w.StudioApp.getProject());
  const incoming=w.StudioCore.createProject();incoming.name='İlk seçilen dosya';
  fileInput(app,{size:100,text(){firstReads++;return pending.promise;}});
  assert.equal($('app').dataset.busy,'true','Browser file reads must lock the current project');
  input('projectName','Dosya okunurken değişmemeli');fileInput(app,{size:100,text(){secondReads++;return Promise.resolve(w.StudioCore.serialize(w.StudioCore.createProject()));}});
  assert.equal(firstReads,1);assert.equal(secondReads,0);assert.deepEqual(plain(w.StudioApp.getProject()),previous);
  pending.resolve(w.StudioCore.serialize(incoming));await until(()=>w.StudioApp.getProject().name===incoming.name&&!$('busyDialog').open,'browser read completes once');
  const beforeFailure=plain(w.StudioApp.getProject());fileInput(app,{size:100,text:()=>Promise.reject(Error('QA file read failed'))});await until(()=>!$('busyDialog').open&&$('toast').textContent.includes('QA file read failed'),'failed browser read unlocks');assert.deepEqual(plain(w.StudioApp.getProject()),beforeFailure);assert.deepEqual(app.messages,[]);
 }finally{pending.resolve('{}');await wait(10);await app.close();}
}
async function cancelVideoFonts(){
 const app=boot(),{w,$,click}=app,fonts=deferred();let recordings=0;
 try{
  await w.StudioApp.ready;const before=plain(w.StudioApp.getProject());w.document.fonts.ready=fonts.promise;
  w.StudioVideo=fakeVideo(options=>{recordings++;return new Promise((resolve,reject)=>{if(options.signal.aborted)reject(abortError());else options.signal.addEventListener('abort',()=>reject(abortError()),{once:true});});});
  click('videoButton');click('videoExportConfirm');await wait(20);click('cancelVideoButton');
  await until(()=>!$('busyDialog').open,'video cancellation while font readiness is pending',600);assert.equal($('app').dataset.busy,'false');assert($('cancelVideoButton').classList.contains('hidden'));assert.deepEqual(plain(w.StudioApp.getProject()),before);assert(!app.calls.some(c=>c.method==='saveVideo'));assert.equal(recordings,0);assert.deepEqual(app.messages,[]);
 }finally{fonts.resolve();await wait(20);await app.close();}
}
async function cancelVideoMedia(){
 const app=boot(),{w,$,click}=app,pendingImages=[];let recordings=0;
 try{
  await w.StudioApp.ready;const canvas=createCanvas(8,6);canvas.getContext('2d').fillRect(0,0,8,6);const source=canvas.toDataURL('image/png'),OriginalImage=w.Image;
  w.Image=class extends OriginalImage{set src(value){if(value===source)pendingImages.push(()=>{super.src=value;});else super.src=value;}get src(){return super.src;}};
  const incoming=w.StudioCore.createProject();incoming.name='Görseli beklenen proje';incoming.boards[0].state.photo=source;app.setOpenJson(w.StudioCore.serialize(incoming));click('openProjectButton');await until(()=>pendingImages.length>0&&!$('busyDialog').open,'pending image decode after project open');
  const before=plain(w.StudioApp.getProject());w.StudioVideo=fakeVideo(async()=>{recordings++;throw Error('Recording must not start before media is ready');});click('videoButton');click('videoExportConfirm');await wait(20);click('cancelVideoButton');
  await until(()=>!$('busyDialog').open,'video cancellation while media is pending',600);assert.equal(recordings,0);assert.equal($('app').dataset.busy,'false');assert.deepEqual(plain(w.StudioApp.getProject()),before);assert(!app.calls.some(c=>c.method==='saveVideo'));assert.deepEqual(app.messages,[]);
 }finally{for(const release of pendingImages)release();await wait(30);await app.close();}
}
async function updateRecovery(){
 let controls;const app=boot({setupWindow:(w,context)=>{controls=installNativeMock(w,context);}}),{w,$,click,input}=app;
 try{
  await w.StudioApp.ready;click('updatesButton');await until(()=>$('updatesDialog').open,'open updater');
  input('updateSource','http://invalid.example/latest.json');input('updateAutoCheck',false);click('updateSaveSource');await until(()=>/HTTPS/.test($('updateMessage').textContent),'source validation fails');
  assert.equal($('updateSource').value,'http://invalid.example/latest.json','A failed validation keeps the entered source for correction');assert.equal($('updateAutoCheck').checked,false,'A failed save keeps the chosen auto-check preference');
  controls.configureError='QA configuration write failed';input('updateSource','owner/repository');click('updateSaveSource');await until(()=>$('updateMessage').textContent.includes('QA configuration write failed'),'configuration write fails');assert.equal($('updateSource').value,'owner/repository');assert.equal($('updateAutoCheck').checked,false);
  controls.configureError=null;click('updateSaveSource');await until(()=>controls.state.configured&&!$('updateCheckButton').disabled,'configuration retry succeeds');assert.equal($('updateSource').value,'https://github.com/owner/repository/releases/latest/download/latest.json');assert.equal($('updateAutoCheck').checked,false);
  controls.emit({status:'error',error:'QA cached release check offline',canDownload:true,canInstall:true,latestVersion:'3.2.0'});assert.equal($('updateInstallButton').classList.contains('hidden'),false,'A verified cached installer remains available after a failed check');assert.equal($('updateInstallButton').disabled,false);assert.equal($('updateDownloadButton').classList.contains('hidden'),true);assert.match($('updateMessage').textContent,/cached release check offline/);
  controls.emit({status:'error',error:'QA interrupted download',canDownload:true,canInstall:false});assert.equal($('updateDownloadButton').classList.contains('hidden'),false,'A verified release can retry its interrupted download without another check');assert.equal($('updateInstallButton').classList.contains('hidden'),true);click('updateDownloadButton');await until(()=>controls.downloadTask&&controls.state.status==='downloading','download retry starts directly');assert.equal($('updateDownloadButton').disabled,true);controls.downloadTask.resolve({ok:true});await until(()=>controls.state.status==='downloaded','download retry completed');
  controls.emit({status:'error',error:'QA no verified release',canDownload:false,canInstall:false});assert.equal($('updateDownloadButton').classList.contains('hidden'),true);assert.equal($('updateInstallButton').classList.contains('hidden'),true);
  $('updatesDialog').close();const refreshing=deferred();w.StudioDesktop.getUpdateState=()=>refreshing.promise;const opening=w.StudioUpdates.open();await w.StudioApp.prepareUpdate();refreshing.resolve({ok:true,state:plain(controls.state)});await opening;assert.equal($('updatesDialog').open,false,'A late updater refresh cannot open over a newly busy editor');w.StudioApp.finishUpdatePreparation();assert.deepEqual(app.messages,[]);
 }finally{if(controls?.downloadTask)controls.downloadTask.resolve({ok:false,error:'QA cleanup'});await wait(20);await app.close();}
}
(async()=>{for(const [name,run]of [['Pending native project opening preserves the current work and serializes open/cancel/failure',nativeProjectOpening],['Pending browser project reads preserve current work and reject overlapping reads',browserProjectOpening],['Video preparation can be canceled while font readiness is pending',cancelVideoFonts],['Video preparation can be canceled while an image is pending',cancelVideoMedia],['Updater preserves failed setting edits and offers verified offline cache/download recovery',updateRecovery]]){try{await run();report.checks.push(name);console.log('PASS:',name);}catch(error){report.errors.push(name+': '+error.stack);console.error('FAIL:',name,error.message);}}
 fs.writeFileSync(path.join(__dirname,'editor-regression-check-results.json'),JSON.stringify(report,null,2)+'\n');if(report.errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
