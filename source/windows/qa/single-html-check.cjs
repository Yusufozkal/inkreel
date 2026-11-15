/* Usage: node qa/single-html-check.cjs /path/to/Karevo.html */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {loadImage}=require('@napi-rs/canvas');
const {boot,until,blobBytes}=require('./dom-check.cjs');
(async()=>{
 const htmlPath=path.resolve(process.argv[2]||'');assert(fs.statSync(htmlPath).isFile(),'Pass the self-contained HTML file');
 const text=fs.readFileSync(htmlPath,'utf8'),sourceHtml=fs.readFileSync(path.join(__dirname,'../ui/index.html'),'utf8');assert.equal((text.match(/<script\b/g)||[]).length,(sourceHtml.match(/<script\b/g)||[]).length,'Standalone includes every source script');assert(!/<script[^>]*\bsrc=|<link[^>]*\bhref=/.test(text),'No external script or stylesheet dependency');assert.equal((text.match(/data:font\//g)||[]).length,8);
 const app=boot({native:false,htmlPath,forbidLocalAssets:true}),{$,w,click,input}=app;
 assert([...w.document.images].every(image=>!image.getAttribute('src')||/^(?:data:|blob:)/.test(image.getAttribute('src'))),'Standalone images must not depend on neighboring files');
 await w.StudioApp.ready;await until(()=>app.renders.some(render=>render.canvas.id==='artCanvas'),'standalone startup');const current=app.renders.filter(render=>render.canvas.id==='artCanvas').at(-1);assert.equal(current.canvas.width,1080);assert.equal(current.canvas.height,1350);assert.equal(current.board.state.photo,'');assert.equal(current.media.photo,null);assert.equal(current.board.state.brandName,'MARKANIZ');assert.equal($('templateGrid').querySelectorAll('[data-template]').length,6);
 const results={file:path.basename(htmlPath),bytes:fs.statSync(htmlPath).size,externalResources:false,neutralStartup:true,legacyPhotoEmbedded:true,exports:[],environment:'jsdom + Napi Canvas; no browser or Windows runtime'};
 const legacy=w.StudioApp.getProject();legacy.schema='netice-studio-project';legacy.version=2;legacy.boards[0].state.photo=w.StudioCore.LEGACY_PHOTO;for(const field of ['brandName','brandLabel','tagline','brandMark'])delete legacy.boards[0].state[field];app.upload('projectInput',JSON.stringify(legacy),'Legacy.netice','application/json');await until(()=>app.renders.some(render=>render.canvas.id==='artCanvas'&&render.media.photo),'standalone legacy photo import');assert($('photoPreview').src.startsWith('data:image/'));
 for(const type of ['png','jpeg']){click('exportButton');input('exportScope','current');input('exportType',type);input('exportScale',1);const before=app.downloads.length;click('exportConfirm');await until(()=>app.downloads.length>before&&!$('busyDialog').open,type+' export');const item=app.downloads.at(-1);assert(item.name.endsWith(type==='jpeg'?'.jpg':'.png'));assert.equal(item.blob.type,'image/'+type);const image=await loadImage(blobBytes(item.blob));assert.equal(image.width,1080);assert.equal(image.height,1350);results.exports.push({type,width:image.width,height:image.height,bytes:blobBytes(item.blob).length});}
 assert.deepEqual(app.messages,[]);await app.close();fs.writeFileSync(path.join(__dirname,'single-html-check-results.json'),JSON.stringify(results,null,2)+'\n');console.log('PASS: actual self-contained HTML neutral startup, legacy embedded photo import and valid 1080×1350 PNG/JPEG exports.');
})().catch(error=>{console.error(error);process.exitCode=1;setTimeout(()=>process.exit(1),150).unref();});
