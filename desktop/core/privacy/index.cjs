'use strict';

const { randomBytes, randomUUID, createHmac, createHash, timingSafeEqual } = require('node:crypto');
const { PrivacyGateError, CLASSES, composePolicy, inheritClassification, validateDestination, stable, snapshot } = require('./policy.cjs');
const { inspectRequest } = require('./inspector.cjs');
// A routing request is trusted only when issued by the actual sharing dialog.
// Error codes/model text are not consent, and cloning an error loses authority.
const localChoices = new WeakMap();
function isLocalChoiceRequest(cause) { return !!cause && localChoices.has(cause); }
function takeLocalChoice(cause, expected = {}) {
  const entry = cause && localChoices.get(cause);
  if (!entry || entry.used || entry.now() >= entry.receipt.expiresAt || ['scope','purpose','revision','contextPartition','requestHash'].some(key => Object.hasOwn(expected,key) && stable(expected[key]) !== stable(entry.receipt[key]))) throw error('PRIVACY_STALE');
  entry.used = true; return entry.receipt;
}
class PrivacyLocalChoiceRequest extends PrivacyGateError {
  constructor(receipt, now) {
    super('PRIVACY_LOCAL_REQUIRED', 'Du har valgt lokal behandling. Den lokale modtager kontrolleres, før arbejdet fortsætter.');
    localChoices.set(this, { receipt: freeze(snapshot(receipt)), now, used: false });
  }
}

const MESSAGES = {
  PRIVACY_ABORTED: 'Delingen er annulleret. Ingen ny anmodning er sendt.',
  PRIVACY_STALE: 'Indhold, modtager eller dataregler blev ændret. Gennemgå delingen igen.',
  PRIVACY_APPROVAL_REQUIRED: 'Delingen kræver en konkret godkendelse.',
  PRIVACY_BLOCKED: 'Projektets dataregler tillader ikke denne deling.',
  PRIVACY_LOCAL_REQUIRED: 'Dette materiale skal behandles lokalt. Ingen ekstern reserve vælges.',
  PRIVACY_CONTROL_FAILED: 'Datakontrollen kunne ikke afsluttes. Ingen data er sendt.',
};
function error(code) { return new PrivacyGateError(code, MESSAGES[code] || MESSAGES.PRIVACY_CONTROL_FAILED); }
function assertActive(signal) { if (signal?.aborted) throw error('PRIVACY_ABORTED'); }
async function interruptible(operation, signal, timeoutMs) {
  assertActive(signal);
  if (!signal && timeoutMs === undefined) return operation();
  let abort, timer;
  const interrupted = new Promise((_resolve,reject) => {
    abort = () => reject(error('PRIVACY_ABORTED')); signal?.addEventListener('abort', abort, { once: true });
    if (timeoutMs !== undefined) timer = setTimeout(() => reject(error('PRIVACY_STALE')),Math.max(1,timeoutMs));
  });
  try { return await Promise.race([Promise.resolve().then(operation),interrupted]); }
  finally { signal?.removeEventListener('abort',abort); clearTimeout(timer); }
}
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

