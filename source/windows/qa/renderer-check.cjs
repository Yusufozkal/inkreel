/* Portable renderer verification. Run from qa/: npm ci && node renderer-check.cjs */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ui = path.resolve(__dirname, '..', 'ui');
const assets = path.join(ui, 'assets');
const previewPath = path.join(__dirname, 'render-preview.png');
const resultPath = path.join(__dirname, 'renderer-check-results.json');
const checks = [];
function checked(name, fn) { fn(); checks.push(name); }
function normalized(text) { return text.replace(/\s+/g, ' ').trim(); }
function pixel(canvas, x, y) { return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data]; }

for (let index = 0; index < 8; index++) {
  assert(GlobalFonts.registerFromPath(path.join(assets, `font-${index}.woff2`), index < 3 ? 'Barlow Condensed' : 'Manrope'), `Bundled font ${index} loads`);
}
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const name of ['base-render.js', 'desktop-render.js']) {
  vm.runInContext(fs.readFileSync(path.join(ui, name), 'utf8'), sandbox, { filename: name });
}
const Renderer = sandbox.window.DesktopRenderer;
const headlines = {
  normal: 'Haber başlığını\nburaya yaz',
  long: 'Günün gelişmelerini kendi yayın kimliğinizle anlatın. Başlık, görsel, kaynak ve marka bilgilerini düzenleyerek okuyucularınıza açık bir haber akışı sunun. Farklı paylaşım biçimlerinde aynı yayın çizgisini koruyun, hazırladığınız tasarımı projenize kaydedin ve yayınlamadan önce son kez kontrol edin.'.slice(0, 280)
};

