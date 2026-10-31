// Local, host-owned network metadata. No model content or credential fields.
(() => {
  const open = document.getElementById('network-report-open');
  if (!open) return;
  const dialog = document.createElement('dialog');dialog.id='network-report-dialog';dialog.setAttribute('aria-labelledby','network-report-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><p class="network-eyebrow">LOKAL NETVÆRKSRAPPORT</p><h2 id="network-report-title">Auras registrerede kald</h2></div><button type="button" data-network-close aria-label="Luk rapport">Luk</button></div>
    <p class="network-coverage">Auras egne registrerede kald på denne computer. Rapporten er fælles for dine projekter. Ingen nøgler, beskeder eller filindhold gemmes her.</p>
    <details id="network-coverage"><summary>Hvad er dækket?</summary><ul id="network-coverage-list"></ul><p>Andre programmer og trafik uden for Auras registreringspunkter er ikke dækket. Ikke registreret betyder ikke, at der ingen trafik var.</p></details>
    <div class="network-filters"><label>Periode<select id="network-period"><option value="session">Denne appkørsel</option><option value="5m">Seneste 5 minutter</option><option value="all">Alle gemte registreringer</option></select></label><label>Type<select id="network-category"><option value="">Alle typer</option></select></label><label>Status<select id="network-status"><option value="">Alle statusser</option><option value="completed">Gennemført</option><option value="failed">Fejl</option><option value="cancelled">Afbrudt</option><option value="attempted">Venter på svarheaders</option><option value="headers">Venter på indhold</option><option value="receiving">Modtager</option><option value="interrupted">Uafsluttet ved genstart</option></select></label></div>
    <p id="network-report-summary"></p><p id="network-report-retention" class="hint"></p>
    <div class="network-table-scroll" role="region" aria-label="Registrerede kald, rul vandret for flere oplysninger" tabindex="0"><table><thead><tr><th>Tid</th><th>Destination / formål</th><th>Metode</th><th>Status</th><th>HTTP-svar</th><th>Første bytes</th><th>Samlet</th><th>Sendt / modtaget</th></tr></thead><tbody id="network-report-rows"></tbody></table></div>
    <p id="network-report-empty" hidden>Ingen registrerede kald passer til filtrene.</p><p class="hint">HTTP-svar er tid til svarheaders. Første bytes er første registrerede indholdsbytes, ikke første teksttoken. Tiderne måler ikke udbyderens interne kø. Byteantal er applikationsdata, ikke al krypteret netværkstrafik.</p>
    <p id="network-report-feedback" role="status"></p><div class="dialog-actions"><span class="hint">Eksport følger det valgte filter og indeholder dækningsoversigten.</span><button type="button" id="network-report-refresh">Opdatér</button><button type="button" id="network-report-csv">CSV</button><button type="button" id="network-report-json">JSON</button><button type="button" data-network-close>Luk rapport</button></div>`;
  document.body.append(dialog);
  const el = id => document.getElementById(id);
  const labels = {model:'AI-model',catalog:'Modelkatalog',integration:'Integration',preview:'Forhåndsvisning',git:'Git',update:'Opdateringer',subprocess:'Underprocesser'};
  const statuses = {completed:'Gennemført',failed:'Fejl',cancelled:'Afbrudt',attempted:'Venter på svarheaders',headers:'Venter på indhold',receiving:'Modtager indhold',interrupted:'Uafsluttet ved genstart'};
  const purposes = {'model-response':'AI-arbejde','model-catalog':'Hent modeller','route-catalog':'Hent modelruter','integration':'Ekstern handling','browser-http':'Webhandling'};
  let snapshot = null, request = 0;
  const filters = () => ({period:el('network-period').value,category:el('network-category').value,status:el('network-status').value});
  const formatTime = value => typeof value === 'number' && Number.isFinite(value) ? `${(value/1000).toLocaleString('da-DK',{maximumFractionDigits:2})} s` : 'Ikke målt';
  const formatBytes = value => typeof value === 'number' && Number.isFinite(value) ? `${(value/1000).toLocaleString('da-DK',{maximumFractionDigits:1})} kB` : 'Ikke målt';
  const text = (tag,value) => {const element=document.createElement(tag);element.textContent=value;return element;};
  function selectedRows() {
    const f=filters(), since=f.period==='5m'?Date.now()-300000:f.period==='session'?Date.parse(snapshot.startedAt):0;
    return snapshot.records.filter(row=>(!f.category||row.category===f.category)&&(!f.status||row.status===f.status)&&(!since||Date.parse(row.startedAt)>=since));
  }
  function render() {
    if (!snapshot) return;
    const rows=selectedRows(), body=el('network-report-rows');body.replaceChildren();
    for(const row of [...rows].reverse()) {
      const tr=document.createElement('tr');
      tr.append(text('td',new Date(row.startedAt).toLocaleTimeString('da-DK')));
      const destination=text('td',row.host || 'Ukendt destination');destination.append(text('small',purposes[row.purpose]||labels[row.category]||'Registreret kald'));
      if(row.locality==='loopback')destination.append(text('small','Lokal transportadresse'));
      tr.append(destination,text('td',row.method || 'Ikke oplyst'),text('td',`${statuses[row.status]||'I gang'}${row.httpStatus ? ' · '+row.httpStatus : ''}`),text('td',formatTime(row.headersMs)),text('td',formatTime(row.firstBodyMs)),text('td',row.totalMs === null && ['attempted','headers','receiving'].includes(row.status) ? `${formatTime(Math.max(0, Date.parse(snapshot.generatedAt)-Date.parse(row.startedAt)))} · i gang` : formatTime(row.totalMs)));
      const bytes=text('td',formatBytes(row.sentBytes));bytes.append(text('small',formatBytes(row.receivedBytes)));tr.append(bytes);body.append(tr);
    }
    const destinations=new Set(rows.map(row=>row.host).filter(Boolean)).size;
    el('network-report-summary').textContent=`${rows.length} registrerede kald · ${destinations} ${destinations===1?'destination':'destinationer'}`;
    el('network-report-empty').hidden=rows.length>0;
    el('network-report-retention').textContent=`${snapshot.dropped?`${snapshot.dropped} ældre registreringer er ikke længere i rapporten. `:''}${snapshot.persistence?.status==='unavailable'?'Lokal lagring fejlede; kun de tilgængelige registreringer vises. ':''}Rapporten viser et øjebliksbillede. Vælg Opdatér for nye kald.`;
  }
  async function load() {
    const ticket=++request;el('network-report-feedback').textContent='Henter lokale registreringer …';
    for(const format of ['csv','json'])el(`network-report-${format}`).disabled=true;
    try {
      const response=await window.harness.networkReport(undefined,null);if(ticket!==request||!dialog.open)return;
      if(!response.ok)throw new Error(response.error);
      snapshot=response.value;
      const category=el('network-category'), previous=category.value;category.replaceChildren(new Option('Alle typer',''));
      for(const [key,label] of Object.entries(labels))category.append(new Option(label,key));category.value=previous;
      const coverage=el('network-coverage-list');coverage.replaceChildren();
      for(const item of snapshot.coverage || [])coverage.append(text('li',`${labels[item.category]||item.category}: ${item.note}`));
      for(const limit of snapshot.limits || [])coverage.append(text('li',limit));
      el('network-report-feedback').textContent='';render();
      for(const format of ['csv','json'])el(`network-report-${format}`).disabled=false;
    } catch {if(ticket===request)el('network-report-feedback').textContent='Rapporten kunne ikke læses. Prøv Opdatér.';}
  }
  open.addEventListener('click',()=>{dialog.showModal();el('network-period').focus();void load();});
  for(const button of dialog.querySelectorAll('[data-network-close]'))button.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{++request;open.focus();});
  for(const id of ['network-period','network-category','network-status'])el(id).addEventListener('change',render);
  el('network-report-refresh').onclick=load;
  for(const format of ['csv','json'])el(`network-report-${format}`).onclick=async()=>{
    if(!snapshot)return;
    const ticket=request, button=el(`network-report-${format}`);button.disabled=true;
    try{const response=await window.harness.networkReportSave({format,filters:filters()},null);if(ticket!==request||!dialog.open)return;if(!response.ok)throw new Error(response.error);el('network-report-feedback').textContent=response.value?'Rapporten er gemt lokalt. Rapporten er ikke sendt.':'Eksporten blev annulleret.';}
    catch{if(ticket===request&&dialog.open)el('network-report-feedback').textContent='Rapporten kunne ikke gemmes. Prøv igen.';}
    finally{if(ticket===request&&dialog.open)button.disabled=false;}
  };
})();
