import { renderPage } from './render.js';

const $ = id => document.getElementById(id);
let chapter = [], page, source, output, busy = false, selecting = false, start;
let engine;
const message = value => { $('status').textContent = value; };
function controls() {
  for (const id of ['files','pages','language','regions','loadJson','addRegion','run','view','saveJson','download']) {
    $(id).disabled = busy || (!source && id !== 'files' && id !== 'language');
  }
  $('regions').inert = busy;
}
function draw() {
  if (!source) return;
  const target = $('preview'), result = $('view').value === 'original' ? source : output;
  target.width = source.width; target.height = source.height;
  target.getContext('2d').drawImage(result || source, 0, 0);
}
function rebuild() {
  const result = renderPage(source,page.regions);
  output = result.canvas; page.issues = result.issues;
  draw();
  Array.from($('regions').children).forEach((group,index)=>{
    const note=group.querySelector('output');
    if(note)note.textContent=result.issues.filter(issue=>issue.index===index).map(issue=>issue.message).join(' ');
  });
  message(page.regions.length ? page.regions.length + ' regions · ' + result.issues.length + ' need review' : 'Page ready. Run translation or mark a dialogue region.');
}
function editor() {
  $('regions').replaceChildren();
  page.regions.forEach((r,i) => {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = 'Region ' + (i+1) + (Number.isFinite(r.confidence) ? ' · OCR ' + Math.round(r.confidence) + '%' : '');
    group.append(legend);
    for (const [key,title] of [['text','Source'],['translation','English']]) {
      const label = document.createElement('label'); label.textContent = title;
      const area = document.createElement('textarea'); area.value = r[key];
      area.oninput = () => {r[key] = area.value; rebuild();};
      label.append(area); group.append(label);
    }
    const label = document.createElement('label'), check = document.createElement('input');
    check.type = 'checkbox'; check.checked = r.enabled;
    check.onchange = () => {r.enabled = check.checked; rebuild();};
    label.append(check,' Apply lettering'); group.append(label,document.createElement('output'));
    $('regions').append(group);
  });
}
async function openPage(index) {
  busy=true; controls(); selecting=false; page=chapter[index]; source=undefined; output=undefined;
  try {
    const img = await createImageBitmap(page.file);
    try {
      if(img.width*img.height>32e6) throw Error('Page exceeds the 32-megapixel limit.');
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      c.getContext('2d').drawImage(img,0,0); source=c;
    } finally {img.close();}
    editor(); rebuild();
  } catch(e) { $('preview').width=1; $('regions').replaceChildren(); message(e.message); }
  finally {busy=false; controls(); $('pages').disabled=false;}
}
$('files').onchange = async e => {
  const files=Array.from(e.target.files).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  if(!files.length)return;
  chapter=files.map(file=>({file,regions:[],issues:[]}));
  $('pages').replaceChildren(...files.map((file,i)=>new Option(file.name,i)));
  await openPage(0);
};
$('pages').onchange=e=>openPage(Number(e.target.value));
$('view').onchange=draw;
$('run').onclick=async()=>{
  if(!source||busy)return;
  busy=true; controls(); selecting=false;
  try {
    engine ||= await import('./engine.js');
    const lang=$('language').value;
    if(!page.regions.length){
      message('Recognizing dialogue…');
      page.regions=(await engine.recognize(source,lang,message)).map((r,i)=>({...r,id:'r'+(i+1),translation:'',enabled:r.confidence>=55}));
      editor();
    }
    if(!page.regions.length)throw Error('No text recognized. Add a region manually.');
    let failures=0;
    for(const r of page.regions){
      if(!r.enabled||r.translation||!r.text.trim())continue;
      try {r.translation=await engine.translate(r.text,lang,message); delete r.error;}
      catch(e){r.error=e.message; failures++; break;}
    }
    $('view').value='output'; editor(); rebuild();
    if(failures)message('Translation paused. '+page.regions.find(r=>r.error)?.error+' · Recognized text retained. Run again to retry.');
  }catch(e){message('Processing stopped. '+e.message);}
  finally{busy=false;controls();}
};
$('addRegion').onclick=()=>{selecting=true; $('view').value='original'; draw();message('Drag a rectangle around the source lettering.');};
function point(e){const c=$('preview'), rect=c.getBoundingClientRect();return [Math.round((e.clientX-rect.left)*c.width/rect.width),Math.round((e.clientY-rect.top)*c.height/rect.height)];}
$('preview').onpointerdown=e=>{if(selecting&&!busy){start=point(e);e.target.setPointerCapture(e.pointerId);}};
$('preview').onpointerup=e=>{
  if(!start||!selecting||busy)return;
  const [x,y]=point(e),[a,b]=start; start=null;selecting=false;
  const left=Math.max(0,Math.min(x,a)), top=Math.max(0,Math.min(y,b));
  const w=Math.min(source.width,Math.max(x,a))-left,h=Math.min(source.height,Math.max(y,b))-top;
  if(w<4||h<4)return;
  page.regions.push({id:'r'+(page.regions.length+1),box:[left,top,w,h],text:'',translation:'',enabled:true});
  editor(); rebuild();
};
function save(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('download').onclick=()=>{const name=page.file.name+'.en.png';output.toBlob(b=>b&&save(b,name));};
$('saveJson').onclick=()=>save(new Blob([JSON.stringify({version:1,file:page.file.name,width:source.width,height:source.height,regions:page.regions,issues:page.issues},null,2)],{type:'application/json'}),page.file.name+'.json');
$('loadJson').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;
    const data=JSON.parse(await file.text());
    if(data.version!==1||data.file!==page.file.name||data.width!==source.width||data.height!==source.height||!Array.isArray(data.regions))throw Error('Page or schema mismatch');
    for(const r of data.regions){
      if(!r||typeof r.text!=='string'||typeof r.translation!=='string'||typeof r.enabled!=='boolean'||!Array.isArray(r.box)||r.box.length!==4||!r.box.every(Number.isInteger))throw Error('Invalid region');
      const [x,y,w,h]=r.box;if(x<0||y<0||w<=0||h<=0||x+w>source.width||y+h>source.height)throw Error('Region outside page');
    }
    page.regions=data.regions; editor();rebuild();
  }catch(err){message('Import failed. '+err.message);}finally{e.target.value='';}
};
$('sample').onclick=async()=>{
  try {
    const response=await fetch('./examples/indonesian.png');
    if(!response.ok)throw Error('Sample could not be opened.');
    const file=new File([await response.blob()],'indonesian.png',{type:'image/png'});
    chapter=[{file,regions:[],issues:[]}];
    $('pages').replaceChildren(new Option(file.name,0));
    await openPage(0);
  }catch(error){message(error.message);}
};
controls();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
