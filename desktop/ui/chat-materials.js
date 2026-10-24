// SPDX-License-Identifier: EUPL-1.2
// Exact read-only snapshots. Paths and authority stay in the main process.
window.ChatMaterials = { connect(api) {
  const $ = id => document.getElementById(id), el = (tag,text) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; return n; };
  const dialog=$('chat-materials-dialog'), status=$('chat-materials-status'), chips=$('chat-materials-chips');
  let owner=null, state=null, epoch=0, busy=false, review=null;
  const key=value=>JSON.stringify([value?.root,value?.chat]);
  const same=value=>owner===value && key(api.read())===value.key;
  const handle=()=>state && ({scope:state.scope,revision:state.revision});
  function button(text,action,primary=false) { const n=el('button',text);n.type='button';if(primary)n.className='primary';n.onclick=action;return n; }
  function controls() {
    const disabled=!owner||!state||busy||api.read().running;
    for(const n of document.querySelectorAll('[data-material-picker],#chat-materials-chips button'))n.disabled=disabled;
    for(const n of dialog.querySelectorAll('button,input'))n.disabled=busy||api.read().running;
    const attach=$('materials-attach');if(attach)attach.disabled=busy||api.read().running||!review;
    const next=$('materials-next');if(next){const count=dialog.querySelectorAll('input:checked').length;next.disabled=busy||api.read().running||count<1||count>8;}
  }
  function apply(next) {
    if(next?.chat!==owner?.chat || !Array.isArray(next.selected) || !Array.isArray(next.candidates))throw Error('Filvalget tilhører ikke den aktuelle samtale.');
    if(state?.scope===next.scope && next.revision<state.revision)return;
    state=next;chips.replaceChildren();chips.hidden=!state.selected.length;
    for(const file of state.selected){const item=el('span');item.className='material-chip';item.append(el('span',(file.changed?'Ændret: ':'')+[file.folder,file.name].filter(Boolean).join('/')),button('×',()=>perform('chatMaterialsRemove',{...handle(),id:file.id},apply)));chips.append(item);item.lastChild.setAttribute('aria-label','Fjern vedhæftning '+file.name);}
    controls();
  }
  async function refresh(){const current=owner,ticket=epoch;if(!current)return;try{const next=await api.invoke('chatMaterialsState',{chat:current.chat},current);if(same(current)&&ticket===epoch)apply(next);}catch(error){if(same(current)){status.textContent=error.message;status.hidden=false;}}}
  async function perform(method,input,after){if(busy||!owner||api.read().running)return;const current=owner,ticket=epoch;busy=true;controls();status.textContent='Kontrollerer det lokale filvalg …';status.hidden=false;
    try{const next=await api.invoke(method,{chat:current.chat,...input},current);if(!same(current)||ticket!==epoch)return;if(next.cancelled)apply(next);else await after(next);status.hidden=true;api.invalidate();}
    catch(error){if(same(current)&&ticket===epoch){review=null;status.textContent=error.message;status.hidden=false;const feedback=$('materials-feedback');if(feedback)feedback.textContent=error.message;}}
    finally{if(same(current)&&ticket===epoch){busy=false;controls();}}
  }
  function close(){epoch++;busy=false;status.hidden=true;const pending=review;review=null;if(dialog.open)dialog.close();if(pending&&owner)void api.invoke('chatMaterialsRemove',{chat:owner.chat,scope:pending.scope,revision:pending.revision,id:pending.token},owner).catch(()=>{});controls();$('chat-materials-files').focus();}
  function base(title,note){dialog.replaceChildren();const heading=el('h2',title);heading.id='materials-title';dialog.append(heading,el('p',note));const feedback=el('p');feedback.id='materials-feedback';feedback.setAttribute('role','status');dialog.append(feedback);}
  function candidates(next){apply(next);review=null;base(next.folder?'Vælg filer fra referencemappen':'Gennemgå de valgte filer','Vælg præcis de filer, du vil gennemgå. Kun navne og størrelser er hentet indtil nu. Ingen hel mappe medsendes.');
    if(next.truncated)dialog.append(el('p','Listen er afgrænset til 100 filer, 250 mappeposter og tre undermappeniveauer. Vælg en mindre mappe for at se mere.'));
    const list=el('div');list.className='material-candidates';
    for(const file of next.candidates){const row=el('label'),check=el('input');check.type='checkbox';check.value=file.id;check.checked=!next.folder;check.onchange=controls;row.className='check-label';row.append(check,el('span',`${file.name} · ${file.bytes.toLocaleString('da-DK')} bytes`));list.append(row);}dialog.append(list);
    const nextButton=button('Gennemgå indhold',()=>perform('chatMaterialsPreview',{...handle(),ids:[...list.querySelectorAll('input:checked')].map(n=>n.value)},preview),true);nextButton.id='materials-next';
    const actions=el('div');actions.className='dialog-actions';actions.append(button('Annuller',close),nextButton);dialog.append(actions);if(!dialog.open)dialog.showModal();controls();
  }
  function materialContent(file) {
    if (file.kind === 'pdf') {
      const block = el('div'), select = el('select'), text = el('pre'); select.setAttribute('aria-label','Vælg PDF-side');
      block.append(el('p','Udtrukket PDF-tekst med sidetal. Ingen OCR eller billedanalyse er udført.'));
      for (const page of file.pages || []) { const option = el('option', 'Side ' + page.page); option.value = String(page.page); select.append(option); }
      select.onchange = () => { text.textContent = file.pages.find(page => String(page.page) === select.value)?.text || ''; }; select.onchange(); text.tabIndex = 0;
      block.append(select, text); return block;
    }
    if (file.kind !== 'image') return el('pre', file.text);
    const block = el('div');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(file.dataURL || '')) { block.textContent = 'Billedet kunne ikke vises. Gennemgå filvalget igen.'; return block; }
    const image = el('img'); image.src = file.dataURL; image.alt = file.name; image.className = 'material-image';
    block.append(image, el('p', `Normaliseret PNG · ${file.width} × ${file.height} · SHA-256 ${file.normalizedHash}`)); return block;
  }
  function preview(next){review=next;base('Dette indhold kan medsendes','Det gennemgåede indhold kan medsendes efter den normale modtager- og datagennemgang. Kildemappen bliver ikke et værktøjsområde.');
    for(const file of next.files){const section=el('section');section.append(el('h3',[file.folder,file.name].filter(Boolean).join('/')),el('small',`${file.bytes.toLocaleString('da-DK')} bytes · SHA-256 ${file.sha256}`),materialContent(file));dialog.append(section);}
    const actions=el('div');actions.className='dialog-actions';actions.append(button('Annuller',close),button('Tilføj de gennemgåede filer',()=>{const pending=review;if(pending)void perform('chatMaterialsAttach',{scope:pending.scope,revision:pending.revision,token:pending.token},value=>{review=null;apply(value);dialog.close();});},true));actions.lastChild.id='materials-attach';dialog.append(actions);controls();
  }
  function sync(){const next=api.read(),id=next.root&&next.chat?key(next):null;if(id!==owner?.key){epoch++;owner=id?{...next,key:id}:null;state=null;busy=false;review=null;chips.replaceChildren();chips.hidden=true;status.hidden=true;if(dialog.open)dialog.close();if(owner)void refresh();}controls();}
  for(const n of document.querySelectorAll('[data-material-picker]'))n.onclick=()=>perform(n.dataset.materialPicker,{},candidates);
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)close();});
  window.harness.onEvent(event=>{if(event.type==='chat-materials.changed'&&event.chat===owner?.chat){api.invalidate();if(!busy)void refresh();}});
  window.chatMaterials={sync,selection:()=>state?.selected.length?handle():null};sync();
}, disclose(materials) {
  const target=document.getElementById('data-materials');target.replaceChildren();target.hidden=!materials;
  if(!materials)return;
  const heading=document.createElement('h3');heading.textContent='Vedhæftninger · præcist indhold';target.append(heading);
  for(const file of materials.files){const name=document.createElement('p'),text=document.createElement('pre');name.textContent=[file.folder,file.name].filter(Boolean).join('/');if (file.kind === 'image' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(file.dataURL || '')) { const image = document.createElement('img'); image.src = file.dataURL; image.alt = file.name; image.className = 'material-image'; target.append(name, image); } else { text.textContent=file.text; target.append(name,text); }}
} };
