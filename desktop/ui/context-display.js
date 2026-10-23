// Senest målte modelkald, aldrig en beregning ud fra samtalens samlede tokens.
(() => {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const windowSize = value => Number.isSafeInteger(value) && value > 0 ? value : null;
  function project(selected = {}, snapshot = null, model = null, catalogConnectionID = selected.connectionID) {
    const binding = snapshot?.binding;
    const matched = Boolean(binding && selected.connectionID && selected.modelID &&
      ['connectionID', 'modelID', 'routeID'].every(key => binding[key] === (selected[key] || '')) &&
      typeof binding.sessionID === 'string' && binding.sessionID && typeof binding.engineID === 'string' && binding.engineID);
    const input = matched && snapshot?.known === true && snapshot.source === 'engine-step-finish' && snapshot.reliability === 'last-request' ? count(snapshot.inputTokens) : null;
    const measuredWindow = matched ? windowSize(snapshot?.windowTokens) : null;
    const limit = measuredWindow ?? (catalogConnectionID === selected.connectionID ? windowSize(model?.limits?.context) : null);
    const percentage = input !== null && measuredWindow !== null ? input / measuredWindow * 100 : null;
    return { inputTokens: input, windowTokens: limit, percentage: Number.isFinite(percentage) ? percentage : null };
  }
  function format(value) {
    const number = n => n.toLocaleString('da-DK');
    const qualification = 'Det senest afsluttede modelkald, ikke samtalens samlede forbrug. Værktøjer og senere beskeder kan ændre konteksten.';
    if (value.percentage !== null) return {
      label: `Kontekst · ${number(value.inputTokens)} / ${number(value.windowTokens)} · ${value.percentage.toLocaleString('da-DK', { maximumFractionDigits: 1 })} %`,
      description: `${qualification} Input inklusive cache: ${number(value.inputTokens)} tokens. Oplyst kontekstvindue: ${number(value.windowTokens)} tokens.`
    };
    return { label: `Kontekst ukendt${value.windowTokens === null ? '' : ` · vindue ${number(value.windowTokens)}`}`,
      description: `${qualification} ${value.windowTokens === null ? 'Kataloget oplyser intet kontekstvindue.' : 'Oplyst kontekstvindue: ' + number(value.windowTokens) + ' tokens.'}` };
  }
  const api = { project, format };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ContextDisplay = api;
})();
