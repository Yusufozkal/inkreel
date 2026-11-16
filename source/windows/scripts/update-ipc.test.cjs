'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function boot(options = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-update-ipc-'));
  const handlers = new Map(), listeners = new Map(), windows = [], messages = [], calls = [], timers = [];
  let manager, dialogResolver, menu, quitCount = 0, initError = options.initError;
  class MockUpdateManager {
    constructor(config) { manager = this; this.config = config; this.state = {status:'downloaded',currentVersion:'3.1.0',configured:false,autoCheck:false,progress:1,latestVersion:'3.2.0',canDownload:true,canInstall:true,...options.state}; }
    async init() { if (initError) throw Error('private cache path leaked'); }
    getState() { return {...this.state}; }
    async configure(value) { calls.push(['configure', value]); this.state.feedUrl = value.feedUrl; this.config.onState(this.getState()); return this.getState(); }
    async check() { calls.push(['check']); if(options.checkError)throw Error('Çevrimdışı.'); return this.getState(); }
    async download() { calls.push(['download']); return this.getState(); }
    async getVerifiedInstaller() { calls.push(['verify']); if (options.verifyError) throw Error('İmza doğrulanamadı.'); return path.join(temp,'verified.exe'); }
    async launchInstaller(value) {
      calls.push(['launch', value]);
      const backupDir = path.join(temp,'update-backups');
      const names = await fs.readdir(backupDir);
      assert(names.some(name=>name.endsWith('.inkreel')), 'Backup must exist before launching');
      if (options.launchError) throw Error('Kurucu başlatılamadı.');
      return {path:path.join(temp,'verified.exe'),version:'3.2.0'};
    }
  }
  const electron = {
    app:{enableSandbox(){},setAppUserModelId(value){calls.push(['identity',value]);},requestSingleInstanceLock:()=>true,on(){},whenReady:()=>Promise.resolve(),quit(){quitCount++;},getVersion:()=> '3.1.0',getPath:()=>temp,setPath:(key,value)=>{assert.equal(key,'userData');assert.equal(value,path.join(temp,'Bülten Studio'));}},
    BrowserWindow:class {
      constructor(config){this.config=config;this.events=new Map();this.destroyed=false;this.webContents={mainFrame:{url:'bulten://app/index.html'},send:(...args)=>messages.push(args),setWindowOpenHandler(){},on(){}};windows.push(this);}
      static getAllWindows(){return windows.filter(w=>!w.destroyed);}
      isDestroyed(){return this.destroyed;}
      close(){let prevented=false;this.events.get('close')?.({preventDefault(){prevented=true;}});if(!prevented){this.destroyed=true;this.events.get('closed')?.();}}
      once(){} on(name,fn){this.events.set(name,fn);}loadURL(){}show(){}
    },
    Menu:{setApplicationMenu(value){menu=value;},buildFromTemplate:value=>value},
    clipboard:{writeText(){}},
    dialog:{showSaveDialog:()=>new Promise(resolve=>{dialogResolver=resolve;}),showOpenDialog:()=>Promise.resolve({canceled:true}),showErrorBox(){},showMessageBox:()=>Promise.resolve({response:0})},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:(name,fn)=>listeners.set(name,fn)},
    nativeImage:{createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:512,height:512})})},
    protocol:{registerSchemesAsPrivileged(){},handle(){}},screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1500,height:980}})},
    session:{defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){},webRequest:{onBeforeRequest(){}}}}
  };
  const mainPath=path.join(__dirname,'..','native','main.cjs'),nativeRequire=createRequire(mainPath);
  const timeout=(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;};
  vm.runInNewContext(await fs.readFile(mainPath,'utf8'),{
    require:name=>name==='electron'?electron:name==='./update-manager.cjs'?{UpdateManager:MockUpdateManager}:nativeRequire(name),
    __dirname:path.dirname(mainPath),process:{platform:'win32',arch:'x64',pid:process.pid},Buffer,Response,URL,console,setTimeout:timeout,clearTimeout:timer=>{if(timer)timer.canceled=true;}
  },{filename:mainPath});
  for(let i=0;i<15&&!windows.length;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(windows.length,1);
  const win=windows[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  return {temp,manager,win,event,menu,messages,calls,timers,listeners,
    invoke:(name,...args)=>handlers.get(name)(event,...args),raw:(name,event,...args)=>handlers.get(name)(event,...args),resolveDialog:value=>dialogResolver(value),
    close:()=>fs.rm(temp,{recursive:true,force:true}),get quitCount(){return quitCount;}};
}

test('update IPC enforces trusted frame, file/close guards and renderer network isolation',async()=>{
  const b=await boot();
  try{
    const info=await b.invoke('studio:info');assert.equal(info.updateCapable,true);
    assert.equal(b.manager.config.userDataDir,b.temp);assert.equal(b.manager.config.platform,'win32');
    assert(b.calls.some(call=>call[0]==='identity'&&call[1]==='com.bultenstudio.app'));
    assert.equal(b.win.config.webPreferences.contextIsolation,true);assert.equal(b.win.config.webPreferences.nodeIntegration,false);
    for(const action of ['state','configure','check','download','install']){
      const denied=await b.raw('studio:update-'+action,{sender:{},senderFrame:{}},'{}');assert.equal(denied.ok,false);
      const wrongFrame=await b.raw('studio:update-'+action,{sender:b.event.sender,senderFrame:{url:'bulten://app/index.html'}},'{}');assert.equal(wrongFrame.ok,false);
    }
    assert.equal((await b.invoke('studio:update-state')).state.currentVersion,'3.1.0');
    assert.equal((await b.invoke('studio:update-configure',{feedUrl:'https://example.com/latest.json',autoCheck:false})).ok,true);
    assert(b.messages.some(message=>message[0]==='studio:update-state'));
    assert.equal((await b.invoke('studio:update-check')).ok,true);assert.equal((await b.invoke('studio:update-download')).ok,true);
    const file=b.invoke('studio:save-project','{}','sample');await new Promise(resolve=>setImmediate(resolve));
    for(const action of ['configure','check','download','install'])assert.equal((await b.invoke('studio:update-'+action,action==='install'?'{}':{})).ok,false);
    assert.equal((await b.invoke('studio:update-state')).ok,true,'State remains readable during a picker');
    b.resolveDialog({canceled:true});assert.equal((await file).canceled,true);
    const updateMenu=b.menu.find(item=>item.label==='Yardım').submenu.find(item=>item.label.includes('Güncellemeleri'));
    updateMenu.click();assert(b.messages.some(message=>message[0]==='studio:command'&&message[1]==='updates'));
    b.win.close();
    for(const action of ['configure','check','download','install'])assert.equal((await b.invoke('studio:update-'+action,action==='install'?'{}':{})).ok,false);
    assert.equal((await b.invoke('studio:update-state')).ok,true,'State remains readable during close');
  }finally{await b.close();}
});

test('update install validates project and signature before backup or launch',async()=>{
  const b=await boot({verifyError:true});
  try{
    for(const input of ['not JSON','[]',null])assert.equal((await b.invoke('studio:update-install',input)).ok,false);
    assert.equal(b.calls.filter(call=>call[0]==='verify').length,0);
    const result=await b.invoke('studio:update-install','{"schema":"bulten-studio-project","boards":[]}');
    assert.equal(result.ok,false);assert.match(result.error,/İmza/);assert.equal(b.win.destroyed,false);
    assert.equal(b.calls.filter(call=>call[0]==='launch').length,0);
    await assert.rejects(fs.stat(path.join(b.temp,'update-backups')),/ENOENT/);
    assert.equal((await b.invoke('studio:update-check')).ok,true,'Failed installation unlocks other update actions');
  }finally{await b.close();}
});

test('failed installer spawn keeps editor open, preserves exact backup and prunes only owned backups',async()=>{
  const b=await boot({launchError:true});
  try{
    const directory=path.join(b.temp,'update-backups');await fs.mkdir(directory);
    const names=[1,2,3,4].map(n=>'project-before-update-2025-01-0'+n+'T00-00-00-000Z-00000000-0000-4000-8000-00000000000'+n+'.bulten');
    for(const name of names)await fs.writeFile(path.join(directory,name),'old');
    await fs.writeFile(path.join(directory,'my-own-project.bulten'),'untouched');
    const json='{"schema":"bulten-studio-project","name":"Taslak","boards":[{"title":"Güncel haber"}]}';
    const result=await b.invoke('studio:update-install',json);assert.equal(result.ok,false);assert.equal(b.win.destroyed,false);
    const files=await fs.readdir(directory);const owned=files.filter(name=>name.startsWith('project-before-update-'));
    assert.equal(owned.length,3);assert(files.includes('my-own-project.bulten'));
    assert.equal(await fs.readFile(path.join(directory,'my-own-project.bulten'),'utf8'),'untouched');
    const newest=owned.find(name=>!names.includes(name));assert.equal(await fs.readFile(path.join(directory,newest),'utf8'),json);
    assert.equal((await fs.stat(path.join(directory,newest))).mode&0o777,0o600);
    assert.equal((await b.invoke('studio:update-check')).ok,true);
  }finally{await b.close();}
});

test('successful update handoff backs up before launch then closes without a second save timeout',async()=>{
  const b=await boot();
  try{
    const json='{"schema":"bulten-studio-project","name":"Kayıtlı tasarım","boards":[]}';
    const result=await b.invoke('studio:update-install',json);assert.equal(result.ok,true);assert.equal(result.installing,true);assert.match(result.backupName,/\.inkreel$/);
    assert.equal(await fs.readFile(path.join(b.temp,'update-backups',result.backupName),'utf8'),json);
    assert.equal(b.calls.find(call=>call[0]==='launch')[1].parentPid,process.pid);
    assert.equal(b.win.destroyed,false,'Response is delivered before closing');
    assert.equal((await b.invoke('studio:update-install',json)).ok,false,'No second installer may launch');
    assert.equal((await b.invoke('studio:open-project')).ok,false,'No file picker while installer waits');
    assert.equal((await b.invoke('studio:update-check')).ok,false);
    b.win.close();assert.equal(b.win.destroyed,false,'Ordinary close is held during the verified handoff');
    const handoff=b.timers.find(timer=>timer.delay===250&&!timer.canceled);assert(handoff);handoff.fn();assert.equal(b.win.destroyed,true);
    assert.equal(b.messages.filter(message=>message[0]==='studio:before-close').length,0,'Preparation was already saved and backed up');
    assert(!b.timers.some(timer=>timer.delay===5000),'No normal close fallback can skip this update preparation');
  }finally{await b.close();}
});

test('cached update remains installable after a failed recheck, but unavailable or busy states cannot launch',async()=>{
  for(const state of [{status:'error',canInstall:true},{status:'error',canInstall:false},{status:'checking',canInstall:true},{status:'downloading',canInstall:true}]){
    const b=await boot({state});
    try{
      const result=await b.invoke('studio:update-install','{"schema":"bulten-studio-project","boards":[]}');
      const allowed=state.status==='error'&&state.canInstall;
      assert.equal(result.ok,allowed);
      assert.equal(b.calls.some(call=>call[0]==='verify'),allowed,'Cache signature/hash verification remains mandatory');
      assert.equal(b.calls.some(call=>call[0]==='launch'),allowed);
      if(!allowed)await assert.rejects(fs.stat(path.join(b.temp,'update-backups')),/ENOENT/);
    }finally{await b.close();}
  }
  const b=await boot({state:{status:'error',canInstall:true},verifyError:true});
  try{
    const result=await b.invoke('studio:update-install','{"schema":"bulten-studio-project","boards":[]}');
    assert.equal(result.ok,false);assert.match(result.error,/İmza/);
    assert.equal(b.calls.some(call=>call[0]==='launch'),false);
    await assert.rejects(fs.stat(path.join(b.temp,'update-backups')),/ENOENT/);
  }finally{await b.close();}
});

test('update initialization failure leaves offline editor available and blocks updating',async()=>{
  const b=await boot({initError:true});
  try{
    assert.equal((await b.invoke('studio:info')).updateCapable,false);
    assert.equal((await b.invoke('studio:update-state')).state.status,'disabled');
    assert.equal((await b.invoke('studio:update-check')).ok,false);
    assert.equal((await b.invoke('studio:copy-text','still working')).ok,true);
  }finally{await b.close();}
});

test('failed automatic checks remain quiet and retry only after 24 hours in this session',async()=>{
  const b=await boot({checkError:true,state:{status:'idle',configured:true,autoCheck:true,feedUrl:'https://example.com/latest.json'}});
  try{
    const first=b.timers.find(timer=>!timer.canceled);assert.equal(first.delay,5000);
    await first.fn();assert.equal(b.calls.filter(call=>call[0]==='check').length,1);
    const next=b.timers.findLast(timer=>!timer.canceled&&timer!==first);
    assert(next.delay>23*60*60*1000&&next.delay<=24*60*60*1000,'Network failure does not trigger repeated automatic retries');
    assert.equal(b.messages.filter(message=>message[0]==='studio:command').length,0);
  }finally{await b.close();}
});

test('preload exposes only named update calls and forwards verified main-process state events',async()=>{
  const calls=[],listeners=new Map(),events=[];let api;
  const preloadPath=path.join(__dirname,'..','native','preload.cjs');
  vm.runInNewContext(await fs.readFile(preloadPath,'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:(...args)=>{calls.push(args);return Promise.resolve({ok:true});},send:(...args)=>calls.push(args),on:(name,fn)=>listeners.set(name,fn)}}),
    window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Event:class{constructor(type){this.type=type;}}
  },{filename:preloadPath});
  assert(Object.isFrozen(api));
  await api.getUpdateState();await api.configureUpdates({feedUrl:'https://example.com/latest.json'});await api.checkForUpdates();await api.downloadUpdate();await api.installUpdate('{}');
  assert.deepEqual(calls.map(call=>call[0]),['studio:update-state','studio:update-configure','studio:update-check','studio:update-download','studio:update-install']);
  listeners.get('studio:update-state')({}, {status:'available'});assert.equal(events.at(-1).type,'studio-update-state');assert.equal(events.at(-1).detail.status,'available');
  listeners.get('studio:command')({},'updates');assert.equal(events.at(-1).type,'studio-command');assert.equal(events.at(-1).detail,'updates');
  const before=events.length;listeners.get('studio:command')({},'not-allowed');assert.equal(events.length,before);
  api.finishClose(false);assert.equal(calls.at(-1)[0],'studio:finish-close');assert.equal(calls.at(-1)[1],false);
});
