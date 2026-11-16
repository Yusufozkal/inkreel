/* Security/lifecycle tests with controlled media/encoder; actual codecs have a separate browser runner. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),fixtures={mp4:fs.readFileSync(path.join(__dirname,'fixtures/video.mp4')),webm:fs.readFileSync(path.join(__dirname,'fixtures/video.webm'))};
const checks=[];
function file(bytes=fixtures.mp4,name='Haber.mp4',type='video/mp4'){const f=new Blob([bytes],{type});Object.defineProperty(f,'name',{value:name});return f;}
function referenceTail(tail){const original=fixtures.mp4,at=original.indexOf(Buffer.from('url '))+8,bytes=Buffer.concat([original.subarray(0,at),Buffer.from(tail),original.subarray(at)]);for(const type of ['moov','trak','mdia','minf','dinf','dref','url ']){const offset=original.indexOf(Buffer.from(type))-4;assert(offset>=0&&offset<at);bytes.writeUInt32BE(original.readUInt32BE(offset)+tail.length,offset);}return bytes;}
function boot(settings={}){
 const urls=new Map(),revoked=[],videos=[],canvases=[],recorders=[],contexts=[],nodes=[],timers=new Set(),frames=new Map();let next=0,allocations=0,trackStops=0;
 function track(kind){return{kind,readyState:'live',requestFrame(){},stop(){if(this.readyState!=='ended'){this.readyState='ended';trackStops++;}}};}
 function stream(tracks){return{getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),addTrack(t){tracks.push(t);}};}
 class Video extends EventTarget{
  constructor(){super();this._src='';this._currentTime=0;this.duration=settings.duration??4;this.videoWidth=settings.videoWidth??1280;this.videoHeight=settings.videoHeight??720;this.readyState=0;this.paused=true;this.ended=false;videos.push(this);}
  set src(v){this._src=v;}get src(){return this._src;}
  set currentTime(v){if(this.duration===Infinity&&settings.resolvedDuration)this.duration=settings.resolvedDuration;this._currentTime=Math.min(v,this.duration);queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}
  get currentTime(){return this._currentTime;}
  load(){if(!this._src)return;if(settings.neverMetadata)return;queueMicrotask(()=>{this.readyState=2;this.dispatchEvent(new Event(settings.metadataError?'error':'loadedmetadata'));});}
  play(){if(settings.playError)return Promise.reject(Error('Playback blocked'));this.paused=false;return Promise.resolve();}
  pause(){this.paused=true;}
  removeAttribute(name){if(name==='src')this._src='';}
 }
 function canvas(){const c={width:1,height:1};const context={font:'',save(){},restore(){},setTransform(){},fillRect(){},beginPath(){},rect(){},clip(){},translate(){},rotate(){},drawImage(){},fillText(){},measureText(t){return{width:t.length*10};}};c.getContext=()=>context;if(settings.capture!==false)c.captureStream=()=>{c.stream=stream([track('video')]);return c.stream;};canvases.push(c);return c;}
 class Recorder{
  static isTypeSupported(type){if(settings.supported)return settings.supported.includes(type);return /^video\/(mp4|webm)/.test(type);}
  constructor(s,opts){if(settings.constructError)throw Error('Encoder failed');this.stream=s;this.options=opts;this.state='inactive';recorders.push(this);}
  start(){if(settings.startError)throw Error('Start failed');this.state='recording';}
  stop(){if(this.state==='inactive')return;this.state='inactive';if(settings.neverStop)return;queueMicrotask(()=>{const kind=this.options.mimeType.startsWith('video/mp4')?'mp4':'webm';if(this.ondataavailable)this.ondataavailable({data:settings.oversize?{size:41*1024*1024}:new Blob([settings.invalidOutput?Buffer.from('not video'):fixtures[kind]],{type:'video/'+kind})});if(this.onstop)this.onstop();});}
 }
 class Audio{
  constructor(){this.state='suspended';this.closed=false;contexts.push(this);}
  createMediaElementSource(video){const node={video,connect(to){node.to=to;},disconnect(){node.disconnected=true;}};nodes.push(node);return node;}
  createGain(){const node={gain:{value:1},connect(to){node.to=to;},disconnect(){node.disconnected=true;}};nodes.push(node);return node;}
  createMediaStreamDestination(){const node={stream:stream([track('audio')]),disconnect(){node.disconnected=true;}};nodes.push(node);return node;}
  resume(){if(settings.audioHang)return new Promise(()=>{});this.state='running';return Promise.resolve();}
  close(){this.closed=true;return Promise.resolve();}
 }
 class Reader{
  readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:'+blob.type+';base64,'+Buffer.from(b).toString('base64');if(this.onload)this.onload();});}
  readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;if(this.onload)this.onload();});}
  abort(){if(this.onabort)this.onabort();}
 }
 const w={Blob,AbortController,FileReader:Reader,AudioContext:settings.audio===false?undefined:Audio,MediaRecorder:settings.recorder===false?undefined:Recorder,URL:{createObjectURL(blob){const u='blob:owned-'+(++allocations);urls.set(u,blob);return u;},revokeObjectURL(url){revoked.push(url);urls.delete(url);}},document:{createElement(tag){return tag==='video'?new Video():canvas();}},
  setTimeout(fn,ms){const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);return t;},clearTimeout(t){timers.delete(t);clearTimeout(t);},
  requestAnimationFrame(fn){const id=++next;frames.set(id,true);setImmediate(()=>{if(!frames.delete(id))return;for(const v of videos)if(!v.paused){v._currentTime=Math.min(v.duration,v._currentTime+0.2);if(v._currentTime>=v.duration){v.ended=true;v.dispatchEvent(new Event('ended'));}}fn();});return id;},cancelAnimationFrame(id){frames.delete(id);}};
 vm.runInNewContext(fs.readFileSync(path.join(ROOT,'www/clip-editor.js'),'utf8'),{window:w,DataView,Uint8Array,WeakMap,AbortController,Error,Object,Number,Promise});
 return{w,api:w.StudioClip,urls,revoked,videos,canvases,recorders,contexts,nodes,timers,frames,get allocations(){return allocations;},get trackStops(){return trackStops;}};
}
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(resolve=>setImmediate(resolve));}throw Error('QA condition not reached');}
async function main(){
 let b=boot();for(const invalid of ['https://evil.test/a.mp4','file:///secret.mp4',{size:3,slice(){}}])await assert.rejects(b.api.open(invalid),/120 MB/);
 const big=file();Object.defineProperty(big,'size',{value:121*1024*1024});await assert.rejects(b.api.open(big),/120 MB/);await assert.rejects(b.api.open(file(Buffer.from('<script>evil</script>'))),/gerçek/);assert.equal(b.allocations,0);
 for(const mutation of ['dimensions','reference','box']){const bytes=Buffer.from(fixtures.mp4);if(mutation==='dimensions'){const at=bytes.indexOf(Buffer.from('avc1'),bytes.indexOf(Buffer.from('stsd')));bytes.writeUInt16BE(16000,at+28);bytes.writeUInt16BE(16000,at+30);}else if(mutation==='reference'){const at=bytes.indexOf(Buffer.from('url '));bytes.writeUInt32BE(0,at+4);}else bytes.writeUInt32BE(0x7fffffff,0);await assert.rejects(b.api.open(file(bytes)),/çözünürlüğü|Harici|başlığı/);assert.equal(b.allocations,0,'Hostile container rejected before blob URL/decoder allocation');}
 const webm=Buffer.from(fixtures.webm),width=webm.indexOf(Buffer.from([0xb0,0x81,0x10]));assert(width>0);webm[width+2]=0;await assert.rejects(b.api.open(file(webm,'bad.webm','video/webm')),/çözünürlüğü/);assert.equal(b.allocations,0);
 await assert.rejects(b.api.open(file(referenceTail(Buffer.from('https://evil.invalid\0')))),/Harici/);assert.equal(b.allocations,0);const emptyReference=await b.api.open(file(referenceTail(Buffer.from([0]))));emptyReference.dispose();
 checks.push('Only bounded local Blob/File MP4/WebM accepted; hostile dimensions, external MP4 references and malformed containers fail before decoder allocation');
 b=boot();let session=await b.api.open(file());assert.equal(session.name,'Haber.mp4');assert.equal(session.width,1280);assert.equal(session.duration,4);for(const raw of [{start:NaN},{end:Infinity},{start:3,end:1},{end:0.1},{rotation:45},{width:4096},{volume:2},{muted:'false'},{ratio:'url'},{text:'A'.repeat(301)}])assert.throws(()=>b.api.normalizeOptions(session,raw));
 const story=b.api.normalizeOptions(session,{start:1,end:3,ratio:'story',width:1080,text:'<img src=x onerror=alert(1)>',textPosition:'middle'});assert.equal(story.width,1080);assert.equal(story.height,1920);assert.equal(story.text,'<img src=x onerror=alert(1)>');assert(Object.isFrozen(story));assert.equal(b.api.draw(b.w.document.createElement('canvas'),session,story),story);
 assert.throws(()=>b.api.normalizeOptions({video:{src:'https://evil.test'}},{}),/Önce/);session.dispose();session.dispose();assert.equal(b.urls.size,0);assert.equal(b.revoked.length,1);assert.throws(()=>b.api.draw({},session,{}),/Önce/);
 checks.push('Trusted sessions, immutable normalized geometry, strict trim/ratio/volume/text ranges, safe literal text and idempotent disposal');
 b=boot({videoWidth:100,videoHeight:3840});session=await b.api.open(file());const narrow=b.api.normalizeOptions(session,{ratio:'original',width:720,muted:true,end:1});assert.equal(narrow.width,50);assert.equal(narrow.height,1920);assert.equal(narrow.presetWidth,720);const copied=JSON.parse(JSON.stringify(narrow));assert.equal(b.api.normalizeOptions(session,copied).width,50);b.api.draw(b.w.document.createElement('canvas'),session,copied);const narrowExport=await b.api.exportClip(session,copied);assert.equal(narrowExport.width,50);assert.equal(narrowExport.height,1920);assert.throws(()=>b.api.normalizeOptions(session,{...copied,width:1000000}));session.dispose();
 checks.push('Extreme valid source aspect ratios keep a validated preset and normalize, draw and export idempotently at bounded output dimensions');
 for(const settings of [{duration:NaN},{duration:301},{videoWidth:10000},{duration:Infinity}]){b=boot(settings);await assert.rejects(b.api.open(file()),/süresi|çözünürlüğü/);assert.equal(b.urls.size,0);assert.equal(b.videos[0].src,'');assert.equal(b.timers.size,0);}
 b=boot({duration:Infinity,resolvedDuration:4});session=await b.api.open(file());assert.equal(session.duration,4);assert.equal(session.video.currentTime,0);session.dispose();
 b=boot({neverMetadata:true});const pending=new AbortController(),opening=b.api.open(file(),{signal:pending.signal});await until(()=>b.allocations===1);pending.abort();await assert.rejects(opening,e=>e.name==='AbortError');assert.equal(b.urls.size,0);assert.equal(b.timers.size,0);
 checks.push('Invalid/nonfinite decoded metadata rejected; bounded unknown-duration recovery resets preview; metadata cancellation revokes URL and clears timeout');
 b=boot();session=await b.api.open(file());const preview=session.video;preview.src='https://malicious.invalid/overridden';const out=await b.api.exportClip(session,{start:1,end:2,ratio:'story',width:720,format:'webm',volume:0.25,text:'Başlık'});assert.equal(out.width,720);assert.equal(out.height,1280);assert.equal(out.duration,1);assert.equal(out.mime,'video/webm');assert.equal(out.name,'Inkreel-Video.webm');assert(out.dataUrl.startsWith('data:video/webm;base64,'));assert.equal(b.videos[1].src,'','Internal export media is cleared');assert.equal(b.contexts.length,1);assert(b.contexts[0].closed);assert.equal(b.nodes[1].gain.value,0.25);assert.equal(b.recorders[0].stream.getAudioTracks().length,1);assert.equal(b.trackStops,2);assert.equal(b.frames.size,0);assert.equal(b.timers.size,0);
 await b.api.exportClip(session,{start:0,end:1,muted:true,format:'mp4',rotation:90});assert.equal(b.contexts.length,1,'Muted repeat export does not allocate audio');assert.equal(b.recorders[1].stream.getAudioTracks().length,0);assert.equal(b.urls.size,1,'Session URL survives export for repeat operations');session.dispose();assert.equal(b.urls.size,0);
 checks.push('Real local session URL kept private from mutated preview; trim/audio gain/rotation work; repeat muted export avoids audio; all recorder/audio/frame resources released');
 b=boot({audio:false});session=await b.api.open(file());await assert.rejects(b.api.exportClip(session,{end:1}),/Sessize al/);await b.api.exportClip(session,{end:1,muted:true});session.dispose();
 b=boot({audioHang:true});session=await b.api.open(file());const c=new AbortController(),job=b.api.exportClip(session,{end:2,signal:c.signal});await until(()=>b.contexts.length===1);c.abort();await assert.rejects(job,e=>e.name==='AbortError');assert(b.contexts[0].closed);assert(b.canvases.filter(c=>c.stream).every(c=>c.stream.getTracks().every(t=>t.readyState==='ended')));assert.equal(b.timers.size,0);session.dispose();
 b=boot();session=await b.api.open(file());const signal=new AbortController();const work=b.api.exportClip(session,{end:3,muted:true,signal:signal.signal,onProgress(value){if(value>0)signal.abort();}});await assert.rejects(b.api.exportClip(session,{end:1,muted:true}),/devam eden/);await assert.rejects(work,e=>e.name==='AbortError');await b.api.exportClip(session,{end:1,muted:true});session.dispose();assert.equal(b.frames.size,0);assert.equal(b.timers.size,0);
 checks.push('Missing audio requires explicit mute; cancellation during audio resume and recording cleans resources, blocks overlap and permits retry');
 b=boot();session=await b.api.open(file());let releaseFonts;b.w.document.fonts={ready:new Promise(resolve=>releaseFonts=resolve)};const fontAbort=new AbortController(),fontJob=b.api.exportClip(session,{end:1,muted:true,text:'Başlık',signal:fontAbort.signal});fontAbort.abort();await assert.rejects(fontJob,e=>e.name==='AbortError');assert.equal(b.recorders.length,0);assert.equal(b.timers.size,0);releaseFonts();await b.api.exportClip(session,{end:1,muted:true,text:'Başlık'});session.dispose();
 checks.push('Font readiness is abortable before recording, and a canceled preparation leaves the session reusable');
 for(const settings of [{constructError:true},{startError:true},{invalidOutput:true},{oversize:true},{playError:true}]){b=boot(settings);session=await b.api.open(file());await assert.rejects(b.api.exportClip(session,{end:1,muted:true}));assert(b.canvases.filter(c=>c.stream).every(c=>c.stream.getTracks().every(t=>t.readyState==='ended')));assert.equal(b.frames.size,0);assert.equal(b.timers.size,0);session.dispose();}
 checks.push('Encoder construction/start, invalid/oversized output and playback failure release tracks, timers and temporary media');
 fs.writeFileSync(path.join(__dirname,'clip-engine-check-results.json'),JSON.stringify({environment:'Controlled media/recorder/audio APIs; real MP4/WebM fixture bytes. Actual codecs tested separately in Chromium.',checks},null,2)+'\n');console.log('PASS:',checks.length,'clip engine security/lifecycle groups');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
