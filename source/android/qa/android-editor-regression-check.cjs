/* Focused regressions for delayed project opening, preparation cancellation and update recovery. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createCanvas}=require('@napi-rs/canvas');
const {boot,until}=require('./dom-harness.cjs');
const report={environment:'jsdom22 + fake-indexeddb + Napi Canvas; delayed project reads, image loading, codecs and native Android bridge controlled; no Windows or Android execution',checks:[],errors:[]};
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
  const nativeRequest=w.KarevoAndroid.request;w.KarevoAndroid.request=(action,payload,id)=>{if(action!=='open-project')return nativeRequest(action,payload,id);opens++;pending.promise.then(result=>w.StudioAndroidResult({...result,id}));};click('openProjectButton');
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
(async()=>{for(const [name,run]of [['Pending native project opening preserves the current work and serializes open/cancel/failure',nativeProjectOpening],['Pending browser project reads preserve current work and reject overlapping reads',browserProjectOpening],['Video preparation can be canceled while font readiness is pending',cancelVideoFonts],['Video preparation can be canceled while an image is pending',cancelVideoMedia]]){try{await run();report.checks.push(name);console.log('PASS:',name);}catch(error){report.errors.push(name+': '+error.stack);console.error('FAIL:',name,error.message);}}
 fs.writeFileSync(path.join(__dirname,'android-editor-regression-check-results.json'),JSON.stringify(report,null,2)+'\n');if(report.errors.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
