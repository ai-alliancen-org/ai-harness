(function (root) {
  // Kun fulde hex-farver. Tekst og kode forbliver tekst, også hvis modellen sender HTML.
  function swatches(element) {
    const document = element.ownerDocument;
    const walker = document.createTreeWalker(element, 4);
    const texts = []; let text;
    while ((text = walker.nextNode())) if (!text.parentElement.closest('pre, a, .color-value, .color-swatch')) texts.push(text);
    for (const text of texts) {
      const pattern = /(?<![\w/#])#(?:[a-f\d]{8}|[a-f\d]{6}|[a-f\d]{4}|[a-f\d]{3})(?![\w-])/gi;
      const matches = [...text.textContent.matchAll(pattern)]; if (!matches.length) continue;
      const fragment = document.createDocumentFragment(); let offset = 0;
      for (const match of matches) {
        fragment.append(text.textContent.slice(offset, match.index));
        const value = document.createElement('span'); value.className = 'color-value';
        const square = document.createElement('span'); square.className = 'color-swatch'; square.style.setProperty('--swatch-color', match[0]);
        square.setAttribute('role', 'img'); square.setAttribute('aria-label', `Farve ${match[0]}`); square.title = match[0];
        value.append(square, match[0]); fragment.append(value); offset = match.index + match[0].length;
      }
      fragment.append(text.textContent.slice(offset)); text.replaceWith(fragment);
    }
  }
  function phase(view) {
    if (view.waitingFor?.length) return '';
    const p = view.modelProgress;
    if (!p || p.phase === 'received') return '';
    return ({ waiting: 'Venter på udbyderen …', reasoning: 'Modellen forbereder næste skridt …', text: 'AI’en skriver et svar …', tool: p.draft ? `Modtager kode til ${p.draft.file} …` : 'Modellen forbereder en handling …' })[p.phase] || '';
  }
  function progress(view, now = Date.now()) {
    const silence = Math.max(0, Math.floor((now - (view.lastSignalAt || view.runStartedAt)) / 1000));
    if (view.waitingFor?.length) return { quiet: false, stalled: false, text: '' };
    // Efter et minut uden signaler er opgaven reelt gået i stå. Keepalive tæller ikke som signal. Brugeren får en klar vej ud.
    if (silence >= 60) return { quiet: true, stalled: true, text: `Ingen svar fra modellen i ${silence >= 120 ? Math.round(silence / 60) + ' min' : silence + ' s'}. Udbyderen kan have travlt. Vent, eller stop og prøv igen.` };
    const p = view.modelProgress;
    if (p && silence < 15 && p.phase === 'reasoning') return { quiet: false, stalled: false, text: 'Der kommer fortsat signaler fra modellen. Intet nyt svar eller filindhold endnu.' };
    if (p && silence < 15 && p.phase === 'tool') return { quiet: false, text: p.draft ? (p.draft.hidden ? 'Indhold med mulige nøgler skjules.' : `${p.draft.lines} linjer modtaget · ikke gemt endnu`) : 'Handlingen vises, når modellen har sendt dens oplysninger.' };
    const received = view.receivedChars ? `${view.receivedChars.toLocaleString('da-DK')} tegn modtaget` : '';
    return { quiet: silence >= 15, stalled: false, text: silence >= 15 ? `Ingen nye signaler i ${silence} s. Du kan vente eller stoppe.` : received || 'Venter på svar fra AI’en.' };
  }
  // Lyskanten om skrivefeltet: den drejer, mens AI'en arbejder, og står stille, når der ikke kommer signaler.
  // Venter opgaven på brugeren, er der ingen kant, så kortet med valget står alene. Efter forslag i #18.
  function workState(view, now = Date.now()) {
    if (!view.running) return 'idle';
    if (view.waitingFor?.length) return 'waiting';
    return progress(view, now).quiet ? 'quiet' : 'working';
  }
  const api = { swatches, progress, phase, workState };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatDisplay = api;
})(typeof window === 'undefined' ? globalThis : window);