class PrivacyGate {
  #secret = randomBytes(32);
  #permits = new Map();
  constructor({ getPolicy, resolveDestination, requestApproval, audit = async () => {}, now = Date.now } = {}) {
    if (typeof getPolicy !== 'function' || typeof resolveDestination !== 'function' || typeof audit !== 'function' || typeof now !== 'function') throw new TypeError('Privacy Gate requires trusted policy and destination resolvers.');
    this.getPolicy = getPolicy; this.resolveDestination = resolveDestination; this.requestApproval = requestApproval; this.audit = audit; this.now = now;
  }
  async executeAction({ scope, destinationRef, purpose, contextPartition, revision, body, contentType = 'application/json', provenance = [], signal, forceApproval = false, assertCurrent, transport } = {}) {
    assertActive(signal);
    if (typeof transport !== 'function' || assertCurrent !== undefined && typeof assertCurrent !== 'function' || typeof body !== 'string' || typeof forceApproval !== 'boolean') throw error('PRIVACY_CONTROL_FAILED');
    let policy, destination, scopeSnapshot, provenanceSnapshot;
    try { scopeSnapshot = freeze(snapshot(scope || {})); provenanceSnapshot = freeze(snapshot(provenance)); policy = composePolicy(snapshot(await interruptible(() => this.getPolicy(scopeSnapshot),signal))); }
    catch (cause) { if (cause instanceof PrivacyGateError) throw cause; throw error('PRIVACY_CONTROL_FAILED'); }
    // Existing profiles are byte-identical until the trusted store enables the
    // feature. A caller cannot disable a higher-level enabled policy.
    if (!policy.enabled) { assertActive(signal); if (assertCurrent && await assertCurrent() === false) throw error('PRIVACY_STALE'); assertActive(signal); return transport(body); }
    // Enabled calls need a trusted host guard, never an implicit no-op. The
    // controlled adapter supplies its own synchronous registry snapshot check.
    if (typeof assertCurrent !== 'function') throw error('PRIVACY_CONTROL_FAILED');
    const id = randomUUID();
    let lastInheritance = { classification: policy.defaultClass, attributes: { personalData:false,secrets:false } };
    const record = async (decision, inherited = lastInheritance) => {
      try { await this.audit(freeze({ timestamp: new Date(this.now()).toISOString(), requestId: id, action: 'model-call', destinationId: destination?.id || null, locality: destination?.locality || 'unknown', classification: inherited.classification, attributes: { ...inherited.attributes }, decision, policyVersions: snapshot(policy.versions) })); }
      catch { throw error('PRIVACY_CONTROL_FAILED'); }
    };
    try {
      if (typeof purpose !== 'string' || !purpose || purpose.length > 300 || typeof contextPartition !== 'string' || !contextPartition || contextPartition.length > 300 || !(typeof revision === 'string' && revision.length > 0 && revision.length <= 300 || typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0)) throw error('PRIVACY_CONTROL_FAILED');
      destination = validateDestination(await interruptible(() => this.resolveDestination(destinationRef),signal));
      const isLocal = destination.locality === 'device';
      lastInheritance = inheritClassification(policy,provenanceSnapshot);
      // Local execution is permitted even for opaque/strict inputs. D1 does
      // not claim it contains the tools or subprocesses of that local model.
      if (policy.workMode === 'local' && !isLocal) throw error('PRIVACY_LOCAL_REQUIRED');
      if (policy.allowedDestinationIds === null || !policy.allowedDestinationIds.includes(destination.id)) throw error('PRIVACY_BLOCKED');
      const checked = isLocal ? { body, changed: false, findings: [], visibleSources: [] } : inspectRequest(body,policy,{ contentType });
      const inherited = inheritClassification(policy,[...provenanceSnapshot,...checked.visibleSources]);
      lastInheritance = { ...inherited, attributes:{ personalData:inherited.attributes.personalData || !!checked.hasPersonalData, secrets:inherited.attributes.secrets || !!checked.hasSecrets } };
      if (!isLocal) {
        if (inherited.uninspectable || inherited.classification === 'strict') throw error('PRIVACY_LOCAL_REQUIRED');
        if (CLASSES.indexOf(inherited.classification) > CLASSES.indexOf(policy.maxClass)) throw error('PRIVACY_LOCAL_REQUIRED');
        if (inherited.classification === 'confidential' && !policy.allowConfidentialRelease) throw error('PRIVACY_LOCAL_REQUIRED');
        // Provenance is sticky: an apparently harmless summary cannot silently
        // lose a source's personal-data or secret attribute.
        if (inherited.attributes.personalData && !policy.allowPersonalData || inherited.attributes.secrets && !policy.allowSecrets) throw error('PRIVACY_LOCAL_REQUIRED');
      }
      const payload = checked.body;
      const binding = stable({ scope:scopeSnapshot, body:payload, contentType, destination, purpose, contextPartition, revision, policy:policy.binding, provenance:provenanceSnapshot, forceApproval });
      const mac = createHmac('sha256',this.#secret).update(binding).digest();
      // A host-issued release contract may require review even when an
      // administrator normally permits public/internal material automatically.
      // This flag can only add review; it never raises a data permission.
      const requiresApproval = !isLocal && (forceApproval || checked.changed || policy.requireApproval || inherited.classification === 'confidential');
      const expiresAt = this.now() + policy.approvalTtlMs;
      // Host-only revalidation context. The request hash binds the exact
      // inspected bytes; provenance and the complete policy bind their rights.
      // Do not copy this object into audit/UI metadata.
      const currentBinding = freeze({ scope:scopeSnapshot, destination:snapshot(destination), purpose, contextPartition, revision, contentType, requestHash:createHash('sha256').update(payload).digest('hex'), policyBinding:policy.binding, policyVersions:snapshot(policy.versions), provenance:provenanceSnapshot, forceApproval });
      const assertSynchronousCurrent = () => {
        const current = assertCurrent(currentBinding);
        if (current && typeof current.then === 'function') { void current.catch?.(() => {}); throw error('PRIVACY_CONTROL_FAILED'); }
        if (current === false) throw error('PRIVACY_STALE');
        if (current !== true) throw error('PRIVACY_CONTROL_FAILED');
      };
      // No reusable permission is returned to the renderer. The gate owns the
      // one-use permit and consumes it before invoking the final transport.
      this.#permits.set(id,{ mac, expiresAt });
      if (requiresApproval) {
        if (typeof this.requestApproval !== 'function') throw error('PRIVACY_APPROVAL_REQUIRED');
        const url = new URL(destination.endpoint);
        const review = freeze({ id, payload, contentType, destination: { id:destination.id, label:destination.label || destination.id, locality:destination.locality, model:destination.model, endpoint:`${url.origin}${url.pathname}`, account:destination.account || '', route:destination.route || '' }, purpose, contextPartition, revision, classification:inherited.classification, attributes:{ ...lastInheritance.attributes }, findings:checked.findings, rewritten:checked.changed, expiresAt, policyVersions:snapshot(policy.versions) });
        let decision;
        try { decision = await interruptible(() => this.requestApproval(review,{ signal, scope:freeze(snapshot(scopeSnapshot)) }),signal,Math.max(1,expiresAt - this.now())); }
        catch (cause) { if (cause instanceof PrivacyGateError) throw cause; throw error('PRIVACY_CONTROL_FAILED'); }
        decision = typeof decision === 'object' && decision !== null ? decision.decision : decision;
        if (decision === 'local') {
          // The dialog may have waited while a task, destination or policy
          // changed. Mint no routing authority until the original review is
          // current; the recipient is validated again by the handoff adapter.
          assertActive(signal);
          if (await assertCurrent(currentBinding) === false) throw error('PRIVACY_STALE');
          const freshPolicy = composePolicy(snapshot(await interruptible(() => this.getPolicy(scopeSnapshot),signal)));
          const freshDestination = validateDestination(await interruptible(() => this.resolveDestination(destinationRef),signal));
          if (freshPolicy.binding !== policy.binding || stable(freshDestination) !== stable(destination) || this.now() >= expiresAt) throw error('PRIVACY_STALE');
          assertSynchronousCurrent(); assertActive(signal);
          throw new PrivacyLocalChoiceRequest({ scope:scopeSnapshot, destinationRef, destination, purpose, contextPartition, revision, requestHash:createHash('sha256').update(body).digest('hex'), policyBinding:policy.binding, expiresAt },this.now);
        }
        if (decision !== 'approve') throw error('PRIVACY_BLOCKED');
      }
      assertActive(signal);
      // Audit callbacks may wait for disk. Revalidate after that wait so a
      // policy/recipient change during audit cannot use the old permit.
      await record(checked.changed ? 'rewrite' : 'allow',lastInheritance);
      if (await assertCurrent(currentBinding) === false) throw error('PRIVACY_STALE');
      const freshPolicy = composePolicy(snapshot(await interruptible(() => this.getPolicy(scopeSnapshot),signal)));
      const freshDestination = validateDestination(await interruptible(() => this.resolveDestination(destinationRef),signal));
      if (freshPolicy.binding !== policy.binding || stable(freshDestination) !== stable(destination)) throw error('PRIVACY_STALE');
      assertActive(signal);
      const permit = this.#permits.get(id);
      if (!permit || this.now() >= permit.expiresAt || !timingSafeEqual(permit.mac,mac)) throw error('PRIVACY_STALE');
      assertActive(signal);
      // This final guard must be synchronous: an awaited callback here could
      // yield between the last version check and the first upstream byte.
      assertSynchronousCurrent();
      if (this.now() >= permit.expiresAt) throw error('PRIVACY_STALE');
      assertActive(signal);
      this.#permits.delete(id);
      // No await or JSON reconstruction between final check and transport.
      return transport(payload);
    } catch (cause) {
      if (cause instanceof PrivacyGateError) { await record(cause.decision); throw cause; }
      // Trusted callback failures do not copy an exception's potentially
      // sensitive text to logs or UI, and never trigger a different recipient.
      await record('block'); throw error('PRIVACY_CONTROL_FAILED');
    } finally { this.#permits.delete(id); }
  }
}

module.exports = { PrivacyGate, PrivacyGateError, inspectRequest, composePolicy, inheritClassification, isLocalChoiceRequest, takeLocalChoice };
