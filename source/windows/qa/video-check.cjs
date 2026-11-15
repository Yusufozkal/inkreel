/* Video lifecycle tests: real canvas renderer, controlled clock, mocked encoder.
 * The embedded one-frame MP4/WebM payloads are fixtures, not browser codec tests. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const ui=path.resolve(__dirname,'../ui');
const checks=[];
for(let i=0;i<8;i++)GlobalFonts.registerFromPath(path.join(ui,'assets',`font-${i}.woff2`),i<3?'Barlow Condensed':'Manrope');
const fixtures={};
fixtures.mp4=Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMObW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGxbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABXG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARxzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MS4xOS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABRgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAKMAAAAAQAAABRzdGNvAAAAAAAAAAEAAAM+AAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2MS43LjEwMwAAAAhmcmVlAAAClG1kYXQAAAJwBgX//2zcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFGWIhAV8RigADqDHAAGwaOAAI0OA','base64');
fixtures.webm=Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHzEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggHd7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIhhrXvTOxnIGcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4Q7msoA4JCwgRC6gRCagQJVsIRVuYEBElTDZ0B/c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS43LjEwM3Nz2mPAi2PFiIYa170zsZyBZ8ilRaOHRU5DT0RFUkSHmExhdmM2MS4xOS4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnWw54EAo6uBAACAgkmDQgAA8AD2ADgkHBhKAAAwYAAAGH///ghY/////5Cgf///X/AAHFO7a5G7j7OBALeK94EB8YIBqPCBAw==','base64');
function boot(settings={}) {
  let time=0,nextRaf=0,rafCanceled=0,trackStops=0,reads=0;
  const pending=new Map(),canvases=[],recorders=[],renders=[],draws=[],progress=[];
  class Reader {
    constructor(){this.result=null;this.error=null;this.aborted=false;}
    readAsArrayBuffer(blob){reads++;blob.arrayBuffer().then(value=>{if(!this.aborted){this.result=value;if(this.onload)this.onload();}});}
    readAsDataURL(blob){reads++;blob.arrayBuffer().then(value=>{if(!this.aborted){this.result='data:'+blob.type+';base64,'+Buffer.from(value).toString('base64');if(this.onload)this.onload();}});}
    abort(){this.aborted=true;if(this.onabort)this.onabort();}
  }
  function create(role='capability') {
    const canvas=createCanvas(1,1),original=canvas.getContext.bind(canvas);
    canvas.getContext=(type,options)=>{
      const c=original(type,options);
      if(role!=='record')return c;
      return new Proxy(c,{get(target,key){
        if(key==='drawImage')return(image,...args)=>{draws.push({x:args[0],alpha:target.globalAlpha});target.drawImage(image,...args);};
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      },set(target,key,value){target[key]=value;return true;}});
    };
    if(settings.capture!==false)canvas.captureStream=fps=>{
      const track={readyState:'live',requestFrame(){},stop(){if(this.readyState!=='ended'){trackStops++;this.readyState='ended';}}};
      const stream={fps,getTracks:()=>[track],getVideoTracks:()=>[track]};canvas.stream=stream;return stream;
    };
    canvases.push(canvas);return canvas;
  }
  class Recorder {
    static isTypeSupported(type){if(settings.throwCapability)throw Error('Not implemented');return (settings.supported||['video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9']).includes(type);}
    constructor(stream,options){if(settings.constructError)throw Error('Encoder unavailable');this.stream=stream;this.options=options;this.state='inactive';recorders.push(this);}
    start(interval){if(settings.startError)throw Error('Cannot start');this.state='recording';this.interval=interval;}
    stop(){
      if(this.state==='inactive')return;
      this.state='inactive';
      if(settings.neverStop)return;
      const isMp4=this.options.mimeType.startsWith('video/mp4');
      const bytes=settings.invalid?Buffer.from('not a real video'):fixtures[isMp4?'mp4':'webm'];
      // onstop follows the final dataavailable event, as real MediaRecorder specifies.
      queueMicrotask(()=>{
        if(settings.encoderError&&this.onerror)this.onerror({error:Error('Encoder failed')});
        if(!settings.empty&&this.ondataavailable){
          if(settings.oversize)this.ondataavailable({data:{size:41*1024*1024}});
          else {const split=Math.floor(bytes.length/2);this.ondataavailable({data:new Blob([bytes.subarray(0,split)],{type:this.options.mimeType})});
            if(this.ondataavailable)this.ondataavailable({data:new Blob([bytes.subarray(split)],{type:this.options.mimeType})});}
        }
        if(this.onstop)this.onstop();
      });
    }
  }
  const w={document:{createElement:()=>create(),fonts:{ready:Promise.resolve()}},MediaRecorder:settings.recorder===false?undefined:Recorder,
    Blob,FileReader:Reader,performance:{now:()=>time},setTimeout,clearTimeout,
    requestAnimationFrame(callback){const id=++nextRaf;pending.set(id,true);setImmediate(()=>{if(!pending.delete(id))return;time+=settings.step||400;callback(time);});return id;},
    cancelAnimationFrame(id){if(pending.delete(id))rafCanceled++;}};
  const sandbox={window:w};vm.createContext(sandbox);
  for(const name of ['base-render.js','desktop-render.js','video.js'])vm.runInContext(fs.readFileSync(path.join(ui,name),'utf8'),sandbox,{filename:name});
  const originalRender=w.DesktopRenderer.render;
  w.DesktopRenderer.render=(canvas,board,media,options)=>{
    renders.push(JSON.parse(JSON.stringify(board)));
    if(settings.overflow)return{overflow:true};
    return originalRender(canvas,board,media,options);
  };
  const board={id:'test-board',name:'Video testi',state:{template:'odak',format:'portrait',headline:'Şehrin yeni\nbuluşma noktası',photoZoom:1.2,showFooter:true,showBrand:true,source:'Örnek içerik',brandName:'Örnek Marka',brandTagline:'Günün gündemi',background:'#162438'},layers:[{id:'title',type:'text',text:'Yerel gündem',x:100,y:300,w:600,h:140,fontSize:60,color:'#ffffff'}]};
  return{w,api:w.StudioVideo,create,board,canvases,recorders,renders,draws,progress,get trackStops(){return trackStops;},get rafCanceled(){return rafCanceled;},get pending(){return pending.size;},get reads(){return reads;}};
}
async function rejected(settings,pattern,options={}) {
  const app=boot(settings);
  await assert.rejects(app.api.record({board:app.board,media:{},factory:app.create,duration:5,...options}),pattern);
  assert(app.canvases.filter(c=>c.stream).every(c=>c.width===1&&c.height===1),'Failed export releases canvases');
  assert(app.canvases.filter(c=>c.stream).every(c=>c.stream.getTracks().every(t=>t.readyState==='ended')),'Failed export releases tracks');
  return app;
}
async function main(){
  for(const settings of [{recorder:false},{capture:false},{supported:[]},{throwCapability:true}]){
    const app=boot(settings);assert.equal(app.api.inspectCapabilities().supported,false);assert.equal(app.api.inspectCapabilities().formats.length,0);
  }
  checks.push('Missing capture/recorder/codecs and throwing capability probes report an honest unsupported state');
  let app=boot({supported:['video/webm;codecs=vp8']});
  let capabilities=app.api.inspectCapabilities();assert.deepEqual(Array.from(capabilities.formats,f=>f.id),['webm']);assert.equal(capabilities.formats[0].mime,'video/webm;codecs=vp8');
  await assert.rejects(app.api.record({board:app.board,format:'mp4'}),/MP4/);
  app=boot({supported:['video/mp4']});assert.equal(app.api.inspectCapabilities().formats[0].mime,'video/mp4');
  checks.push('MP4 is offered only when supported, plain MP4 and VP8 fallbacks are selected correctly');

  app=boot();const original=structuredClone(app.board);
  const mp4=await app.api.record({board:app.board,media:{},format:'mp4',duration:5,width:720,fps:24,preset:'zoom',factory:app.create,onProgress:value=>app.progress.push(value)});
  assert.equal(mp4.mime,'video/mp4');assert.equal(mp4.width,720);assert.equal(mp4.height,900);assert.equal(mp4.duration,5);assert(mp4.name.endsWith('.mp4'));
  assert.equal(mp4.blob.type,'video/mp4');assert(mp4.dataUrl.startsWith('data:video/mp4;base64,'));
  assert(Buffer.from(await mp4.blob.arrayBuffer()).equals(fixtures.mp4),'Final chunks assemble the actual MP4 fixture');
  assert.deepEqual(app.board,original,'Recording leaves original board/layers unchanged');
  assert.equal(app.recorders[0].stream.fps,24);assert.equal(app.recorders[0].interval,500);assert.equal(app.recorders[0].options.mimeType,'video/mp4;codecs=avc1.42E01E');
  assert(app.renders.some(b=>b.state.photoZoom>1.2),'Photo zoom animates');assert.equal(app.renders.at(-1).state.photoZoom,1.2*1.08);
  assert.equal(app.progress[0],0);assert.equal(app.progress.at(-1),1);assert(app.progress.every((n,i)=>i===0||n>=app.progress[i-1]));
  assert.equal(app.trackStops,1);assert.equal(app.pending,0);assert(app.canvases.filter(c=>c.stream).every(c=>c.width===1&&c.height===1));
  checks.push('MP4 waits for final chunks, preserves the board, animates photo zoom, reports monotonic progress and releases resources');

  app=boot({supported:['video/webm;codecs=vp9']});app.board.state.format='landscape';
  const webm=await app.api.record({board:app.board,format:'webm',duration:10,width:1080,preset:'slide',factory:app.create});
  assert.equal(webm.width,1080);assert.equal(webm.height,608);assert.equal(webm.duration,10);assert.equal(webm.mime,'video/webm');assert(webm.name.endsWith('.webm'));
  assert(Buffer.from(await webm.blob.arrayBuffer()).equals(fixtures.webm));assert(webm.dataUrl.startsWith('data:video/webm;base64,'));
  assert(app.draws.some(frame=>frame.x>0&&frame.alpha>0&&frame.alpha<1));assert.equal(app.draws.at(-1).x,0);assert.equal(app.draws.at(-1).alpha,1);
  checks.push('WebM uses its real container and the slide opener retains the selected landscape aspect ratio with even encoder dimensions');

  app=boot();app.board.state.format='story';
  const fade=await app.api.record({board:app.board,format:'mp4',duration:99,width:1080,preset:'fade',factory:app.create});
  assert.equal(fade.duration,15);assert.equal(fade.width,1080);assert.equal(fade.height,1920);assert.equal(app.draws[0].alpha,0);assert.equal(app.draws.at(-1).alpha,0);assert(app.draws.some(frame=>frame.alpha===1));
  checks.push('Fade opens and closes over an opaque background; story output is 1080×1920 and duration is capped at 15 seconds');

  await rejected({constructError:true},/kodlayıcısı/);await rejected({startError:true},/başlatılamadı/);await rejected({encoderError:true},/Encoder failed/);await rejected({empty:true},/boş/);await rejected({invalid:true},/geçerli/);await rejected({oversize:true},/40 MB/);await rejected({overflow:true},/taşan metni/);
  checks.push('Constructor/start errors, empty or invalid containers, oversize video and text overflow fail with cleanup');

  app=boot();const controller=new AbortController();let first=true;
  await assert.rejects(app.api.record({board:app.board,format:'mp4',duration:5,factory:app.create,signal:controller.signal,onProgress:value=>{if(value>0&&first){first=false;controller.abort();}}}),error=>error.name==='AbortError');
  assert.equal(app.trackStops,1);assert.equal(app.pending,0);assert.equal(app.reads,0);
  const again=await app.api.record({board:app.board,format:'mp4',duration:5,factory:app.create});assert(again.blob.size>0,'New export succeeds after cancellation');
  checks.push('Cancel stops tracks and frame scheduling; a new export succeeds after cancellation');

  app=boot();const early=new AbortController();early.abort();
  await assert.rejects(app.api.record({board:app.board,signal:early.signal}),error=>error.name==='AbortError');assert.equal(app.recorders.length,0);
  const pending=app.api.record({board:app.board,format:'mp4',duration:5,factory:app.create});
  await assert.rejects(app.api.record({board:app.board}),/devam eden/);await pending;
  checks.push('Pre-abort creates no recorder and concurrent exports are blocked');
  app=boot();app.w.document.fonts.ready=new Promise(()=>{});const waiting=new AbortController();
  const waitingExport=app.api.record({board:app.board,signal:waiting.signal,factory:app.create});waiting.abort();
  await assert.rejects(waitingExport,error=>error.name==='AbortError');assert.equal(app.recorders.length,0);
  app.w.document.fonts.ready=Promise.resolve();await app.api.record({board:app.board,duration:0,factory:app.create});
  assert.equal(app.recorders.length,1,'The active export guard resets after fonts-ready cancellation');
  checks.push('Cancellation while waiting for fonts frees the export guard before any stream or encoder is created');
  const report={environment:'Napi Canvas + real desktop renderer; mocked MediaRecorder, controlled animation clock. Codec fixtures are valid one-frame FFmpeg files. No browser codec or Windows execution.',checks};
  fs.writeFileSync(path.join(__dirname,'video-check-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log('All',checks.length,'video lifecycle checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
