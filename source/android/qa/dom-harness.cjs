/* Android DOM test harness. Real Canvas; Android Java bridge mocked; no device automation. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {createCanvas,Image,GlobalFonts,loadImage}=require('@napi-rs/canvas');
const ui=path.resolve(__dirname,'../www');
for(const [name,family]of [['font-0.woff2','Barlow Condensed'],['font-1.woff2','Barlow Condensed'],['font-2.woff2','Barlow Condensed'],['font-3.woff2','Manrope'],['font-4.woff2','Manrope'],['font-5.woff2','Manrope'],['font-6.woff2','Manrope'],['font-7.woff2','Manrope']])GlobalFonts.registerFromPath(path.join(ui,'assets',name),family);
const database=new IDBFactory();
const report={environment:'jsdom22 + fake-indexeddb + Napi Canvas; Android Java bridge mocked; no Android/WebView or real codec execution',checks:[],errors:[]};
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function until(predicate,label,ms=7000){const start=Date.now();while(!predicate()){if(Date.now()-start>ms)throw Error('Timed out: '+label);await tick();}}
function blobBytes(blob){if(Buffer.isBuffer(blob))return blob;if(blob&&blob._buffer)return blob._buffer;for(const key of Object.getOwnPropertySymbols(blob||{})){const value=blob[key];if(value&&Buffer.isBuffer(value._buffer))return value._buffer;}throw Error('Mock blob has no byte buffer');}
function boot({native=true,local={},htmlPath=path.join(ui,'index.html'),forbidLocalAssets=false,setupNative=require('./android-native-mock.cjs'),setupWindow=()=>{},width=390,height=844}={}){
 const messages=[],vc=new VirtualConsole();vc.on('jsdomError',e=>messages.push(e.message));
 const dom=new JSDOM(fs.readFileSync(htmlPath,'utf8'),{url:'https://bulten.test/index.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,canvasMap=new WeakMap(),contextMap=new WeakMap(),objectUrls=new Map(),downloads=[],calls=[],renders=[],pendingWrites=new Set();let serial=0,openJson=null,lastCompletedWrite=null;
 Object.defineProperty(w,'indexedDB',{value:database});Object.defineProperty(w.document,'fonts',{value:{ready:Promise.resolve(),load:()=>Promise.resolve([])}});
 Object.defineProperty(w,'innerWidth',{value:width,writable:true,configurable:true});Object.defineProperty(w,'innerHeight',{value:height,writable:true,configurable:true});w.structuredClone=global.structuredClone;w.TextEncoder=global.TextEncoder;w.TextDecoder=global.TextDecoder;w.matchMedia=query=>({matches:query.includes('max-width')&&width<=Number((query.match(/max-width:\s*(\d+)/)||[])[1]||0),media:query,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}};w.confirm=()=>true;w.prompt=(_question,value)=>value||'QA';
 for(const [key,value]of Object.entries(local))w.localStorage.setItem(key,value);
 w.URL.createObjectURL=blob=>{const url='blob:qa-'+(++serial);objectUrls.set(url,blob);return url;};w.URL.revokeObjectURL=url=>objectUrls.delete(url);
 class LocalImage extends Image{set src(source){let data=source;if(objectUrls.has(source))data=blobBytes(objectUrls.get(source));else if(typeof source==='string'&&!source.startsWith('data:')){if(forbidLocalAssets)throw Error('Single HTML requested external image: '+source);const clean=source.replace(/^https:\/\/bulten\.test\//,'').replace(/^bulten:\/\/app\//,'');data=fs.readFileSync(path.join(ui,clean));}super.src=data;}get src(){return super.src;}}
 w.Image=LocalImage;
 function nativeCanvas(el){let canvas=canvasMap.get(el);if(!canvas){canvas=createCanvas(Number(el.getAttribute('width'))||300,Number(el.getAttribute('height'))||150);canvasMap.set(el,canvas);}return canvas;}
 for(const dimension of ['width','height'])Object.defineProperty(w.HTMLCanvasElement.prototype,dimension,{get(){return Number(this.getAttribute(dimension))||(dimension==='width'?300:150);},set(value){this.setAttribute(dimension,String(value));if(canvasMap.has(this))nativeCanvas(this)[dimension]=Number(value);},configurable:true});
 w.HTMLCanvasElement.prototype.getContext=function(type){assert.equal(type,'2d');if(!contextMap.has(this)){const c=nativeCanvas(this).getContext('2d');contextMap.set(this,new Proxy(c,{get(target,key){if(key==='drawImage')return(image,...args)=>target.drawImage(image instanceof w.HTMLCanvasElement?nativeCanvas(image):image,...args);const value=target[key];return typeof value==='function'?value.bind(target):value;},set(target,key,value){target[key]=value;return true;}}));}return contextMap.get(this);};
 w.HTMLCanvasElement.prototype.toDataURL=function(type='image/png',quality){return nativeCanvas(this).toDataURL(type,quality);};
 w.HTMLCanvasElement.prototype.toBlob=function(callback,type='image/png',quality=.96){const data=nativeCanvas(this).toBuffer(type,type==='image/png'?undefined:Math.round(quality*100));queueMicrotask(()=>callback(new w.Blob([data],{type})));};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:Math.max(280,width-32),bottom:height-180,width:Math.max(280,width-32),height:height-180};};
 Object.defineProperty(w.HTMLElement.prototype,'clientWidth',{get(){return Math.max(280,width-32);},configurable:true});Object.defineProperty(w.HTMLElement.prototype,'clientHeight',{get(){return height-180;},configurable:true});
 w.HTMLCanvasElement.prototype.setPointerCapture=function(){};w.HTMLCanvasElement.prototype.releasePointerCapture=function(){};
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 w.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,url:this.href,blob:objectUrls.get(this.href)});};
 w.Blob.prototype.arrayBuffer=async function(){const data=blobBytes(this);return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);};w.Blob.prototype.text=async function(){return blobBytes(this).toString('utf8');};
 const nativeState=native&&setupNative?setupNative(w,calls,{getOpenJson:()=>openJson,getCompletedWrite:()=>lastCompletedWrite}):null;
 setupWindow(w);
 w.addEventListener('error',event=>messages.push(event.message));
 for(const script of w.document.querySelectorAll('script')){
  const name=script.getAttribute('src'),code=name?fs.readFileSync(path.join(ui,name),'utf8'):script.textContent;w.eval(code);
  // Delay storage writes so an early native close acknowledgement is observable.
  if(name==='core.js'||code.includes("const SCHEMA = 'bulten-studio-project'")){const core=w.StudioCore;w.StudioCore=Object.freeze({...core,openDatabase:async()=>{const db=await core.openDatabase();return{...db,put:(key,value)=>{const operation=(async()=>{await new Promise(resolve=>setTimeout(resolve,30));await db.put(key,value);lastCompletedWrite={key,value:structuredClone(value)};})();pendingWrites.add(operation);operation.then(()=>pendingWrites.delete(operation),()=>pendingWrites.delete(operation));return operation;}};}});}
  if(w.DesktopRenderer&&!w.DesktopRenderer.__qaWrapped){const original=w.DesktopRenderer.render;w.DesktopRenderer.render=(canvas,board,media,options)=>{const result=original(canvas,board,media,options);renders.push({canvas,board:structuredClone(board),media,result});return result;};w.DesktopRenderer.__qaWrapped=true;}
 }
 const $=id=>w.document.getElementById(id),click=target=>{const el=typeof target==='string'?$(target):target;assert(el,'Missing click target '+target);el.focus();el.click();return el;},input=(id,value)=>{const el=$(id);assert(el,'Missing field '+id);el.focus();if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new w.Event(el.type==='checkbox'||el.tagName==='SELECT'?'change':'input',{bubbles:true}));return el;};
 const file=(bytes,name='fixture.png',type='image/png')=>{const item=new w.File([bytes],name,{type});item._buffer=Buffer.from(bytes);return item;};
 const upload=(id,bytes,name,type)=>{const el=$(id);assert(el,'Missing file input '+id);Object.defineProperty(el,'files',{value:[file(bytes,name,type)],configurable:true});el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const keyboard=(key,options={})=>w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
 return{dom,w,$,click,input,upload,keyboard,nativeState,calls,renders,messages,downloads,objectUrls,nativeCanvas,setOpenJson:json=>openJson=json,close:async()=>{while(pendingWrites.size)await Promise.all([...pendingWrites]);await Promise.resolve();nativeState?.close();dom.window.close();}};
}
module.exports={boot,until,blobBytes,createCanvas,report};
