/* Inkreel — local, silent animated news exports via the browser encoder. */
(function (global) {
  'use strict';
  var MAX_BYTES = 40 * 1024 * 1024;
  var active = false;
  var CANDIDATES = [
    {id:'mp4',label:'MP4 · sessiz',types:['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001E','video/mp4']},
    {id:'webm',label:'WebM · sessiz',types:['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']}
  ];
  function inspectCapabilities() {
    var recorder = global.MediaRecorder, canvas = global.document && global.document.createElement('canvas');
    if (!canvas || typeof canvas.captureStream !== 'function' || !recorder || typeof recorder.isTypeSupported !== 'function') {
      return {supported:false,formats:[],reason:'Bu ortam video kodlamayı desteklemiyor. Güncel masaüstü uygulamasını veya Chrome/Edge kullanın.'};
    }
    var formats = [];
    CANDIDATES.forEach(function (candidate) {
      var mime = candidate.types.find(function (type) {
        try { return recorder.isTypeSupported(type); } catch (_) { return false; }
      });
      if (mime) formats.push({id:candidate.id,mime:mime,label:candidate.label});
    });
    return {supported:formats.length>0,formats:formats,reason:formats.length ? undefined : 'Bu ortamda kullanılabilir MP4 veya WebM kodlayıcısı bulunamadı.'};
  }
  function abortError() {
    var error = new Error('Video dışa aktarma iptal edildi.'); error.name = 'AbortError'; return error;
  }
  function throwIfAborted(signal) { if (signal && signal.aborted) throw abortError(); }
  function abortable(promise, signal) {
    if (!signal) return promise;
    return new Promise(function (resolve,reject) {
      function abort() { cleanup(); reject(abortError()); }
      function cleanup() { signal.removeEventListener('abort',abort); }
      if (signal.aborted) return abort();
      signal.addEventListener('abort',abort,{once:true});
      Promise.resolve(promise).then(function(value){cleanup();resolve(value);},function(error){cleanup();reject(error);});
    });
  }
  function readBlob(blob, method, signal) {
    return new Promise(function (resolve,reject) {
      var reader = new global.FileReader();
      function cleanup() { if(signal)signal.removeEventListener('abort',abort);reader.onload=reader.onerror=reader.onabort=null; }
      function abort() { try { reader.abort(); } catch (_) {} cleanup(); reject(abortError()); }
      reader.onload=function(){var value=reader.result;cleanup();resolve(value);};
      reader.onerror=function(){var error=reader.error||new Error('Video dosyası okunamadı.');cleanup();reject(error);};
      reader.onabort=function(){cleanup();reject(abortError());};
      if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
      reader[method](blob);
    });
  }
  function isContainer(bytes, format) {
    if(format==='webm')return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
    return bytes.length>=12&&bytes[4]===0x66&&bytes[5]===0x74&&bytes[6]===0x79&&bytes[7]===0x70;
  }
  function number(value,fallback) { var n=Number(value);return Number.isFinite(n)?n:fallback; }
  function ease(value) { value=Math.max(0,Math.min(1,value));return value*value*(3-2*value); }
  function now() { return global.performance && global.performance.now ? global.performance.now() : Date.now(); }
  async function record(options) {
    options=options||{};
    if(active)throw new Error('Önce devam eden video dışa aktarmasını tamamlayın.');
    var capability=inspectCapabilities();
    if(!capability.supported)throw new Error(capability.reason);
    var format=options.format||capability.formats[0].id;
    var encoding=capability.formats.find(function(item){return item.id===format;});
    if(!encoding)throw new Error(format==='mp4'?'Bu ortam MP4 kodlamayı desteklemiyor. WebM biçimini seçin.':'Seçilen video biçimi desteklenmiyor.');
    if(!global.DesktopRenderer||typeof global.DesktopRenderer.render!=='function')throw new Error('Tasarım çizicisi yüklenemedi.');
    if(!options.board||typeof options.board!=='object')throw new Error('Video için bir çalışma alanı seçin.');
    var board=JSON.parse(JSON.stringify(options.board)),media=options.media||{},signal=options.signal;
    var duration=Math.max(5,Math.min(15,number(options.duration,8))),width=Number(options.width)===1080?1080:720,fps=24;
    var preset=['zoom','slide','fade'].indexOf(options.preset)>=0?options.preset:'zoom';
    var formatInfo=global.DesktopRenderer.formats[board.state&&board.state.format]||global.DesktopRenderer.formats.portrait;
    var height=Math.round(width*formatInfo.height/formatInfo.width/2)*2;
    var scale=width/formatInfo.width,canvas,plate,stream,recorder,tracksStopped=false,rafId=null,frameTimer=null,deadline=null,stopTimer=null;
    var progress=typeof options.onProgress==='function'?options.onProgress:function(){};
    var create=typeof options.factory==='function'?options.factory:function(){return global.document.createElement('canvas');};
    var mime='video/'+format,baseZoom=Math.max(0.3,number(board.state&&board.state.photoZoom,1));
    function report(value) { try { progress(Math.max(0,Math.min(1,value))); } catch (_) {} }
    function stopTracks() {
      if(!stream||tracksStopped)return;tracksStopped=true;
      stream.getTracks().forEach(function(track){try{track.stop();}catch(_){}});
    }
    function cleanup() {
      if(rafId!==null&&global.cancelAnimationFrame)global.cancelAnimationFrame(rafId);
      if(frameTimer!==null)global.clearTimeout(frameTimer);
      if(deadline!==null)global.clearTimeout(deadline);
      if(stopTimer!==null)global.clearTimeout(stopTimer);
      stopTracks();
      if(canvas){canvas.width=canvas.height=1;}
      if(plate&&plate!==canvas){plate.width=plate.height=1;}
    }
    active=true;
    try {
      throwIfAborted(signal);
      if(global.document.fonts&&global.document.fonts.ready)await abortable(global.document.fonts.ready,signal);
      throwIfAborted(signal);
      canvas=create('record');plate=create('render');
      if(!canvas||!plate||canvas===plate||typeof canvas.captureStream!=='function')throw new Error('Video tuvali oluşturulamadı.');
      canvas.width=width;canvas.height=height;
      var context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Video çizim alanı açılamadı.');
      var result=global.DesktopRenderer.render(plate,board,media,{scale:scale});
      if(result.overflow||result.baseOverflow||result.layerOverflow)throw new Error('Videodan önce taşan metni kısaltın veya yazı boyutunu küçültün.');
      var background=board.state&&/^#[0-9a-f]{6}$/i.test(board.state.background)?board.state.background:'#101b2d';
      function draw(t) {
        t=Math.max(0,Math.min(1,t));
        if(preset==='zoom') {
          board.state=board.state||{};board.state.photoZoom=baseZoom*(1+0.08*ease(t));
          global.DesktopRenderer.render(plate,board,media,{scale:scale});
        }
        context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;
        context.fillStyle=background;context.fillRect(0,0,width,height);
        var seconds=t*duration,opacity=1,x=0;
        if(preset==='slide') {var opening=ease(seconds/0.65);opacity=opening;x=width*0.035*(1-opening);}
        else if(preset==='fade')opacity=Math.min(ease(seconds/0.65),ease((duration-seconds)/0.65));
        context.globalAlpha=opacity;context.drawImage(plate,x,0,width,height);context.globalAlpha=1;
      }
      draw(0);stream=canvas.captureStream(fps);
      if(!stream||!stream.getVideoTracks||!stream.getVideoTracks().length)throw new Error('Video kayıt akışı başlatılamadı.');
      try { recorder=new global.MediaRecorder(stream,{mimeType:encoding.mime,videoBitsPerSecond:Math.min(12000000,Math.max(3500000,Math.round(width*height*fps*0.18)))}); }
      catch (_) { throw new Error('Video kodlayıcısı başlatılamadı. Daha düşük çözünürlük veya diğer biçimi deneyin.'); }
      var blob=await new Promise(function(resolve,reject) {
        var chunks=[],bytes=0,settled=false,stopping=false,problem=null,start=0,lastFrame=-Infinity;
        function detach() {
          if(signal)signal.removeEventListener('abort',abort);
          recorder.ondataavailable=recorder.onerror=recorder.onstop=null;
        }
        function finish(error,value) {
          if(settled)return;settled=true;detach();
          if(error)reject(error);else resolve(value);
        }
        function stop(error) {
          if(settled)return;if(error&&!problem)problem=error;
          if(stopping)return;stopping=true;
          if(rafId!==null&&global.cancelAnimationFrame)global.cancelAnimationFrame(rafId);
          if(frameTimer!==null)global.clearTimeout(frameTimer);
          if(deadline!==null)global.clearTimeout(deadline);
          stopTimer=global.setTimeout(function(){finish(problem||new Error('Video kodlayıcısı yanıt vermedi. Yeniden deneyin.'));},5000);
          try {if(recorder.state!=='inactive')recorder.stop();else finish(problem||new Error('Video kaydı beklenmedik şekilde durdu.'));}
          catch(error){finish(problem||error);}
        }
        function abort(){stop(abortError());}
        function tick() {
          if(settled||stopping)return;
          try {
            var elapsed=now()-start;
            if(elapsed-lastFrame>=1000/fps-1||elapsed>=duration*1000){
              draw(elapsed/(duration*1000));lastFrame=elapsed;
              stream.getVideoTracks().forEach(function(track){if(typeof track.requestFrame==='function')track.requestFrame();});
              report(elapsed/(duration*1000));
            }
            if(settled||stopping)return;
            if(elapsed>=duration*1000){stop();return;}
            if(global.requestAnimationFrame)rafId=global.requestAnimationFrame(tick);
            else frameTimer=global.setTimeout(tick,1000/fps);
          }catch(error){stop(error);}
        }
        recorder.ondataavailable=function(event) {
          if(settled||!event.data||!event.data.size)return;
          bytes+=event.data.size;
          if(bytes>MAX_BYTES){stop(new Error('Video 40 MB sınırını aştı. Süreyi veya çözünürlüğü azaltın.'));return;}
          chunks.push(event.data);
        };
        recorder.onerror=function(event){stop(event.error||new Error('Video kodlaması sırasında hata oluştu.'));};
        recorder.onstop=function(){
          if(problem)return finish(problem);
          if(!bytes)return finish(new Error('Kodlayıcı boş bir video üretti. Diğer biçimi veya güncel Chrome/Edge sürümünü deneyin.'));
          finish(null,new global.Blob(chunks,{type:mime}));
        };
        if(signal){if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});}
        try {
          recorder.start(500);start=now();report(0);
          deadline=global.setTimeout(function(){stop(new Error('Video kaydı zamanında tamamlanamadı. Bu pencere açıkken yeniden deneyin.'));},duration*1000+12000);
          if(global.requestAnimationFrame)rafId=global.requestAnimationFrame(tick);else frameTimer=global.setTimeout(tick,1000/fps);
        }catch(error){finish(new Error('Video kaydı başlatılamadı: '+(error.message||error)));}
      });
      stopTracks();
      throwIfAborted(signal);
      var header=new Uint8Array(await readBlob(blob.slice(0,64),'readAsArrayBuffer',signal));
      if(!isContainer(header,format))throw new Error('Kodlayıcı seçilen biçimde geçerli bir video üretmedi. Diğer biçimi deneyin.');
      var dataUrl=await readBlob(blob,'readAsDataURL',signal);
      throwIfAborted(signal);report(1);
      return {blob:blob,dataUrl:dataUrl,mime:mime,width:width,height:height,duration:duration,name:'Inkreel-'+width+'x'+height+'.'+format};
    } finally {
      if(recorder&&recorder.state!=='inactive'){try{recorder.stop();}catch(_){}}
      cleanup();active=false;
    }
  }
  global.StudioVideo={inspectCapabilities:inspectCapabilities,record:record};
})(typeof window!=='undefined'?window:globalThis);
