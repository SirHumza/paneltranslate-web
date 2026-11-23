import { renderPage } from './render.js';

const $ = id => document.getElementById(id);
let chapter = [], page, source, output, busy = false, selecting = false, start;
let engine, chapterBusy=false;
const message = value => { $('status').textContent = value; };
function controls() {
  for (const id of ['files','pages','language','regions','loadJson','addRegion','run','view','saveJson','download','batch','chapterDownload']) {
    $(id).disabled = busy || chapterBusy || (!source && id !== 'files' && id !== 'language');
  }
  $('regions').inert = busy || chapterBusy;
  $('batch').hidden = $('chapterDownload').hidden = chapter.length < 2;
  $('sample').disabled = busy || chapterBusy;
}
function draw() {
  if (!source) return;
  const target = $('preview'), result = $('view').value === 'output' ? output : source;
  target.width = source.width; target.height = source.height;
  const ctx=target.getContext('2d');
  ctx.drawImage(result || source, 0, 0);
  if($('view').value==='regions'){
    const scale=Math.max(1,Math.min(6,source.width/750));
    ctx.lineWidth=2*scale; ctx.font='bold '+Math.round(14*scale)+'px sans-serif';
    page.regions.forEach((r,index)=>{
      const [x,y,w,h]=r.box;
      ctx.strokeStyle=ctx.fillStyle=r.enabled?'#147963':'#ad4124';
      ctx.strokeRect(x,y,w,h);
      const label=String(index+1), size=ctx.measureText(label).width+8*scale;
      const top=Math.max(0,y-19*scale);
      ctx.fillRect(x,top,size,18*scale);ctx.fillStyle='white';
      ctx.fillText(label,x+4*scale,top+14*scale);
    });
  }
}
function rebuild() {
  const result = renderPage(source,page.regions);
  output = result.canvas; page.issues = result.issues;
  page.regions.forEach((r,index)=>{
    if(!r.enabled && r.confidence<55) page.issues.push({index,id:r.id,code:'uncertain-ocr',message:'Low OCR confidence. Check the source and enable lettering to translate.'});
  });
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
  busy=true; controls(); selecting=false; page=chapter[index]; $('pages').value=String(index); source=undefined; output=undefined;
  try {
    const img = await createImageBitmap(page.file);
    try {
      if(img.width*img.height>32e6) throw Error('Page exceeds the 32-megapixel limit.');
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      c.getContext('2d').drawImage(img,0,0); source=c;
    } finally {img.close();}
    editor(); rebuild();
  } catch(e) { $('preview').width=1; $('regions').replaceChildren(); page.error=e.message; message(e.message); }
  finally {busy=false; controls(); $('pages').disabled=chapterBusy;}
}
$('files').onchange = async e => {
  const selected=Array.from(e.target.files);
  if(!selected.length)return;
  busy=true;controls();
  try {
    const hasArchive=selected.some(file=>/\.(zip|cbz)$/i.test(file.name));
    const files=hasArchive ? await (await import('./archive.js')).expandFiles(selected) :
      selected.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    if(!files.length)throw Error('No supported images in this chapter.');
    chapter=files.map(file=>({file,regions:[],issues:[]}));
    $('pages').replaceChildren(...files.map((file,i)=>new Option(file.name,i)));
    await openPage(0);
  }catch(error){message(error.message);}finally{busy=false;controls(); e.target.value='';}
};
$('pages').onchange=e=>openPage(Number(e.target.value));
$('view').onchange=draw;
async function processPage(){
  if(!source||busy)return;
  busy=true; controls(); selecting=false;
  try {
    delete page.error;
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
    if(failures)throw Error(page.regions.find(r=>r.error)?.error || 'Translation failed.');
  }catch(e){page.error=e.message;message('Processing stopped. '+e.message);}
  finally{busy=false;controls();}
};
$('run').onclick=processPage;
async function chapterAction(exporting) {
  if(chapterBusy||busy)return;
  const previous=Number($('pages').value),entries=[],report=[];
  let size=0;
  chapterBusy=true; controls();
  try {
    for(let i=0;i<chapter.length;i++){
      await openPage(i);
      if(source&&!exporting)await processPage();
      const issues=page.issues.length;
      report.push({file:page.file.name,regions:page.regions.length,issues:page.issues,error:page.error,
        status:source&&page.regions.length&&!issues&&!page.error?'complete':'review'});
      if(exporting){
        if(!source)throw Error('Cannot export unreadable page '+page.file.name);
        const blob=await new Promise(resolve=>output.toBlob(resolve));
        if(!blob)throw Error('PNG encoding failed.');
        size+=blob.size;
        if(size>256*1024*1024)throw Error('Export exceeds 256 MiB. Download individual pages.');
        entries.push({name:String(i+1).padStart(5,'0')+'.png',blob});
      }
    }
    if(exporting){
      entries.push({name:'report.json',blob:new Blob([JSON.stringify(report,null,2)])});
      const {createChapter}=await import('./archive.js');
      save(await createChapter(entries),'paneltranslate.cbz');
    }
    await openPage(previous);
    message(chapter.length+' pages · '+report.filter(p=>p.status==='review').length+' pages need review.');
  }catch(e){message(e.message);}finally{chapterBusy=false;controls();}
}
$('batch').onclick=()=>chapterAction(false);
$('chapterDownload').onclick=()=>chapterAction(true);
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
