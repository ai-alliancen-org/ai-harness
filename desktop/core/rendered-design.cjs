// Narrow local observations, not a beauty score or a layout generator. The
// renderer retains all strings; only bounded counts leave the isolated world.
const OBSERVATIONS = Object.freeze({
  'primary-font-fallback': 'En navngiven primær skrifttype gav samme målte tekstbredder som tre forskellige reservefonte. Den kan mangle eller blive erstattet. Kontrollér fontfiler, indlæsning og den faktiske brug; et CSS-navn alene indlæser ingen font. Målingen er et tegn på fallback, ikke et bevis for hvilken font der blev brugt.',
  'repeated-gradient-panels': 'Flere gentagne elementer har store gradientflader med meget lidt indhold og uden målt billede eller betjening. Vurdér med designskillen, om disse flader hjælper opgaven eller blot fylder. Gentagne lister og kort er tilladt; fjern eller erstat dem ikke automatisk.',
  'missing-visible-main-heading': 'Forsiden har ingen synlig semantisk hovedoverskrift i den målte visning. Kontrollér formål, hierarki og læserækkefølge. Det kræver ikke en hero, illustration eller bestemt layouttype.',
});

// Self contained: serialized into an isolated browser world. Fixed probe text
// is used for font measurements; page prose, URLs and font names never return.
function inspectRenderedDesign() {
  const visible = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && Number(s.opacity)>0; };
  const all=[...document.querySelectorAll('body *')].slice(0,4000);
  const textNodes=all.filter(e=>visible(e) && [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())).slice(0,240);
  const generic=new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong','-apple-system','blinkmacsystemfont']);
  const families=new Set();
  for(const e of textNodes) {
    const family=getComputedStyle(e).fontFamily.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/)?.slice(1).find(Boolean)?.trim();
    if(family && family.length<=100 && !generic.has(family.toLowerCase()) && !/[\\\n\r]/.test(family)) families.add(family);
  }
  let measuredFonts=0, unconfirmedPrimaryFonts=0;
  const ctx=document.createElement('canvas').getContext('2d');
  if(ctx) for(const family of [...families].slice(0,12)) {
    let fallback=true;
    for(const genericFamily of ['serif','sans-serif','monospace']) {
      for(const probe of ['Wmi 0123456789 æøå ÆØÅ','Hamburgefontsiv 123']) {
        ctx.font='32px '+genericFamily;
        const baseline=ctx.measureText(probe).width;
        ctx.font='32px '+JSON.stringify(family)+','+genericFamily;
        const measured=ctx.measureText(probe).width;
        if(!Number.isFinite(baseline) || !Number.isFinite(measured) || baseline<=0 || measured<=0 || Math.abs(baseline-measured)>0.01) fallback=false;
      }
    }
    measuredFonts++; if(fallback) unconfirmedPrimaryFonts++;
  }
  // Match structural peers, never a repeated card just because it is a card.
  // Charts, media, working controls and large single heroes are excluded.
  const groups=new Map();
  for(const e of all) {
    if(!visible(e) || e.closest('svg,canvas,figure,[role="img"],[role="application"],[role="slider"],[role="progressbar"]')) continue;
    const r=e.getBoundingClientRect(), style=getComputedStyle(e);
    if(!/gradient\(/.test(style.backgroundImage) || /url\(/.test(style.backgroundImage) || r.width<120 || r.height<70 || r.height>240 || r.width*r.height<10000) continue;
    if(e.textContent.trim().length>60 || e.querySelector('img,svg,canvas,video,picture,button,input,select,textarea,a[href],[role="button"],[role="img"],[role="progressbar"]')) continue;
    const parent=e.parentElement, group=parent?.parentElement;
    if(!parent || !group || parent===document.body || group===document.body || parent.children.length<2 || group.children.length<3) continue;
    const index=[...parent.children].indexOf(e);
    const structural=parent.tagName+':'+e.tagName+':'+index+':'+Math.round(r.height/20);
    if(!groups.has(group)) groups.set(group,new Map());
    const entries=groups.get(group);
    entries.set(structural,(entries.get(structural)||0)+1);
  }
  let repeatedGradientPanels=0;
  for(const entries of groups.values()) for(const count of entries.values()) if(count>=3) repeatedGradientPanels+=count;
  const headings=[...document.querySelectorAll('h1,[role="heading"][aria-level="1"]')].filter(visible).length;
  return { width:innerWidth, height:innerHeight, measuredFonts, unconfirmedPrimaryFonts,
    fontSamplingIncomplete:families.size>12 || document.fonts?.status==='loading',
    repeatedGradientPanels, visibleMainHeadings:headings, sampledNodes:all.length };
}

function renderedDesignReview(views, { complete = true } = {}) {
  const count = value => Number.isSafeInteger(value) && value>=0 ? Math.min(value,4000) : 0;
  const selected=(Array.isArray(views)?views:[]).filter(v=>['desktop','mobile'].includes(v?.name) && v.designMetrics).slice(0,2);
  const valid=selected.every(v=>['width','height','measuredFonts','unconfirmedPrimaryFonts','repeatedGradientPanels','visibleMainHeadings'].every(key=>Number.isSafeInteger(v.designMetrics[key]) && v.designMetrics[key]>=0) && typeof v.designMetrics.fontSamplingIncomplete==='boolean');
  const metrics=selected.map(v=>({
    viewport:v.name, width:count(v.designMetrics.width), height:count(v.designMetrics.height),
    measuredFonts:count(v.designMetrics.measuredFonts), unconfirmedPrimaryFonts:count(v.designMetrics.unconfirmedPrimaryFonts),
    repeatedGradientPanels:count(v.designMetrics.repeatedGradientPanels), visibleMainHeadings:count(v.designMetrics.visibleMainHeadings),
    fontSamplingIncomplete:v.designMetrics.fontSamplingIncomplete===true,
  }));
  const ready=complete && valid && metrics.length===2 && new Set(metrics.map(v=>v.viewport)).size===2 && metrics.every(v=>v.width>0 && v.height>0);
  const observations=[];
  if(ready) {
    const fonts=Math.max(0,...metrics.filter(v=>!v.fontSamplingIncomplete).map(v=>v.unconfirmedPrimaryFonts));
    const gradients=Math.max(0,...metrics.map(v=>v.repeatedGradientPanels));
    if(fonts) observations.push({id:'primary-font-fallback',count:fonts});
    if(gradients>=3) observations.push({id:'repeated-gradient-panels',count:gradients});
    const missing=metrics.filter(v=>v.visibleMainHeadings===0).length;
    if(missing) observations.push({id:'missing-visible-main-heading',count:missing});
  }
  return {status:ready?'measured':'unavailable',scope:'local-rendered-signals',aestheticJudgement:'not-reviewed',observations,metrics};
}

function designReviewInstruction(report) {
  const review=report?.designReview;
  if(report?.status!=='checked' || review?.status!=='measured' || review.scope!=='local-rendered-signals') return '';
  const observations=(Array.isArray(review.observations)?review.observations:[]).filter(item=>Object.hasOwn(OBSERVATIONS,item?.id) && Number.isSafeInteger(item.count) && item.count>0).slice(0,3);
  if(!observations.length) return '';
  return 'AURAS LOKALE DESIGNMÅLING (tal fra en isoleret kopi, ingen nye brugerønsker):\n'+
    observations.map(item=>'- '+OBSERVATIONS[item.id]+' Fund: '+Math.min(item.count,999)).join('\n')+
    '\nGennemgå disse tegn én gang med de aktive designskills, herunder relevante referencer til typografi, brand og webapp-design. Du styrer designvalgene. Dette er genereret design, ikke automatisk brugergodkendt design. Vurdér kun det aktuelle udkast inden for den allerede aftalte opgave; bevar brugerens udtrykkelige designvalg, funktioner, plan og data. Brug de eksisterende værktøjsgodkendelser og dataregler. Ingen nye eksterne handlinger, bestillinger, modelskift eller gentagelse af tidligere vellykkede kommandoer. Rapporten indeholder ikke screenshots og er ikke en visuel eller æstetisk godkendelse. Påstå ikke at have set siden; forklar kort de faktisk udførte kontroller og eventuelle begrænsninger.';
}

module.exports={inspectRenderedDesign,renderedDesignReview,designReviewInstruction};