(async function main() {
  // Fresh projects deliberately have no photograph. The preview exercises the
  // renderer's local gradient, rather than a bundled publisher-specific image.
  const media = {};
  const synthetic = createCanvas(1215,609), syntheticContext = synthetic.getContext('2d');
  syntheticContext.fillStyle='#000000'; syntheticContext.fillRect(0,0,1215,609);
  const syntheticGradient=syntheticContext.createLinearGradient(148,0,1062,609);
  syntheticGradient.addColorStop(0,'#527cc5'); syntheticGradient.addColorStop(1,'#ac8bde');
  syntheticContext.fillStyle=syntheticGradient; syntheticContext.fillRect(148,0,914,609);
  const photo=await loadImage(synthetic.toBuffer('image/png'));
  const cases = [];
  const thumbnailWidth = 270;
  const rows = Object.entries(Renderer.formats);
  const previewHeight = Math.ceil(rows.reduce((height, [, format]) => height + 38 + thumbnailWidth * format.height / format.width, 0));
  const preview = createCanvas(thumbnailWidth * Renderer.templates.length, previewHeight);
  const previewContext = preview.getContext('2d');
  previewContext.fillStyle = '#e9ecf1';
  previewContext.fillRect(0, 0, preview.width, preview.height);
  let rowTop = 0;

  for (const [format, dimensions] of rows) {
    let column = 0;
    for (const template of Renderer.templates) {
      const canvas = createCanvas(1, 1);
      for (const [kind, headline] of Object.entries(headlines)) {
        const board = { state: { format, template, headline, source: 'Kaynak: Yayın arşivi' }, layers: [] };
        const result = Renderer.render(canvas, board, media);
        assert.equal(result.overflow, false, `${template}/${format}/${kind}: title fits`);
        assert.equal(result.baseOverflow, false);
        assert.equal(result.layerOverflow, false);
        assert.equal(canvas.width, dimensions.width, `${format}: exported width`);
        assert.equal(canvas.height, dimensions.height, `${format}: exported height`);
        assert.equal(normalized(result.plainHeadline), normalized(result.lines.join(' ')), `${template}/${format}/${kind}: no discarded words`);
        assert.equal(pixel(canvas, canvas.width - 1, canvas.height - 1)[3], 255, 'Export has an opaque background');
        assert(result.photoRect.w > 0 && result.photoRect.h > 0);
        assert(result.headlineRect.x >= 0 && result.headlineRect.y >= 0);
        assert(result.headlineRect.x + result.headlineRect.w <= dimensions.width);
        assert(result.headlineRect.y + result.headlineRect.h <= dimensions.height);
        assert.equal(result.photoImageRect,null,'Fresh projects render the neutral placeholder without a photograph');
        cases.push({ template, format, kind, width: canvas.width, height: canvas.height, fontSize: result.fontSize, lines: result.lineCount, overflow: result.overflow });
        if (kind === 'normal') {
          previewContext.fillStyle = '#111d31';
          previewContext.font = '600 14px Manrope';
          previewContext.fillText(`${template} · ${format}`, column * thumbnailWidth + 8, rowTop + 18);
          previewContext.drawImage(canvas, column * thumbnailWidth, rowTop + 25, thumbnailWidth, thumbnailWidth * dimensions.height / dimensions.width);
        }
      }
      column++;
    }
    rowTop += 38 + thumbnailWidth * dimensions.height / dimensions.width;
  }
  assert.equal(cases.length, 48);
  checks.push('48 renders: six templates × four formats × normal and 280-character headlines');
  checks.push('Each render preserves the full headline, expected dimensions, opaque background, and empty-photo placeholder');

  checked('Fresh publisher defaults are generic and use the Bülten Studio palette',()=>{
    const defaults=sandbox.window.StudioBaseRenderer.defaults;
    assert.equal(defaults.brandName,'MARKANIZ');assert.equal(defaults.brandLabel,'HABER');
    assert.equal(defaults.brandMark,'M');assert.equal(defaults.tagline,'GÜNCEL VE GÜVENİLİR');
    assert.equal(defaults.handle,'@hesabiniz');assert.equal(defaults.photo,'');
    assert.equal(defaults.location,'');assert.equal(defaults.source,'');assert.equal(defaults.highlight,'');
    assert.equal(defaults.accent,'#a294ff');assert.equal(defaults.background,'#152136');
    assert.equal(sandbox.window.StudioRenderer,Renderer);
  });
  checked('Two distinct publishers rebrand every template and format without a fixed publisher name',()=>{
    const publishers=[
      {brandName:'PUSULA',brandLabel:'YAYIN',tagline:'GÜNÜ YAKALA',brandMark:'P',handle:'@pusulayayin'},
      {brandName:'KENT GÜNDEMİ',brandLabel:'BÖLGESEL',tagline:'YAŞADIĞINIZ YERİN SESİ',brandMark:'K',handle:'@kentgundemi'}
    ];
    for(const [format]of rows)for(const template of Renderer.templates)for(const publisher of publishers){
      const canvas=createCanvas(1,1),context=canvas.getContext('2d'),texts=[];
      const originalFillText=context.fillText.bind(context);
      context.fillText=function(text,...args){texts.push(String(text));return originalFillText(text,...args);};
      Renderer.render(canvas,{state:{...publisher,format,template},layers:[]},media);
      assert(texts.some(text=>text.includes(publisher.brandName)),`${template}/${format}: selected publisher name`);
      assert(texts.includes(publisher.tagline),`${template}/${format}: selected tagline`);
      assert(texts.includes(publisher.handle),`${template}/${format}: selected handle`);
      if(template==='serit')assert(texts.includes(publisher.brandMark),'Rail uses selected mark');
      else assert(texts.includes(publisher.brandLabel),'Brand uses selected label');
      assert(!texts.some(text=>/netice|haberin net hali/i.test(text)),`${template}/${format}: no fixed publisher identity`);
    }
  });
  checked('Imported publisher spelling is read as supplied, including the legacy identity',()=>{
    const canvas=createCanvas(1,1),context=canvas.getContext('2d'),texts=[];
    context.fillText=function(text){texts.push(String(text));};
    Renderer.render(canvas,{state:{brandName:'netice',brandLabel:'HABER',brandMark:'n',tagline:'HABERİN NET HALİ.',handle:'@neticehaber'},layers:[]},media);
    assert(texts.includes('netice'));assert(texts.includes('HABERİN NET HALİ.'));assert(texts.includes('@neticehaber'));
  });
  checked('Long brand names fit the 360-pixel brand area',()=>{
    const canvas=createCanvas(1,1),context=canvas.getContext('2d'),draws=[];
    const brandName='ULUSLARARASI BAĞIMSIZ YAYINCILIK TOPLULUĞU';
    context.fillText=function(text,x,y,maxWidth){if(text===brandName)draws.push({measured:context.measureText(text).width,maxWidth});};
    Renderer.render(canvas,{state:{brandName},layers:[]},media);
    assert.equal(draws.length,1);assert(draws[0].maxWidth<=360);
  });
  checked('Light background and white accent keep headline and footer text readable',()=>{
    const d=sandbox.window.StudioBaseRenderer.drawing;
    assert.equal(d.contrastInk('#ffffff'),'#172336');
    assert.equal(d.darkInk('#ffffff'),'#172336');
    assert.equal(d.readableAccent('#ffffff','#ffffff','#172336'),'#172336');
    for(const template of Renderer.templates){
      const canvas=createCanvas(1,1),context=canvas.getContext('2d'),inks=[];
      const originalFillText=context.fillText.bind(context);
      context.fillText=function(text,...args){if(String(text).includes('Okunaklı')||text==='AÇIK ZEMİN')inks.push(context.fillStyle);return originalFillText(text,...args);};
      Renderer.render(canvas,{state:{template,format:'landscape',background:'#ffffff',accent:'#ffffff',headline:'Okunaklı başlık',highlight:'Okunaklı',tagline:'AÇIK ZEMİN'},layers:[]},media);
      assert(inks.length>=2,`${template}: headline and footer sampled`);
      assert(inks.every(ink=>!d.lightBackground(ink)),`${template}: dark text on light background`);
    }
  });
  checked('Same-size repeated frame rendering avoids reallocating the canvas',()=>{
    for(const template of ['odak','bulten']){
      const realCanvas=createCanvas(1,1);let allocations=0;
      const canvas={get width(){return realCanvas.width;},set width(v){allocations++;realCanvas.width=v;},get height(){return realCanvas.height;},set height(v){allocations++;realCanvas.height=v;},getContext(){return realCanvas.getContext('2d');}};
      Renderer.render(canvas,{state:{template},layers:[]},media);assert(allocations>0);
      allocations=0;Renderer.render(canvas,{state:{template},layers:[]},media);assert.equal(allocations,0);
    }
  });
  checked('Explicit legacy source crop still excludes embedded sidebars',()=>{
    const canvas=createCanvas(1,1),result=Renderer.render(canvas,{state:{},layers:[]},{photo,cropRef:true});
    assert(Math.abs(result.photoImageRect.w/result.photoImageRect.h-914/609)<0.00001);
  });

  checked('Photo zoom continues from 500% to the advertised 600% in base and custom layouts',()=>{
    for(const format of ['portrait','landscape'])for(const template of Renderer.templates){
      const canvas=createCanvas(1,1),state={format,template,photoZoom:5};
      const five=Renderer.render(canvas,{state,layers:[]},{photo}).photoImageRect;
      const six=Renderer.render(canvas,{state:{...state,photoZoom:6},layers:[]},{photo}).photoImageRect;
      assert(Math.abs(six.w/five.w-1.2)<0.00001,`${format}/${template}: 600% width`);
      assert(Math.abs(six.h/five.h-1.2)<0.00001,`${format}/${template}: 600% height`);
    }
  });
  checked('Valid portable-project font sizes render without silently clamping their saved values',()=>{
    const canvas=createCanvas(1,1);
    const result=Renderer.render(canvas,{state:{headline:'A',fontSize:240},layers:[{id:'tiny',type:'text',text:'A',x:0,y:0,w:100,h:100,fontSize:8}]},{});
    assert.equal(result.fontSize,240);
    assert.equal(result.layerBoxes[0].fontSize,8);
    assert.equal(result.layerOverflow,false);
  });

  const board = { state: { template: 'manset', format: 'landscape' }, layers: [
    { id: 'shape', type: 'rect', x: 70, y: 700, w: 400, h: 100, fill: '#ff7548', rotation: 15 },
    { id: 'text', type: 'text', text: 'ÖZEL HABER', x: 100, y: 720, w: 350, h: 80, fontSize: 64, color: '#ffffff', rotation: 15 },
    { id: 'pic', type: 'image', x: 1600, y: 65, w: 150, h: 100, rotation: -10, opacity: 0.8 }
  ] };
  const layerCanvas = createCanvas(1, 1);
  const layerResult = Renderer.render(layerCanvas, board, { ...media, layers: { pic: photo } });
  checked('Text, shape and image layers render with transform metadata', () => {
    assert.equal(layerResult.layerBoxes.length, 3);
    assert.equal(layerResult.layerOverflow, false);
    assert.equal(layerResult.layerBoxes[2].missingMedia, undefined);
    assert.equal(layerResult.layerBoxes[2].opacity, 0.8);
    assert.equal(layerResult.layerBoxes[0].corners.length, 4);
  });
  checked('Hit testing follows draw order, rotation, locks, visibility and opacity', () => {
    assert.equal(Renderer.hitTest(board, 275, 760), 'text');
    board.layers[1].locked = true;
    assert.equal(Renderer.hitTest(board, 275, 760), 'shape');
    board.layers[0].visible = false;
    assert.equal(Renderer.hitTest(board, 275, 760), null);
    board.layers[1].locked = false;
    board.layers[1].opacity = 0;
    assert.equal(Renderer.hitTest(board, 275, 760), null);
    assert.equal(Renderer.hitTest(board, -1, 760), null);
  });
  checked('Rotated rectangle hit test uses the rotated shape', () => {
    const rotated = { state: { format: 'square' }, layers: [{ id: 'rotated', type: 'rect', x: 100, y: 100, w: 300, h: 50, rotation: 90 }] };
    assert.equal(Renderer.hitTest(rotated, 250, 240), 'rotated');
    assert.equal(Renderer.hitTest(rotated, 115, 125), null);
  });
  checked('Layer overflow is reported separately from base title overflow; 2× landscape is 3840×2160', () => {
    const canvas = createCanvas(1, 1);
    const result = Renderer.render(canvas, { state: { format: 'landscape' }, layers: [{ id: 'overflow', type: 'text', x: 0, y: 0, w: 10, h: 10, text: Array(50).fill('A').join('\n') }] }, media, { scale: 2 });
    assert.equal(canvas.width, 3840);
    assert.equal(canvas.height, 2160);
    assert.equal(result.layerOverflow, true);
    assert.equal(result.overflow, false);
    assert.equal(result.baseOverflow, false);
  });
  checked('Default text stroke width zero does not call strokeText', () => {
    const canvas = createCanvas(1, 1), context = canvas.getContext('2d');
    let strokeCalls = 0;
    context.strokeText = function () { strokeCalls++; };
    const textBoard = { state: {}, layers: [{ id: 'plain', type: 'text', text: 'Özel başlık', x: 80, y: 350, w: 500, h: 150, strokeWidth: 0 }] };
    Renderer.render(canvas, textBoard, media);
    assert.equal(strokeCalls, 0);
    textBoard.layers[0].strokeWidth = 2;
    Renderer.render(canvas, textBoard, media);
    assert(strokeCalls > 0);
  });
  checked('Rounded shape layers keep transparent corners over the base', () => {
    const canvas = createCanvas(1, 1);
    Renderer.render(canvas, { state: { format: 'landscape', template: 'manset' }, layers: [{ id: 'rounded', type: 'rect', x: 1200, y: 10, w: 100, h: 100, fill: '#ff00ff', radius: 30 }] }, media);
    assert.deepEqual(pixel(canvas, 1250, 60), [255, 0, 255, 255]);
    assert.notDeepEqual(pixel(canvas, 1201, 11), [255, 0, 255, 255]);
  });
  checked('The first 30 layers are the rendered and hit-tested layer limit', () => {
    const limited = { state: {}, layers: Array.from({ length: 31 }, (_, i) => ({ id: `L${i}`, type: 'rect', x: 0, y: 0, w: 20, h: 20 })) };
    const canvas = createCanvas(1, 1);
    assert.equal(Renderer.render(canvas, limited, media).layerBoxes.length, 30);
    assert.equal(Renderer.hitTest(limited, 10, 10), 'L29');
  });

  fs.writeFileSync(previewPath, preview.toBuffer('image/png'));
  fs.writeFileSync(resultPath, JSON.stringify({ schema: 1, passed: true, renderedCases: cases.length, checks, cases }, null, 2) + '\n');
  console.log(`PASS: ${cases.length} renderer cases and ${checks.length - 2} additional feature checks.`);
  console.log(`Preview: ${previewPath}`);
  console.log(`Results: ${resultPath}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
