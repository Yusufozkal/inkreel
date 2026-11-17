/* Production update UI + editor integration. Native network/install boundary mocked. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {boot,until}=require('./dom-check.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const copy=value=>value===undefined?undefined:plain(value);
const report={environment:'jsdom22 + real Napi Canvas + fake-indexeddb; native updater network/download/install mocked. No actual Windows execution.',checks:[],errors:[]};
function check(name){report.checks.push(name);console.log('PASS:',name);}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function installNativeMock(w,context){
 const state={status:'idle',currentVersion:'3.3.2',latestVersion:null,notes:'',progress:0,feedUrl:'',autoCheck:true,configured:true,lastCheckedAt:null,error:null,downloadBytes:0,totalBytes:0};
 const controls={state,calls:context.calls,configureError:null,checkError:null,downloadTask:null,installTask:null};
 controls.emit=patch=>{Object.assign(state,patch);w.dispatchEvent(new w.CustomEvent('studio-update-state',{detail:copy(state)}));};
 const outcome=()=>({ok:true,state:copy(state)});
 Object.assign(w.StudioDesktop,{
  getInfo:async()=>({platform:'win32',version:'3.3.2',updateCapable:true}),
  getUpdateState:async()=>{context.calls.push({method:'getUpdateState'});return outcome();},
  configureUpdates:async config=>{
   context.calls.push({method:'configureUpdates',config:copy(config)});
   if(controls.configureError)return{ok:false,error:controls.configureError};
   if(config.feedUrl){try{const url=new URL(config.feedUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error();}catch(_){return{ok:false,error:'Güncelleme adresi güvenli bir HTTPS bağlantısı olmalı.'};}}
   controls.emit({feedUrl:config.feedUrl,autoCheck:config.autoCheck,status:'idle',error:null});return outcome();
  },
  checkForUpdates:async()=>{
   context.calls.push({method:'checkForUpdates'});controls.emit({status:'checking',error:null});
   if(controls.checkError){controls.emit({status:'error',error:controls.checkError});return{ok:false,error:controls.checkError,state:copy(state)};}
   controls.emit({status:'available',latestVersion:'3.3.3',notes:'Yeni şablonlar\nDaha hızlı kayıt',lastCheckedAt:'2026-10-20T12:00:00.000Z',progress:0});return outcome();
  },
  downloadUpdate:async()=>{
   context.calls.push({method:'downloadUpdate'});controls.emit({status:'downloading',progress:.25,downloadBytes:2500,totalBytes:10000});
   controls.downloadTask=deferred();const result=await controls.downloadTask.promise;
   if(result?.ok===false){controls.emit({status:'error',error:result.error});return result;}
   controls.emit({status:'downloaded',progress:1,downloadBytes:10000,totalBytes:10000,error:null});return outcome();
  },
  installUpdate:async json=>{
   context.calls.push({method:'installUpdate',json,completedWrite:copy(context.getLastCompletedWrite()),pendingWrites:context.getPendingWriteCount(),appBusy:w.document.getElementById('app').dataset.busy});
   controls.installTask=deferred();return controls.installTask.promise;
  }
 });
 return controls;
}

// The ID contract is resolved from the final markup below once the UI is ready.
const IDS={button:'updatesButton',dialog:'updatesDialog',feed:'updateSource',auto:'updateAutoCheck',save:'updateSaveSource',check:'updateCheckButton',download:'updateDownloadButton',install:'updateInstallButton',status:'updateStatus',message:'updateMessage',notes:'updateNotes',progress:'updateProgress'};
async function main(){
 let controls;
 const app=boot({setupWindow:(w,context)=>{controls=installNativeMock(w,context);}}),{$,w,click,input}=app;
 const project=()=>plain(w.StudioApp.getProject());
 const invokeCount=method=>controls.calls.filter(call=>call.method===method).length;
 await w.StudioApp.ready;await until(()=>invokeCount('getUpdateState')>0,'initial updater state');
 assert.equal(w.StudioApp.version,'3.3.2');assert.equal(w.StudioCore.VERSION,3);
 click(IDS.button);await until(()=>$(IDS.dialog).open,'open updates dialog');
 assert.doesNotMatch($(IDS.status).textContent,/kaynağı henüz ayarlanmadı/);
 assert.equal($(IDS.check).disabled,false,'Check works with built-in sources');assert.equal($('updateSourceDetails').open,false);
 assert.match($('updateSourceDetails').textContent,/Ek güncelleme kaynağı \(isteğe bağlı\)/);assert.match($(IDS.feed).placeholder,/Boş bırakın/);
 assert.equal(invokeCount('checkForUpdates'),0,'No network check happens automatically');
 assert.equal($(IDS.download).classList.contains('hidden'),true);
 assert.equal($(IDS.install).classList.contains('hidden'),true);
 check('Built-in sources need no setup; source settings stay collapsed and optional');

 const invalidBefore=invokeCount('configureUpdates');input(IDS.feed,'http://updates.invalid/latest.json');click(IDS.save);
 await until(()=>/HTTPS/.test($(IDS.message).textContent),'invalid HTTPS source explanation');
 assert.equal(invokeCount('configureUpdates'),invalidBefore,'Invalid HTTP never reaches native host');
 for(const bad of ['javascript:alert(1)','https://user:password@example.com/latest.json','https://example.com/feed#fragment','https://example.com/\\evil'])assert.throws(()=>w.StudioUpdates.sourceUrl(bad));
 assert.equal(w.StudioUpdates.sourceUrl('Turkish_Vito/inkreel'),'https://gitlab.com/Turkish_Vito/inkreel/-/releases/permalink/latest/downloads/latest.json');
 assert.equal(w.StudioUpdates.sourceUrl('group/sub/karevo'),'https://gitlab.com/group/sub/karevo/-/releases/permalink/latest/downloads/latest.json');
 assert.equal(w.StudioUpdates.sourceUrl('https://gitlab.com/Turkish_Vito/inkreel'),'https://gitlab.com/Turkish_Vito/inkreel/-/releases/permalink/latest/downloads/latest.json');
 assert.equal(w.StudioUpdates.sourceUrl('https://gitlab.com/Turkish_Vito/inkreel.git/'),'https://gitlab.com/Turkish_Vito/inkreel/-/releases/permalink/latest/downloads/latest.json');
 assert.equal(w.StudioUpdates.sourceUrl('https://gitlab.com/Turkish_Vito/inkreel/-/releases/v1.0.0'),'https://gitlab.com/Turkish_Vito/inkreel/-/releases/v1.0.0');
 assert.equal(w.StudioUpdates.sourceUrl('https://updates.example.com/stable/latest.json'),'https://updates.example.com/stable/latest.json');
 input(IDS.feed,'Turkish_Vito/inkreel');input(IDS.auto,false);click(IDS.save);
 await until(()=>controls.state.feedUrl&&$(IDS.check).disabled===false,'source saved');
 const configured=controls.calls.filter(call=>call.method==='configureUpdates').at(-1).config;
 assert.deepEqual(configured,{feedUrl:'https://gitlab.com/Turkish_Vito/inkreel/-/releases/permalink/latest/downloads/latest.json',autoCheck:false});
 assert.equal($(IDS.auto).checked,false,'Typed auto-check choice survives redraw');
 assert.equal($(IDS.feed).value,configured.feedUrl);
 check('Source validation and GitLab normalization preserve edited source and auto-check preference');

 controls.checkError='İnternet bağlantısı kurulamadı.';const beforeOffline=project();click(IDS.check);
 await until(()=>/İnternet bağlantısı/.test($(IDS.message).textContent)&&!$(IDS.check).disabled,'offline failure display');
 assert.notEqual($('app').dataset.busy,'true');assert.deepEqual(project(),beforeOffline);
 assert.equal($(IDS.check).disabled,false,'Offline checks can be retried');
 controls.checkError=null;click(IDS.check);
 await until(()=>controls.state.status==='available'&&!$(IDS.download).disabled,'signed release available');
 assert.match($(IDS.status).textContent,/Yeni sürüm/);assert.match($('updateVersion').textContent,/3\.3\.3/);
 assert.equal($(IDS.notes).textContent,'Yeni şablonlar\nDaha hızlı kayıt');
 controls.emit({notes:'<img src=x onerror=alert(1)> **Yalnız düz metin**'});
 assert.equal($(IDS.notes).querySelector('img'),null);assert.match($(IDS.notes).textContent,/<img/);
 assert.equal($(IDS.button).classList.contains('has-update'),true);
 check('Offline/retry leaves project editable; release notes render as plain text');

 click(IDS.download);await until(()=>controls.downloadTask&&controls.state.status==='downloading','background download starts');
 assert.equal($(IDS.progress).classList.contains('hidden'),false);assert.equal($(IDS.progress).value,.25);
 assert.equal($(IDS.check).disabled,true);assert.equal($(IDS.save).disabled,true);
 assert.notEqual($('app').dataset.busy,'true','Background download does not lock editor');
 click($(IDS.dialog).querySelector('.close-dialog'));input('headline','İndirme sürerken değişen başlık');
 assert.equal(project().boards.find(b=>b.id===project().activeId).state.headline,'İndirme sürerken değişen başlık');
 controls.emit({progress:.75,downloadBytes:7500});assert.match($(IDS.message).textContent,/75%/);
 controls.downloadTask.resolve({ok:false,error:'Dosya imzası doğrulanamadı.'});
 await until(()=>controls.state.status==='error'&&/imzası/.test($(IDS.message).textContent)&&!$(IDS.check).disabled,'download verification error');
 assert.equal($(IDS.install).classList.contains('hidden'),true);assert.notEqual($('app').dataset.busy,'true');
 click(IDS.button);await until(()=>$(IDS.dialog).open,'reopen after background failure');click(IDS.check);
 await until(()=>controls.state.status==='available'&&!$(IDS.download).disabled,'retry check available');click(IDS.download);
 await until(()=>controls.state.status==='downloading'&&controls.downloadTask,'second download starts');controls.downloadTask.resolve({ok:true});
 await until(()=>controls.state.status==='downloaded'&&!$(IDS.install).disabled,'verified download ready');
 assert.equal($(IDS.progress).classList.contains('hidden'),true);assert.equal($(IDS.download).classList.contains('hidden'),true);
 check('Download progress and failed verification preserve editing; verified download enables installation');

 click($(IDS.dialog).querySelector('.close-dialog'));input('projectName','Güncellemeden önce son proje');input('postCaption','Kaybolmaması gereken son açıklama');
 const beforeInstall=project();click(IDS.button);await until(()=>$(IDS.dialog).open,'open before guarded install');click(IDS.install);
 await until(()=>invokeCount('installUpdate')===1,'snapshot delivered after autosave');
 const firstInstall=controls.calls.filter(call=>call.method==='installUpdate').at(-1),parsed=plain(w.StudioCore.parse(firstInstall.json));
 assert.equal(firstInstall.appBusy,'true');assert.equal($('busyDialog').open,true);assert.equal($(IDS.dialog).open,false);
 assert.equal(firstInstall.pendingWrites,0,'Install starts after delayed autosave writes finish');
 assert.equal(firstInstall.completedWrite.key,'autosave');
 assert.equal(firstInstall.completedWrite.value.project.name,'Güncellemeden önce son proje');
 assert.equal(firstInstall.completedWrite.value.project.boards.find(b=>b.id===beforeInstall.activeId).post.caption,'Kaybolmaması gereken son açıklama');
 assert.deepEqual(parsed.boards,beforeInstall.boards);assert.equal(parsed.name,beforeInstall.name);
 const projectLocked=project();input('headline','Kurulum sırasında değişmemeli');assert.deepEqual(project(),projectLocked,'Busy guard blocks input mutation');
 assert.equal(w.document.querySelector('dialog#busyDialog[open]')!==null,true);
 controls.installTask.resolve({ok:false,error:'Kurulum başlatılamadı. Mevcut sürüm korundu.'});
 await until(()=>$('app').dataset.busy==='false'&&$(IDS.dialog).open,'failed install unlocks and reopens updater');
 assert.equal($('busyDialog').open,false);assert.match($(IDS.message).textContent,/Kurulum başlatılamadı/);
 assert.deepEqual(project(),projectLocked);assert.equal($(IDS.install).disabled,false,'Retry install available after native failure');
 check('Install locks editing and waits for current autosave/snapshot; native failure reopens without project loss');

 click($(IDS.dialog).querySelector('.close-dialog'));
 w.dispatchEvent(new w.CustomEvent('studio-command',{detail:'updates'}));await until(()=>$(IDS.dialog).open,'native update command');
 click($(IDS.dialog).querySelector('.close-dialog'));
 const serialized=await w.StudioApp.prepareUpdate();assert(serialized.includes('Güncellemeden önce son proje'));assert.equal($('app').dataset.busy,'true');
 await w.StudioUpdates.open();assert.equal($(IDS.dialog).open,false,'Updater cannot open over another busy operation');
 w.StudioApp.finishUpdatePreparation();assert.notEqual($('app').dataset.busy,'true');
 await w.StudioUpdates.open();await until(()=>$(IDS.dialog).open,'updater available after manual lock release');
 check('Native command opens updater and update preparation blocks overlapping dialog actions');

 input('projectName','Başarılı kurulum anı');const successProject=project();click(IDS.install);
 await until(()=>invokeCount('installUpdate')===2,'second install call');controls.installTask.resolve({ok:true,installing:true,backupName:'project-before-update-fixture.bulten'});
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal($('app').dataset.busy,'true','Successful launch stays locked while native closes application');
 assert.equal($('busyDialog').open,true);assert.equal($(IDS.dialog).open,false);assert.deepEqual(project(),successProject);
 assert.deepEqual(app.messages,[]);await app.close();
 check('Successful installer launch retains busy lock pending native close and preserves current project');

 const browser=boot({native:false});await browser.w.StudioApp.ready;
 assert.equal(browser.$(IDS.button).classList.contains('hidden'),true,'Browser does not advertise Windows updater');
 assert.equal(browser.w.StudioUpdates,undefined);assert.deepEqual(browser.messages,[]);await browser.close();
 check('Browser edition hides native-only updater without errors');
}
if(require.main===module)main().then(()=>{fs.writeFileSync(path.join(__dirname,'update-ui-check-results.json'),JSON.stringify(report,null,2)+'\n');console.log('All',report.checks.length,'update UI integration checks passed.');}).catch(error=>{report.errors.push(error.stack);fs.writeFileSync(path.join(__dirname,'update-ui-check-results.json'),JSON.stringify(report,null,2)+'\n');console.error(error);process.exitCode=1;setTimeout(()=>process.exit(1),150).unref();});
module.exports={installNativeMock};
