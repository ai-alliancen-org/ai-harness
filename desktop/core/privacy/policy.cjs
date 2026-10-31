'use strict';

const CLASSES = Object.freeze(['public', 'internal', 'confidential', 'strict']);
const WORK_MODES = Object.freeze(['local', 'hybrid', 'cloud-controlled']);
const LAYERS = ['organization', 'project', 'conversation'];

class PrivacyGateError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = 'PrivacyGateError'; this.code = code;
    this.decision = code === 'PRIVACY_LOCAL_REQUIRED' ? 'local' : 'block';
    this.details = Object.freeze({ ...details });
  }
}
const invalid = () => new PrivacyGateError('PRIVACY_POLICY_INVALID', 'Projektets dataregler kunne ikke kontrolleres. Ingen data er sendt.');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function snapshot(value) { return JSON.parse(JSON.stringify(value)); }
function classification(value, fallback = 'internal') {
  const result = value === undefined ? fallback : value;
  if (!CLASSES.includes(result)) throw invalid();
  return result;
}
function composePolicy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const layers = LAYERS.map(name => [name, raw[name]]).filter(([, value]) => value !== undefined && value !== null);
  for (const [, layer] of layers) if (!layer || typeof layer !== 'object' || Array.isArray(layer) || (layer.enabled !== undefined && typeof layer.enabled !== 'boolean')) throw invalid();
  if (!layers.some(([, layer]) => layer.enabled === true)) return { enabled: false, binding: stable(raw) };
  // Once enabled at any level, a lower layer cannot turn the gate off. Every
  // supplied layer can restrict; omission is inheritance, never a permission.
  const result = { enabled: true, workMode: 'cloud-controlled', allowedDestinationIds: null, maxClass: 'internal', defaultClass: 'internal', allowPersonalData: false, allowSecrets: false, allowConfidentialRelease: false, requireApproval: false, redact: true, approvalTtlMs: 60_000, protectedSources: [], protectedValues: [], versions: [] };
  // The highest supplied policy owns the ceiling, including its safe defaults.
  // A lower policy may inherit an omitted field but cannot turn omission into
  // permission (for example granting personal data the organization never allowed).
  const ceiling = layers[0][1];
  const explicitMax = [classification(ceiling.maxClass)], explicitDefaults = [classification(ceiling.defaultClass)];
  for (const [name, layer] of layers) {
    if (typeof layer.version !== 'string' || !layer.version.trim() || layer.version.length > 160) throw invalid();
    result.versions.push({ layer: name, version: layer.version });
    if (layer.workMode !== undefined) {
      if (!WORK_MODES.includes(layer.workMode)) throw invalid();
      if (layer.workMode === 'local') result.workMode = 'local';
      else if (result.workMode !== 'local') result.workMode = layer.workMode;
    }
    if (layer.allowedDestinationIds !== undefined) {
      if (!Array.isArray(layer.allowedDestinationIds) || layer.allowedDestinationIds.some(id => typeof id !== 'string' || !id || id.length > 200)) throw invalid();
      const ids = [...new Set(layer.allowedDestinationIds)];
      if (layer === ceiling) result.allowedDestinationIds = ids;
      else if (result.allowedDestinationIds !== null) result.allowedDestinationIds = result.allowedDestinationIds.filter(id => ids.includes(id));
    }
    if (layer.maxClass !== undefined) explicitMax.push(classification(layer.maxClass));
    if (layer.defaultClass !== undefined) explicitDefaults.push(classification(layer.defaultClass));
    for (const field of ['allowPersonalData', 'allowSecrets', 'allowConfidentialRelease', 'redact']) if (layer[field] !== undefined && typeof layer[field] !== 'boolean') throw invalid();
    if (layer.requireApproval !== undefined && typeof layer.requireApproval !== 'boolean') throw invalid();
    result.requireApproval ||= layer.requireApproval === true;
    if (layer.approvalTtlMs !== undefined) {
      if (!Number.isSafeInteger(layer.approvalTtlMs) || layer.approvalTtlMs < 1 || layer.approvalTtlMs > 300_000) throw invalid();
      result.approvalTtlMs = Math.min(result.approvalTtlMs, layer.approvalTtlMs);
    }
    for (const field of ['protectedSources', 'protectedValues']) {
      if (layer[field] !== undefined && !Array.isArray(layer[field])) throw invalid();
      result[field].push(...snapshot(layer[field] || []));
      if (result[field].length > (field === 'protectedValues' ? 256 : 1024)) throw invalid();
    }
  }
  // An explicit denial is sticky. A project-level true cannot overrule an
  // organization-level false. No explicit permission means deny by default.
  for (const field of ['allowPersonalData', 'allowSecrets', 'allowConfidentialRelease']) {
    const values = layers.slice(1).map(([, layer]) => layer[field]).filter(value => value !== undefined);
    result[field] = ceiling[field] === true && values.every(Boolean);
  }
  result.redact = !layers.some(([, layer]) => layer.redact === false);
  result.maxClass = explicitMax.length ? CLASSES[Math.min(...explicitMax.map(value => CLASSES.indexOf(value)))] : 'internal';
  result.defaultClass = explicitDefaults.length ? CLASSES[Math.max(...explicitDefaults.map(value => CLASSES.indexOf(value)))] : 'internal';
  for (const source of result.protectedSources) {
    if (!source || typeof source.path !== 'string' || !source.path || source.path.length > 4096) throw invalid();
    source.classification = classification(source.classification);
    validateAttributes(source.attributes);
    if (source.uninspectable !== undefined && typeof source.uninspectable !== 'boolean') throw invalid();
  }
  for (const value of result.protectedValues) if (!value || typeof value.value !== 'string' || value.value.length < 2 || value.value.length > 4096 || !['person','email','cpr','account','secret','protected'].includes(value.kind)) throw invalid();
  result.binding = stable(raw);
  return result;
}
function validateAttributes(attributes) {
  if (attributes === undefined) return;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw invalid();
  for (const key of ['personalData', 'secrets']) if (attributes[key] !== undefined && typeof attributes[key] !== 'boolean') throw invalid();
}
function inheritClassification(policy, provenance = []) {
  if (!Array.isArray(provenance) || provenance.length > 1024) throw invalid();
  let level = CLASSES.indexOf(policy.defaultClass), personalData = false, secrets = false, uninspectable = false;
  for (const source of provenance) {
    if (!source || typeof source !== 'object') throw invalid();
    level = Math.max(level, CLASSES.indexOf(classification(source.classification)));
    validateAttributes(source.attributes);
    if (source.uninspectable !== undefined && typeof source.uninspectable !== 'boolean') throw invalid();
    personalData ||= source.attributes?.personalData === true; secrets ||= source.attributes?.secrets === true; uninspectable ||= source.uninspectable === true;
  }
  return { classification: CLASSES[level], attributes: { personalData, secrets }, uninspectable };
}
function validateDestination(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrivacyGateError('PRIVACY_DESTINATION_INVALID', 'Modtagerens behandlingssted er ikke dokumenteret. Ingen data er sendt.');
  const destination = snapshot(value);
  if (!['device','organization','cloud'].includes(destination.locality) || typeof destination.id !== 'string' || !destination.id || typeof destination.model !== 'string' || !destination.model || typeof destination.endpoint !== 'string' || !destination.endpoint) throw new PrivacyGateError('PRIVACY_DESTINATION_INVALID', 'Modtagerens behandlingssted er ikke dokumenteret. Ingen data er sendt.');
  let url; try { url = new URL(destination.endpoint); } catch { throw invalid(); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw invalid();
  // A loopback URL alone does not establish local processing. The trusted
  // connection registry must explicitly identify the device destination.
  if (destination.locality === 'device' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw invalid();
  for (const key of ['account','route','revision','label']) if (destination[key] !== undefined && typeof destination[key] !== 'string') throw invalid();
  if (destination.label && destination.label.length > 300) throw invalid();
  return destination;
}

module.exports = { PrivacyGateError, CLASSES, composePolicy, inheritClassification, validateDestination, stable, snapshot };
