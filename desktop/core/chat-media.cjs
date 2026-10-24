// SPDX-License-Identifier: EUPL-1.2
const {createHash}=require('node:crypto');
const {imageInfo}=require('./image-info.cjs');
async function mediaSnapshot(data,kind,normalizeImage,{extractPDF}={}){
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
module.exports={mediaSnapshot,addImages};
