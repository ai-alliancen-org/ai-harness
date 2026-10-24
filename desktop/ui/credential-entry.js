const input=document.getElementById('credential'),form=document.getElementById('credential-form');
void window.auraKeyEntry.context().then(value=>{document.getElementById('destination').textContent=`${value.name} · ${value.endpoint}`;if(value.kind==='github')document.querySelector('label[for=credential]').textContent=value.label;}).catch(()=>{input.disabled=true;document.getElementById('feedback').textContent='Forbindelsen kunne ikke bekræftes. Luk vinduet og prøv igen.';});
form.addEventListener('submit',async event=>{event.preventDefault();const value=input.value;input.value='';try{await window.auraKeyEntry.submit(value);}catch{document.getElementById('feedback').textContent='Nøglen kunne ikke klargøres. Indtast den igen.';input.focus();}});
document.getElementById('cancel').onclick=()=>window.auraKeyEntry.cancel();
window.addEventListener('keydown',event=>{if(event.key==='Escape')void window.auraKeyEntry.cancel();});
