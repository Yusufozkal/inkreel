'use strict';
// Java @JavascriptInterface boundary mock. The production JS adapter is loaded unchanged.
module.exports=function setupNative(w,calls,state){
 const results=new Map(),timers=new Set();
 function reply(id,value){w.StudioAndroidResult({...value,id});}
 w.KarevoAndroid={
  request(action,payloadJson,id){
   const payload=JSON.parse(payloadJson);const entry={action,payload,id};
   const names={'info':'getInfo','save-project':'saveProject','open-project':'openProject','save-image':'saveImage','export-images':'exportImages','save-text':'saveText','copy-text':'copyText','save-video':'saveVideo','share-image':'shareImage'};
   Object.assign(entry,payload,{method:names[action]||action});calls.push(entry);
   const timer=setTimeout(()=>{timers.delete(timer);let result;
    if(results.has(action)){result=results.get(action);results.delete(action);}
    else if(action==='info')result={ok:true,platform:'android',version:'3.3.0'};
    else if(action==='open-project')result=state.getOpenJson()?{ok:true,json:state.getOpenJson(),name:'QA.inkreel'}:{ok:false,canceled:true};
    else if(action==='export-images')result={ok:true,count:payload.items.length,folder:'Pictures/Inkreel'};
    else result={ok:true,name:payload.name,count:1,folder:'Pictures/Inkreel'};
    reply(id,result);
   },10);timers.add(timer);
  },
  finishClose(saved,requestId){calls.push({method:'finishClose',action:'finish-close',saved,requestId,completedWrite:state.getCompletedWrite()&&structuredClone(state.getCompletedWrite())});}
 };
 return{next(action,result){results.set(action,result);},reply,close(){for(const timer of timers)clearTimeout(timer);timers.clear();}};
};
