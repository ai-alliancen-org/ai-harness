// Decorative local assets only. Catalog values never become image URLs or HTML.
(() => {
  const ASSETS = Object.freeze({
    anthropic: 'provider-anthropic.svg', openai: 'provider-openai.svg',
    mistral: 'provider-mistral.svg', ollama: 'provider-ollama.svg',
    openrouter: 'provider-openrouter.svg', azure: 'provider-azure.svg',
    corti: 'provider-corti.svg', alexandra: 'provider-alexandra.svg',
    zen: 'provider-zen.svg', compatible: 'provider-compatible.svg'
  });
  const PUBLISHERS = Object.freeze({ anthropic: 'anthropic', openai: 'openai', mistralai: 'mistral' });
  function asset(kind, modelID = '') {
    if (kind === 'openrouter' && typeof modelID === 'string') {
      const publisher = modelID.slice(0, modelID.indexOf('/'));
      if (modelID.includes('/') && Object.hasOwn(PUBLISHERS, publisher)) return ASSETS[PUBLISHERS[publisher]];
    }
    return typeof kind === 'string' && Object.hasOwn(ASSETS, kind) ? ASSETS[kind] : null;
  }
  function icon(kind, modelID, ownerDocument) {
    const src = asset(kind, modelID);
    if (!src || !ownerDocument?.createElement) return null;
    const image = ownerDocument.createElement('img');
    image.className = 'provider-brand-icon'; image.src = src; image.alt = '';
    image.width = 18; image.height = 18; image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }
  function decorate(button, { kind, modelID, label } = {}) {
    if (!button?.replaceChildren || !button.ownerDocument?.createElement) return;
    const text = button.ownerDocument.createElement('span'); text.className = 'provider-brand-label';
    text.textContent = label == null ? button.textContent : String(label);
    const image = modelID ? icon(kind, modelID, button.ownerDocument) : null;
    button.replaceChildren(...(image ? [image, text] : [text]));
  }
  const api = Object.freeze({ asset, icon, decorate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ProviderBrand = api;
})();
