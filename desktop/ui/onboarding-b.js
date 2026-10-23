// Onboarding B is a presentation layer. Existing controllers remain responsible
// for connections, models, data review, plans, permissions and project creation.
// The Claude and Mistral marks are unmodified official identification assets;
// their provenance is recorded in provider-icons-LICENSE.txt. Other provider
// marks retain the original local assets and their existing attribution.
(function (scope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope) scope.OnboardingB = api;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const PROVIDERS = Object.freeze(Object.fromEntries(Object.entries({
    anthropic: { name: 'Claude', logo: 'onboarding-provider-claude.svg', accent: '#d97757' },
    openai: { name: 'OpenAI', logo: 'provider-openai.svg', accent: '#45474f' },
    mistral: { name: 'Mistral', logo: 'onboarding-provider-mistral.svg', accent: '#fa500f' },
    ollama: { name: 'Ollama', logo: 'provider-ollama.svg', accent: '#45474f' },
    azure: { name: 'Azure', logo: 'provider-azure.svg', accent: '#0078d4' },
    alexandra: { name: 'Alexandra', logo: 'provider-alexandra.svg', accent: '#001b4f' },
    corti: { name: 'Corti', logo: 'provider-corti.svg', accent: '#45474f' },
    zen: { name: 'OpenCode Zen', logo: 'provider-zen.svg', accent: '#45474f' },
    compatible: { name: 'Egen server', logo: 'provider-compatible.svg', accent: '#737581' },
    openrouter: { name: 'OpenRouter', logo: 'provider-openrouter.svg', accent: '#6467b9' }
  }).map(([key, value]) => [key, Object.freeze(value)])));
  const PHASES = new Set(['provider', 'connection', 'model', 'idea', 'choice', 'features']);
  const ICONS = Object.freeze({
    check: 'm5 12 4.5 4.5L19 7',
    lock: 'M6 10h12v11H6ZM9 10V7a3 3 0 0 1 6 0v3',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
    screen: 'M3 4h18v13H3ZM8 21h8m-4-4v4',
    cpu: 'M7 7h10v10H7ZM10 10h4v4h-4ZM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
    note: 'M8 5H5v16h14V5h-3M9 3h6v4H9ZM8 11h8m-8 4h6',
    arrow: 'M4 12h16m-5-5 5 5-5 5'
  });
  const knownKind = kind => typeof kind === 'string' && Object.hasOwn(PROVIDERS, kind) ? kind : '';
  function provider(kind) { return PROVIDERS[knownKind(kind) || 'compatible']; }
  function make(doc, tag, className, text) {
    const item = doc.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = String(text);
    return item;
  }
  function icon(doc, kind) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', ICONS[kind] || ICONS.shield); svg.append(path); return svg;
  }
  function image(doc, source, className) {
    const item = make(doc, 'img', className); item.src = source; item.alt = ''; item.draggable = false;
    item.setAttribute('aria-hidden', 'true'); return item;
  }
  function pathNode(doc, { label, note, logo, glyph, active }) {
    const node = make(doc, 'div', 'onboarding-b-route-node'), tile = make(doc, 'span', 'onboarding-b-route-tile');
    node.dataset.active = String(active === true); tile.append(logo ? image(doc, logo) : icon(doc, glyph));
    node.append(tile, make(doc, 'strong', null, label), make(doc, 'small', null, note)); return node;
  }
  function render(root, state = {}) {
    if (!root?.ownerDocument?.createElement) return;
    state = state && typeof state === 'object' ? state : {};
    const doc = root.ownerDocument, kind = knownKind(state.kind), current = kind ? provider(kind) : null;
    const phase = PHASES.has(state.phase) ? state.phase : 'choice';
    const pending = state.pending === true, failed = Boolean(state.error);
    const preview = state.preview === true || phase === 'provider';
    const checked = state.checked === true && !pending && !failed && !preview, saved = state.saved === true;
    const modelChosen = state.modelChosen === true && Boolean(state.modelName);
    const modelName = typeof state.modelName === 'string' ? state.modelName : '';
    const connectionName = typeof state.connectionName === 'string' ? state.connectionName : '';
    root.classList.add('onboarding-b-visual'); root.dataset.kind = kind; root.dataset.phase = phase;
    root.dataset.verified = String(checked); root.dataset.pending = String(pending);
    root.setAttribute('aria-label', 'Din opsætning');
    const top = make(doc, 'div', 'onboarding-b-visual-top');
    top.append(make(doc, 'span', null, 'Din opsætning'), make(doc, 'span', 'onboarding-b-live-tag', 'Følger dit valg'));
    const art = make(doc, 'div', 'onboarding-b-art'); art.setAttribute('aria-hidden', 'true');
    const ring = make(doc, 'div', 'onboarding-b-art-ring'), hero = make(doc, 'span', 'onboarding-b-hero');
    hero.append(image(doc, current?.logo || 'onboarding-aura-mark.svg')); ring.append(hero);
    const orbit = (source, glyph, index) => {
      const item = make(doc, 'span', `onboarding-b-orbit onboarding-b-orbit-${index}`);
      item.append(source ? image(doc, source) : icon(doc, glyph)); ring.append(item);
    };
    if (current) { orbit('onboarding-aura-mark.svg', null, 0); orbit(modelChosen ? current.logo : null, 'lock', 1); }
    else { orbit(provider('anthropic').logo, null, 0); orbit(provider('openai').logo, null, 1); orbit(provider('ollama').logo, null, 2); orbit(provider('mistral').logo, null, 3); }
    art.append(ring, make(doc, 'span', 'onboarding-b-art-pill', phase === 'idea' ? 'Fra dine ord til noget, du kan bygge' : 'Forbindelse og model er to valg'));
    const copy = make(doc, 'div', 'onboarding-b-visual-copy'), title = make(doc, 'h2', 'onboarding-b-visual-heading');
    title.append(make(doc, 'span', null, phase === 'model' && modelChosen ? modelName : current?.name || 'Din AI'), make(doc, 'em', null, phase === 'model' && modelChosen ? 'i dit projekt.' : phase === 'idea' ? 'og din idé.' : 'møder Aura.'));
    const description = phase === 'features' ? 'Du vælger, hvad Aura skal hjælpe med. Planer og godkendelser følger stadig det samme forløb.' : phase === 'model' ? 'Vælg den model, du vil arbejde med. Modtager og vilkår gennemgås, før du sender noget.' : phase === 'idea' ? 'Beskriv det, du vil bygge. Din forbindelse og dine projektvalg er lige ved hånden.' : preview && current ? 'Se den forbindelse, du kigger på. Åbn kortet, når du vil indtaste dine oplysninger.' : current ? 'Forbindelsen er din adgang til AI. Modellen vælger du i projektet, og du kan ændre valget senere.' : 'Begynd med den adgang, du allerede har. Projektfiler og gemte valg bliver på din computer.';
    copy.append(title, make(doc, 'p', 'onboarding-b-visual-description', description));
    if (connectionName) copy.append(make(doc, 'p', 'onboarding-b-connection-name', connectionName));
    const route = make(doc, 'div', 'onboarding-b-data-path');
    const arrow = active => { const item = make(doc, 'span', 'onboarding-b-route-arrow'); item.dataset.active = String(active === true); item.setAttribute('aria-hidden', 'true'); item.append(icon(doc, 'arrow')); return item; };
    route.append(pathNode(doc, { label: 'Din computer', note: 'Aura', glyph: 'screen', active: true }), arrow(Boolean(current)), pathNode(doc, { label: current?.name || 'Forbindelse', note: preview ? 'Forhåndsvisning' : checked ? 'Kontrolleret' : saved ? 'Gemt lokalt' : current ? 'Valgt' : 'Dit næste valg', logo: current?.logo, glyph: 'lock', active: Boolean(current) }), arrow(modelChosen), pathNode(doc, { label: modelChosen ? modelName : 'Model', note: modelChosen ? 'Valgt i projektet' : 'Vælges i projektet', glyph: 'cpu', active: modelChosen }));
    const note = make(doc, 'p', 'onboarding-b-visual-note'); note.dataset.verified = String(checked); note.dataset.state = pending ? 'pending' : failed ? 'error' : checked ? 'checked' : saved ? 'saved' : 'unselected';
    const message = pending ? 'Forbindelsen kontrolleres. Der sendes ingen projektfiler.' : failed ? 'Forbindelsen kræver din gennemgang. Dine valg er bevaret.' : checked ? 'Modelkataloget svarer. Model og kvote afprøves ved første AI-besked.' : saved ? 'Forbindelsen er gemt lokalt. Adgangen er endnu ikke kontrolleret i denne session.' : 'Dit valg forbinder eller sender ikke noget.';
    note.append(icon(doc, checked ? 'check' : 'shield'), make(doc, 'span', null, message));
    root.replaceChildren(top, art, copy, route, note);
  }
  function decorateProviderCard(card, kind) {
    if (!card?.ownerDocument?.createElement) return;
    const info = provider(kind), doc = card.ownerDocument;
    card.dataset.kind = knownKind(kind) || 'compatible';
    let logo = card.querySelector('img');
    if (!logo) { logo = image(doc, info.logo, 'onboarding-b-card-logo'); card.prepend(logo); }
    logo.src = info.logo; logo.alt = ''; logo.draggable = false;
    // aria-pressed and all event handlers belong to the existing controller.
    if (!card.querySelector('.onboarding-b-choice-mark')) {
      const mark = make(doc, 'span', 'onboarding-b-choice-mark'); mark.setAttribute('aria-hidden', 'true'); mark.append(icon(doc, 'check')); card.append(mark);
    }
  }
  return Object.freeze({ provider, render, decorateProviderCard });
});
