/* Karevo — format-aware composition and editable canvas layers. */
(function (global) {
  'use strict';
  var FORMATS = {
    portrait: {width:1080,height:1350,label:'Instagram · 4:5'},
    square: {width:1080,height:1080,label:'Instagram · 1:1'},
    story: {width:1080,height:1920,label:'Hikâye · 9:16'},
    landscape: {width:1920,height:1080,label:'Yatay · 16:9'}
  };
  var TEMPLATES = ['odak','manset','sade','serit','bulten','alinti'];
  var MAX_LAYERS = 30;
  function core() {
    var renderer=global.StudioBaseRenderer||global.NeticeRenderer;
    if (!renderer || !renderer.drawing) throw new Error('base-render.js must load before desktop-render.js');
    return renderer;
  }
  function dimensions(image) { return {w:image && (image.naturalWidth || image.width) || 0,h:image && (image.naturalHeight || image.height) || 0}; }
  function geometry(layer) {
    var d=core().drawing;
    return {id:layer.id,x:d.number(layer.x,0),y:d.number(layer.y,0),w:Math.max(1,d.number(layer.w,400)),
      h:Math.max(1,d.number(layer.h,150)),rotation:d.number(layer.rotation,0),opacity:d.clamp(d.number(layer.opacity,1),0,1),
      visible:layer.visible!==false,locked:layer.locked===true,overflow:false};
  }
  function reset(canvas, width, height, scale) {
    var pixelW=Math.round(width*scale),pixelH=Math.round(height*scale);
    if(canvas.width!==pixelW)canvas.width=pixelW;
    if(canvas.height!==pixelH)canvas.height=pixelH;
    var c=canvas.getContext('2d'); c.setTransform(scale,0,0,scale,0,0);
    c.textAlign='left'; c.textBaseline='alphabetic'; c.globalAlpha=1;
    c.globalCompositeOperation='source-over';c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetX=0;c.shadowOffsetY=0;
    if('filter'in c)c.filter='none';c.lineWidth=1;c.setLineDash([]);
    c.imageSmoothingEnabled=true; if ('imageSmoothingQuality' in c) c.imageSmoothingQuality='high';
    if ('letterSpacing' in c) c.letterSpacing='0px';
    return c;
  }
  function footer(c,s,W,H,x,ink,story) {
    if (!s.showFooter) return;
    var d=core().drawing, y=H-(story?149:69), right=W-65;
    c.strokeStyle=d.rgba(ink,0.24); c.lineWidth=1;
    c.beginPath(); c.moveTo(x,y-55); c.lineTo(right,y-55); c.stroke();
    d.smallText(c,s.handle,x,y+2,(W-x-65)*0.6,23,ink,700);
    c.save(); c.textAlign='right'; d.smallText(c,s.tagline,right,y+1,350,17,ink,600); c.restore();
    d.fill(c,s.accent,W-70,H-8,70,8);
  }
  function mainPhoto(c,s,media,rect) {
    return core().drawing.photo(c,media.photo,rect,{background:s.background,cropRef:media.cropRef,fit:s.fit,
      zoom:s.photoZoom,x:s.photoX,y:s.photoY,brightness:s.brightness,contrast:s.contrast,bw:s.bw});
  }
  function cornerPhoto(c,s,media,W,H,portraitRect) {
    if (!s.showSecond || !dimensions(media.second).w) return null;
    var d=core().drawing, side=W>1080?252:235;
    var x=W>1080?d.clamp(portraitRect.x+portraitRect.w-side-28,28,W-side-28):portraitRect.x+25;
    var y=W>1080?Math.min(portraitRect.y+portraitRect.h-side-28,H-side-155):portraitRect.y+portraitRect.h-side-24;
    c.save(); c.shadowColor='#00000055'; c.shadowBlur=20; c.shadowOffsetY=6;
    d.rounded(c,x-4,y-4,side+8,side+8,20,'#ffffff'); c.restore();
    c.save(); c.beginPath(); c.roundRect?c.roundRect(x,y,side,side,16):c.rect(x,y,side,side); c.clip();
    d.photo(c,media.second,{x:x,y:y,w:side,h:side},{background:s.background,fit:'cover',
      zoom:Math.max(1,d.number(s.secondZoom,1)),x:s.secondX,y:s.secondY,clampCover:true});
    c.restore(); return {x:x,y:y,w:side,h:side};
  }
  function customLayout(canvas,s,media,scale) {
    var d=core().drawing, fmt=FORMATS[s.format]||FORMATS.portrait, W=fmt.width,H=fmt.height;
    var landscape=W>1080, story=s.format==='story', square=s.format==='square';
    var c=reset(canvas,W,H,scale), ink=d.contrastInk(s.background), footerX=65;
    var muted=d.lightBackground(s.background)?'#526174':'#b7c1d0';
    var footSpace=s.showFooter?(story?220:140):(story?130:52);
    var bottom=H-footSpace-(s.source?52:22), photoRect, headRect, pi, head;
    d.fill(c,s.background,0,0,W,H);
    var brandY=story?150:49;
    if (!landscape) {
      if (s.template==='bulten') {
        d.brand(c,s,media.logo,65,brandY,d.contrastInk(s.background)); d.category(c,s,W-65,brandY+20,false);
        var py=story?300:square?180:210, ph=story?870:square?420:540;
        photoRect={x:40,y:py,w:1000,h:ph}; pi=mainPhoto(c,s,media,photoRect);
        var cardTop=py+ph-60;
        d.rounded(c,40,cardTop,1000,bottom-cardTop+83,18,'#f6f2e9');
        d.fill(c,s.accent,65,cardTop,104,6);
        d.smallText(c,s.subtitle,65,cardTop+57,945,21,'#687587',700);
        headRect={x:65,y:cardTop+92,w:950,h:Math.max(80,bottom-cardTop-92)};
        ink=d.darkInk(s.background);
      } else {
        d.brand(c,s,media.logo,65,brandY,d.contrastInk(s.background)); d.category(c,s,W-65,brandY+20,false);
        var qx=story?510:square?664:600, qy=story?350:square?175:190;
        var qw=story?506:square?352:416,qh=story?600:square?352:440;
        photoRect={x:qx,y:qy,w:qw,h:qh};
        c.save(); d.rounded(c,qx-8,qy-8,qw+16,qh+16,28,s.accent);
        c.beginPath(); c.roundRect?c.roundRect(qx,qy,qw,qh,22):c.rect(qx,qy,qw,qh); c.clip();
        pi=mainPhoto(c,s,media,photoRect); c.restore();
        var titleTop=story?1080:square?580:710;
        headRect={x:65,y:titleTop,w:950,h:Math.max(80,bottom-titleTop)};
        d.quote(c,{showQuote:true,quoteOpacity:0.75},65,titleTop-203,s.accent);
        d.smallText(c,s.subtitle,65,titleTop-45,950,21,muted,700);
      }
    } else if (s.template==='manset') {
      photoRect={x:0,y:0,w:960,h:1080}; pi=mainPhoto(c,s,media,photoRect);
      var pg=c.createLinearGradient(0,0,0,230); pg.addColorStop(0,d.rgba(s.background,0.65)); pg.addColorStop(1,d.rgba(s.background,0)); d.fill(c,pg,0,0,960,230);
      d.brand(c,s,media.logo,75,58,'#ffffff'); d.fill(c,s.accent,960,0,10,H);
      d.rounded(c,1045,160,10,28,2,s.accent); d.smallText(c,s.category,1074,183,740,22,d.readableAccent(s.accent,s.background,ink),700);
      d.smallText(c,s.subtitle,1045,246,785,22,muted,700);
      headRect={x:1045,y:305,w:790,h:bottom-305};
    } else if (s.template==='sade') {
      ink=d.darkInk(s.background); d.fill(c,'#f6f2e9',0,0,W,H);
      photoRect={x:960,y:65,w:895,h:830}; pi=mainPhoto(c,s,media,photoRect);
      d.brand(c,s,media.logo,65,58,d.darkInk(s.background)); d.category(c,s,W-88,89,true);
      d.fill(c,s.accent,960,887,110,8); d.smallText(c,s.subtitle,65,288,820,22,'#687587',700);
      headRect={x:65,y:350,w:815,h:bottom-350};
    } else if (s.template==='bulten') {
      d.brand(c,s,media.logo,65,49,d.contrastInk(s.background)); d.category(c,s,W-65,72,false);
      photoRect={x:40,y:196,w:1090,h:744}; pi=mainPhoto(c,s,media,photoRect);
      d.rounded(c,1070,196,810,744,18,'#f6f2e9'); d.fill(c,s.accent,1110,196,108,6);
      d.smallText(c,s.subtitle,1110,269,720,22,'#687587',700);
      headRect={x:1110,y:325,w:715,h:bottom-325}; ink=d.darkInk(s.background);
    } else if (s.template==='alinti') {
      d.brand(c,s,media.logo,75,58,d.contrastInk(s.background)); d.category(c,s,W-75,80,false);
      photoRect={x:1170,y:195,w:650,h:650};
      c.save(); d.rounded(c,1162,187,666,666,30,s.accent);
      c.beginPath(); c.roundRect?c.roundRect(1170,195,650,650,22):c.rect(1170,195,650,650); c.clip();
      pi=mainPhoto(c,s,media,photoRect); c.restore();
      headRect={x:75,y:390,w:995,h:bottom-390};
      d.quote(c,{showQuote:true,quoteOpacity:0.75},75,220,s.accent);
      d.smallText(c,s.subtitle,75,347,990,22,muted,700);
    } else {
      var rail=s.template==='serit'; footerX=rail?145:94;
      photoRect={x:rail?830:760,y:0,w:rail?1090:1160,h:H}; pi=mainPhoto(c,s,media,photoRect);
      var hg=c.createLinearGradient(590,0,1250,0); hg.addColorStop(0,s.background); hg.addColorStop(1,d.rgba(s.background,0));
      d.fill(c,hg,580,0,680,H);
      var bg=c.createLinearGradient(0,650,0,H); bg.addColorStop(0,d.rgba(s.background,0)); bg.addColorStop(1,s.background); d.fill(c,bg,760,650,W-760,H-650);
      if (rail) d.rail(c,s,media,H,67,H-footSpace+10); else d.brand(c,s,media.logo,94,58,d.contrastInk(s.background));
      d.category(c,s,W-88,77,false);
      headRect={x:footerX,y:345,w:rail?795:760,h:bottom-345};
    }
    var headlineState=Object.assign({},s,{accent:d.readableAccent(s.accent,s.template==='sade'||s.template==='bulten'?'#f6f2e9':s.background,ink)});
    if (s.template==='bulten') {
      // The light bulletin card ends above the footer; its photo credit stays in the card.
      head=d.drawHeadline(c,headlineState,headRect,ink);
    } else {
      head=d.drawHeadline(c,headlineState,headRect,ink);
      if (landscape && (s.template==='odak'||s.template==='serit')) {
        d.fill(c,s.accent,headRect.x,head.top-67,29,4);
        d.smallText(c,s.subtitle,headRect.x+45,head.top-58,headRect.w-45,22,muted,700);
      }
    }
    var sourceInk=(s.template==='sade'||s.template==='bulten')?'#617084':muted;
    if (s.source) d.smallText(c,s.source,headRect.x,bottom+43,headRect.w,23,sourceInk,500);
    var secondRect=cornerPhoto(c,s,media,W,H,photoRect);
    footer(c,s,W,H,footerX,s.template==='sade'?'#405064':d.contrastInk(s.background),story);
    return {width:W,height:H,scale:scale,overflow:head.overflow,fontSize:head.fontSize,lineCount:head.lineCount,
      plainHeadline:head.plainHeadline,lines:head.lines,headlineRect:headRect,photoRect:photoRect,
      photoImageRect:pi&&pi.image,secondRect:secondRect};
  }
  function layerFont(c,size,layer) {
    var family=['Barlow Condensed','Manrope','Arial','Georgia'].indexOf(layer.fontFamily)>=0?layer.fontFamily:'Manrope';
    var weight=core().drawing.clamp(core().drawing.number(layer.fontWeight,700),400,900);
    core().drawing.font(c,size,family,weight);
  }
  function wrapText(c,text,maxWidth) {
    var lines=[];
    String(text||'').replace(/\r\n?/g,'\n').split('\n').forEach(function(paragraph){
      if (!paragraph) { lines.push(''); return; }
      var line='';
      paragraph.split(/\s+/).forEach(function(word){
        if (!word) return;
        var next=line?line+' '+word:word;
        if (c.measureText(next).width<=maxWidth) { line=next; return; }
        if (line) { lines.push(line); line=''; }
        if (c.measureText(word).width<=maxWidth) { line=word; return; }
        Array.from(word).forEach(function(ch){
          if (line && c.measureText(line+ch).width>maxWidth) { lines.push(line); line=''; }
          line+=ch;
        });
      }); lines.push(line);
    }); return lines;
  }
  function layerText(c,layer,box) {
    var d=core().drawing, size=d.clamp(d.number(layer.fontSize,64),8,500), lines;
    do { layerFont(c,size,layer); lines=wrapText(c,layer.text,box.w); if(lines.length*size*1.18<=box.h||size<=8)break; size=Math.max(8,size-1); } while(true);
    box.overflow=lines.length*size*1.18>box.h+0.5; box.fontSize=size; box.lineCount=lines.length;
    c.textAlign=['center','right'].indexOf(layer.align)>=0?layer.align:'left';
    var x=c.textAlign==='center'?box.w/2:c.textAlign==='right'?box.w:0;
    c.fillStyle=layer.color||'#ffffff'; c.strokeStyle=layer.stroke||'#ffffff';
    var strokeWidth=Math.max(0,d.number(layer.strokeWidth,0)); if(strokeWidth>0)c.lineWidth=strokeWidth; c.lineJoin='round';
    lines.forEach(function(line,index){var y=size*0.88+index*size*1.18;if(strokeWidth>0)c.strokeText(line,x,y);c.fillText(line,x,y);});
  }
  function layerImage(c,image,layer,box) {
    var d=dimensions(image); if (!d.w||!d.h) { box.missingMedia=true; return; }
    var scale=(layer.fit==='contain'?Math.min:Math.max)(box.w/d.w,box.h/d.h);
    c.drawImage(image,(box.w-d.w*scale)/2,(box.h-d.h*scale)/2,d.w*scale,d.h*scale);
  }
  function corners(box) {
    var radians=box.rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians),cx=box.x+box.w/2,cy=box.y+box.h/2;
    return [[-box.w/2,-box.h/2],[box.w/2,-box.h/2],[box.w/2,box.h/2],[-box.w/2,box.h/2]].map(function(p){return{x:cx+p[0]*cos-p[1]*sin,y:cy+p[0]*sin+p[1]*cos};});
  }
  function drawLayers(c,board,media,scale) {
    var d=core().drawing, boxes=[];
    (Array.isArray(board.layers)?board.layers:[]).slice(0,MAX_LAYERS).forEach(function(layer){
      var box=geometry(layer); box.corners=corners(box); boxes.push(box);
      if (!box.visible||box.opacity<=0) return;
      c.save(); c.setTransform(scale,0,0,scale,0,0); c.globalAlpha=box.opacity;
      c.translate(box.x+box.w/2,box.y+box.h/2); c.rotate(box.rotation*Math.PI/180); c.translate(-box.w/2,-box.h/2);
      var radius=Math.max(0,d.number(layer.radius,0));
      if(radius>0&&layer.type!=='text')d.roundPath(c,0,0,box.w,box.h,radius);
      else {c.beginPath();c.rect(0,0,box.w,box.h);} c.clip();
      if (layer.type==='text') layerText(c,layer,box);
      else if (layer.type==='image') layerImage(c,media.layers&&media.layers[layer.id],layer,box);
      else if (layer.type==='rect') {
        c.fillStyle=layer.fill||'#ff7548'; c.fillRect(0,0,box.w,box.h);
        var stroke=Math.max(0,d.number(layer.strokeWidth,0));
        if(stroke){c.lineWidth=stroke;c.strokeStyle=layer.stroke||'#ffffff';
          d.roundPath(c,stroke/2,stroke/2,Math.max(0,box.w-stroke),Math.max(0,box.h-stroke),Math.max(0,radius-stroke/2));c.stroke();}
      }
      c.restore();
    }); return boxes;
  }
  function render(canvas,board,media,options) {
    board=board||{};media=media||{};options=options||{};
    var base=core(),d=base.drawing,s=Object.assign({},base.defaults,board.state||{});
    s.format=FORMATS[s.format]?s.format:'portrait'; s.template=TEMPLATES.indexOf(s.template)>=0?s.template:'odak';
    s.accent=d.color(s.accent,base.defaults.accent);s.background=d.color(s.background,base.defaults.background);
    s.fontFamily=['Barlow Condensed','Manrope','Arial','Georgia'].indexOf(s.fontFamily)>=0?s.fontFamily:'Barlow Condensed';
    var scale=d.clamp(d.number(options.scale,1),0.25,3);
    var info=s.format==='landscape'||s.template==='bulten'||s.template==='alinti'?customLayout(canvas,s,media,scale):base.render(canvas,s,media,{scale:scale});
    var boxes=drawLayers(canvas.getContext('2d'),board,media,scale);
    var layerOverflow=boxes.some(function(box){return box.visible&&box.opacity>0&&box.overflow;});
    return Object.assign({},info,{baseOverflow:info.overflow,layerOverflow:layerOverflow,layerBoxes:boxes});
  }
  function hitTest(board,x,y) {
    board=board||{};var format=FORMATS[board.state&&board.state.format]||FORMATS.portrait;
    if(x<0||y<0||x>format.width||y>format.height)return null;
    var layers=(Array.isArray(board.layers)?board.layers:[]).slice(0,MAX_LAYERS);
    for(var i=layers.length-1;i>=0;i--){
      var box=geometry(layers[i]);if(!box.visible||box.locked||box.opacity<=0)continue;
      var dx=x-(box.x+box.w/2),dy=y-(box.y+box.h/2),angle=-box.rotation*Math.PI/180;
      var localX=dx*Math.cos(angle)-dy*Math.sin(angle),localY=dx*Math.sin(angle)+dy*Math.cos(angle);
      if(Math.abs(localX)<=box.w/2&&Math.abs(localY)<=box.h/2)return box.id;
    } return null;
  }
  global.DesktopRenderer={render:render,hitTest:hitTest,formats:FORMATS,templates:TEMPLATES,maxLayers:MAX_LAYERS};
  global.NeticeDesktopRenderer=global.DesktopRenderer;
  global.StudioRenderer=global.DesktopRenderer;
})(typeof window!=='undefined'?window:globalThis);
