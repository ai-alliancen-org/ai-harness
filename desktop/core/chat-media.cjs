// SPDX-License-Identifier: EUPL-1.2
const {createHash}=require('node:crypto');
const {imageInfo}=require('./image-info.cjs');
const {spawn}=require('node:child_process');
const path=require('node:path');
async function pdfText(data,{extractPDF}={}){
 if(extractPDF!==undefined){if(typeof extractPDF!=='function')throw Error('Den lokale PDF-læser kunne ikke startes.');return extractPDF(Buffer.from(data));}
 return new Promise((resolve,reject)=>{
  const node=require('./runtime.cjs').get()?.node || (process.versions.electron ? path.resolve(__dirname, '..', '.runtime', process.platform+'-'+process.arch, 'node', process.platform==='win32'?'node.exe':'bin/node') : process.execPath);
  const child=spawn(node,['--max-old-space-size=256',path.join(__dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked'),'pdf-text-worker.cjs')],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:path.dirname(node),NODE_NO_WARNINGS:'1'}});
  const out=[];let bytes=0,err='',settled=false;const timer=setTimeout(()=>{child.kill();finish(Error('PDF-læsningen tog for lang tid.'));},15000);
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  child.stdout.on('data',b=>{if(settled)return;bytes+=b.length;if(bytes>1024*1024){child.kill();finish(Error('PDF-resultatet er for stort.'));return;}out.push(Buffer.from(b));});
  child.stderr.on('data',b=>{err=(err+b.toString()).slice(-1000);});child.on('error',()=>finish(Error('Den lokale PDF-læser kunne ikke startes.')));
  child.on('close',code=>{if(code!==0)return finish(Error(err.includes('OCR')?'PDF’en indeholder ingen udtrækkelig tekst. Der er ikke udført OCR.':'PDF’en kunne ikke læses sikkert. Brug en almindelig, ukrypteret PDF med højst 100 sider.'));try{finish(null,JSON.parse(Buffer.concat(out,bytes).toString('utf8')));}catch{finish(Error('PDF-resultatet kunne ikke læses.'));}});
  child.stdin.on('error',()=>{});child.stdin.end(data);
 });
}

async function mediaSnapshot(data,kind,normalizeImage,{extractPDF}={}){
 if(kind==='pdf'){const extracted=await pdfText(data,{extractPDF});return {kind:'pdf',mime:'application/pdf',pages:extracted.pages,text:extracted.text,ocr:false};}
 if(typeof normalizeImage!=='function')throw Error('Sikker billedbehandling er ikke tilgængelig.');
 const original=imageInfo(data);if(!['image/png','image/jpeg'].includes(original.mime))throw Error('Vælg et PNG- eller JPEG-billede.');
 const image=await normalizeImage(data),info=imageInfo(image.data);
 if(image.mime!=='image/png'||info.mime!=='image/png'||image.data.length>1024*1024)throw Error('Billedet kunne ikke klargøres sikkert.');
 return {kind:'image',mime:'image/png',width:info.width,height:info.height,dataURL:`data:image/png;base64,${image.data.toString('base64')}`,normalizedBytes:image.data.length,normalizedHash:createHash('sha256').update(image.data).digest('hex'),text:''};
}
function addImages(body,images,{responses=false,anthropic=false,mistral=false}={}){
 if(!images?.length)return body;
 const messages=responses?body.input:body.messages;
 if(!Array.isArray(messages))throw Error('Billedmaterialet kunne ikke bindes til brugerens besked.');
 const message=[...messages].reverse().find(m=>m.role==='user');if(!message)throw Error('Billedmaterialet mangler en brugerbesked.');
 const content=typeof message.content==='string'?[{type:responses?'input_text':'text',text:message.content}]:Array.isArray(message.content)?[...message.content]:[];
 for(const image of images){
  if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image.dataURL||'')||image.dataURL.length>1500000)throw Error('Billedmaterialet er ændret.');
  content.push(responses?{type:'input_image',image_url:image.dataURL,detail:'auto'}:anthropic?{type:'image',source:{type:'base64',media_type:'image/png',data:image.dataURL.split(',')[1]}}:{type:'image_url',image_url:mistral?image.dataURL:{url:image.dataURL}});
 }
 message.content=content;return body;
}
module.exports={pdfText,mediaSnapshot,addImages};
