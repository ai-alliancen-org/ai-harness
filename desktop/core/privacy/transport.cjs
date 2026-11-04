// SPDX-License-Identifier: EUPL-1.2
'use strict';

const { PrivacyGate, PrivacyGateError } = require('./index.cjs');
const { composePolicy, snapshot, stable, validateDestination } = require('./policy.cjs');

const rejected = code => new PrivacyGateError(code, 'Modelkaldet kunne ikke kontrolleres. Ingen reserveudbyder vælges.');

// Main-process adapter proposal. It is deliberately not imported by gateway.cjs.
// All callbacks belong to the trusted host, never to renderer/model/tool data.
// One invocation means one fetch: OpenCode remains the owner of retry policy.
function createControlledModelTransport({ getPolicy, resolveDestination, readCurrentState, getAuthorization, requestApproval, audit, fetchImpl = globalThis.fetch } = {}) {
  if ([getPolicy, resolveDestination, readCurrentState, getAuthorization, fetchImpl].some(fn => typeof fn !== 'function')) throw new TypeError('Trusted policy, destination, synchronous current-state, authorization and fetch callbacks are required.');
  return async function dispatch({ scope, destinationRef, body, purpose, contextPartition, revision, provenance = [], signal, assertCurrent, forceApproval = false } = {}) {
    try {
      if (signal?.aborted) throw rejected('PRIVACY_ABORTED');
      if (assertCurrent !== undefined && typeof assertCurrent !== 'function') throw rejected('PRIVACY_CONTROL_FAILED');
      // Resolver keys cannot change while credentials/review are awaited.
      const reference = snapshot(destinationRef), currentScope = snapshot(scope || {});
      const destination = validateDestination(await resolveDestination(reference));
      const url = new URL(destination.endpoint);
      // Endpoints are configuration, not a place to carry API keys or prompts.
      if (url.search || url.hash) throw rejected('PRIVACY_DESTINATION_INVALID');
      if (typeof body !== 'string') throw rejected('PRIVACY_CONTROL_FAILED');
      const request = JSON.parse(body);
      if (!request || typeof request !== 'object' || Array.isArray(request) || request.model !== destination.model) throw rejected('PRIVACY_CONTROL_FAILED');
      // A provider-routing payload must identify exactly the reviewed route.
      // Neither implicit fallback nor a second model/provider is authorized.
      if (destination.route) {
        const routing = request.provider;
        if (!routing || typeof routing !== 'object' || Array.isArray(routing) || !Array.isArray(routing.only) || routing.only.length !== 1 || routing.only[0] !== destination.route || routing.allow_fallbacks !== false) throw rejected('PRIVACY_CONTROL_FAILED');
      } else if (Object.hasOwn(request, 'provider')) throw rejected('PRIVACY_CONTROL_FAILED');
      if (Object.hasOwn(request, 'models') || Object.hasOwn(request, 'route')) throw rejected('PRIVACY_CONTROL_FAILED');
      // Resolve credentials before the gate's final checks. No asynchronous
      // credential lookup may separate a consumed permit from actual dispatch.
      const authorization = await getAuthorization(snapshot(destination));
      if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) throw rejected('PRIVACY_CONTROL_FAILED');
      const headers = { 'content-type': 'application/json' };
      for (const [name, value] of Object.entries(authorization)) {
        if (!['authorization', 'x-api-key', 'api-key', 'anthropic-version'].includes(name.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value)) throw rejected('PRIVACY_CONTROL_FAILED');
        headers[name.toLowerCase()] = value;
      }
      Object.freeze(headers);
      const assertHostCurrent = expected => {
        // Check the optional task-lifecycle guard first so its own side effects
        // cannot occur after the last policy/destination snapshot.
        if (assertCurrent) {
          const active = assertCurrent(expected);
          if (active && typeof active.then === 'function') { void active.catch?.(() => {}); throw rejected('PRIVACY_CONTROL_FAILED'); }
          if (active === false) throw rejected('PRIVACY_STALE');
          if (active !== true) throw rejected('PRIVACY_CONTROL_FAILED');
        }
        const state = readCurrentState(expected.scope, reference);
        if (state && typeof state.then === 'function') { void state.catch?.(() => {}); throw rejected('PRIVACY_CONTROL_FAILED'); }
        if (!state || typeof state !== 'object' || Array.isArray(state)) throw rejected('PRIVACY_CONTROL_FAILED');
        const policy = composePolicy(snapshot(state.policy)), recipient = validateDestination(state.destination);
        if (!policy.enabled || policy.binding !== expected.policyBinding || stable(recipient) !== stable(expected.destination)) throw rejected('PRIVACY_STALE');
        return true;
      };
      const gate = new PrivacyGate({
        getPolicy: async currentScope => {
          const policy = await getPolicy(currentScope);
          // The controlled entry point never falls back to an unchecked send.
          if (!composePolicy(policy).enabled) throw rejected('PRIVACY_CONTROL_FAILED');
          return policy;
        },
        resolveDestination: async ref => {
          const current = validateDestination(await resolveDestination(ref));
          if (stable(current) !== stable(destination)) throw rejected('PRIVACY_STALE');
          return current;
        },
        requestApproval, audit,
      });
      return await gate.executeAction({ scope: currentScope, destinationRef: reference, body, purpose, contextPartition, revision, provenance, signal, assertCurrent: assertHostCurrent, forceApproval,
        transport: payload => fetchImpl(destination.endpoint, { method: 'POST', headers, body: payload, signal, redirect: 'error' }),
      });
    } catch (cause) {
      if (cause instanceof PrivacyGateError) throw cause;
      // Never surface provider exceptions containing credentials, URLs or body.
      // A transport failure may have sent bytes; it is not a retry instruction.
      throw rejected('PRIVACY_TRANSPORT_FAILED');
    }
  };
}

module.exports = { createControlledModelTransport };
