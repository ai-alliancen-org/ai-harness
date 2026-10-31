'use strict';

// Host-only metadata. This observer neither owns permissions nor reads/clones
// response bodies. Existing consumers report the chunks they already consume.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const CATEGORIES = ['model', 'catalog', 'integration', 'preview', 'git', 'update', 'subprocess'];
const PURPOSES = ['model-response', 'model-catalog', 'route-catalog', 'integration', 'browser-http', 'browser-open', 'git-push', 'git-fetch', 'update-check', 'update-download', 'package-install'];
const PROVIDERS = ['mistral', 'corti', 'openai', 'azure', 'anthropic', 'openrouter', 'zen', 'ollama', 'compatible', 'alexandra', 'promte', 'komplai', 'github', 'vercel', 'cloudflare'];
const STATUSES = ['attempted', 'headers', 'receiving', 'completed', 'failed', 'cancelled', 'interrupted'];
const ERRORS = ['aborted', 'timeout', 'http', 'network', 'stream', 'unknown'];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const COVERAGE = [
  { category: 'model', status: 'partial', note: 'Auras modelgateway registrerer HTTP-forsøg. Andre motorers direkte trafik er ikke bekræftet dækket.' },
  { category: 'catalog', status: 'partial', note: 'Auras model- og rutekatalog registreres. Lokal automatisk opdagelse er ikke fuldt registreret.' },
  { category: 'integration', status: 'unknown', note: 'Integrationer og udgivelsestjenester er ikke registreret.' },
  { category: 'preview', status: 'unknown', note: 'Forhåndsvisningens HTTP, WebSocket og øvrige browsertrafik er endnu ikke fuldt registreret.' },
  { category: 'git', status: 'unknown', note: 'Git-processers netværkstrafik er endnu ikke registreret.' },
  { category: 'update', status: 'unknown', note: 'Opdateringskontrol og pakkedownload er endnu ikke registreret.' },
  { category: 'subprocess', status: 'unknown', note: 'Agentværktøjer, npm og udviklingsserveres direkte netværkstrafik er endnu ikke fuldt registreret.' },
];
const LIMITS = [
  'Rapporten omfatter registrerede Aura-kald, ikke alle computerens forbindelser. Ukendt dækning betyder ikke nul kald.',
  'Et forsøg betyder, at transportfunktionen blev kaldt. Det beviser ikke, at modtageren modtog hele forespørgslen.',
  'sentBytes er størrelsen af en kendt request-body, ikke målte netværksbytes. receivedBytes er de body-bytes, som den eksisterende læser har observeret.',
  'Ukendte tider og størrelser er null. Ventetid kan skyldes netværk eller modtager; rapporten måler ikke udbyderens interne kø.',
  'Loopback er en lokal transportadresse og beviser ikke, at modellens videre behandling er lokal. Andre serveres behandlingssted er ukendt her.',
  'Eksterne browsere, automatisk fulgte redirects, DNS, UDP og uregistrerede underprocesser kan ikke optælles fuldstændigt.',
  'Ingen prompts, modelsvar, filstier, URL-stier, query-parametre, headers, credentials eller rå fejltekster gemmes.',
];
const MAX_FILE_BYTES = 4_000_000;
const member = (value, values) => values.includes(value) ? value : null;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
function destination(value) {
  try {
    const url = new URL(typeof value === 'string' || value instanceof URL ? value : value?.url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return { host: null, locality: 'unknown' };
    const host = url.hostname.toLowerCase();
    if (!host || host.length > 253 || /[^a-z0-9.\-:\[\]]/.test(host)) return { host: null, locality: 'unknown' };
    return { host, locality: host === 'localhost' || host === '[::1]' || /^127\./.test(host) ? 'loopback' : 'remote' };
  } catch { return { host: null, locality: 'unknown' }; }
}
function bodySize(body) {
  if (typeof body === 'string') return Buffer.byteLength(body);
  if (Buffer.isBuffer(body) || ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  return null; // No iteration, stringification or stream consumption.
}
function errorCategory(error, signal) {
  if (error?.name === 'TimeoutError' || signal?.reason?.name === 'TimeoutError') return 'timeout';
  if (['idle', 'deadline'].includes(error?.kind)) return 'timeout';
  if (signal?.aborted || error?.name === 'AbortError') return 'aborted';
  if (error?.kind === 'stream') return 'stream';
  if (Number.isInteger(error?.status)) return 'http';
  if (error instanceof TypeError || error?.kind === 'network') return 'network';
  return 'unknown';
}
function safeRecord(value) {
  if (!value || !uuid(value.id) || !iso(value.startedAt)) return null;
  const host = typeof value.host === 'string' && destination('https://' + value.host).host === value.host ? value.host : null;
  return { id: value.id, groupID: uuid(value.groupID), category: member(value.category, CATEGORIES), purpose: member(value.purpose, PURPOSES), provider: member(value.provider, PROVIDERS),
    attempt: Number.isSafeInteger(value.attempt) && value.attempt > 0 ? Math.min(value.attempt, 10000) : null,
    host, locality: member(value.locality, ['loopback', 'remote', 'unknown']) || 'unknown', method: member(value.method, METHODS), startedAt: value.startedAt,
    status: member(value.status, STATUSES) || 'interrupted', httpStatus: Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
    headersMs: number(value.headersMs), firstBodyMs: number(value.firstBodyMs), totalMs: number(value.totalMs), sentBytes: integer(value.sentBytes), receivedBytes: integer(value.receivedBytes),
    errorCategory: member(value.errorCategory, ERRORS), redirected: typeof value.redirected === 'boolean' ? value.redirected : null };
}
class NetworkJournal {
  constructor({ limit = 2000, now = Date.now, clock = () => performance.now() } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new TypeError('Invalid network journal limit');
    this.limit = limit; this.now = now; this.clock = clock; this.startedAt = new Date(now()).toISOString(); this.recordingStartedAt = this.startedAt;
    this.records = new Map(); this.responses = new WeakMap(); this.dropped = 0; this.directory = null;
    this.persistence = { enabled: false, status: 'memory-only' }; this.pending = Promise.resolve(); this.timer = null;
  }
  snapshot() {
    return { schemaVersion: 1, scope: 'aura-only', startedAt: this.startedAt, recordingStartedAt: this.recordingStartedAt, generatedAt: new Date(this.now()).toISOString(),
      records: structuredClone([...this.records.values()]), dropped: this.dropped, capacity: this.limit,
      persistence: { ...this.persistence }, coverage: structuredClone(COVERAGE), limits: [...LIMITS] };
  }
  async checkDirectory() {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid())) throw new Error('Unsafe journal directory');
  }
  async configure({ directory } = {}) {
    if (this.directory) throw new Error('Network journal is already configured');
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Network journal needs an absolute host directory');
    this.directory = directory;
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 }); await this.checkDirectory();
      const file = path.join(directory, 'requests.json');
      let saved;
      try {
        const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > MAX_FILE_BYTES || process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid())) throw new Error('Unsafe journal file'); saved = JSON.parse(await handle.readFile('utf8')); }
        finally { await handle.close(); }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (saved !== undefined) {
        if (saved?.schemaVersion !== 1 || !Array.isArray(saved.records) || saved.records.length > 5000) throw new Error('Invalid journal file');
        const current = [...this.records.values()]; this.records.clear();
        for (const value of saved.records) {
          const record = safeRecord(value); if (!record) continue;
          if (['attempted', 'headers', 'receiving'].includes(record.status)) record.status = 'interrupted';
          this.records.set(record.id, record);
        }
        for (const value of current) this.records.set(value.id, value);
        this.dropped += integer(saved.dropped) || 0; this.trim();
        const earliest = iso(saved.recordingStartedAt) || iso(saved.startedAt);
        if (earliest) this.recordingStartedAt = earliest;
      }
      this.persistence = { enabled: true, status: 'ready' }; this.schedule();
    } catch { this.persistence = { enabled: false, status: 'unavailable' }; }
    return this.snapshot();
  }
  trim() { while (this.records.size > this.limit) { this.records.delete(this.records.keys().next().value); this.dropped++; } }
  schedule() {
    if (!this.persistence.enabled || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, 50); this.timer.unref?.();
  }
  save() {
    if (!this.persistence.enabled) return this.pending;
    this.pending = this.pending.then(async () => {
      let temporary;
      try {
        await this.checkDirectory();
        const data = JSON.stringify({ schemaVersion: 1, recordingStartedAt: this.recordingStartedAt, dropped: this.dropped, records: [...this.records.values()] });
        if (Buffer.byteLength(data) > MAX_FILE_BYTES) throw new Error('Journal bound exceeded');
        temporary = path.join(this.directory, `requests-${randomUUID()}.tmp`);
        await fs.writeFile(temporary, data, { mode: 0o600, flag: 'wx' }); await this.checkDirectory();
        await fs.rename(temporary, path.join(this.directory, 'requests.json')); temporary = null;
        this.persistence.status = 'ready';
      } catch { this.persistence.status = 'unavailable'; }
      finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
    }).catch(() => { this.persistence.status = 'unavailable'; });
    return this.pending;
  }
  async flush() { clearTimeout(this.timer); this.timer = null; await this.save(); }
  begin(url, options, metadata) {
    const address = destination(url);
    const record = safeRecord({ id: randomUUID(), groupID: metadata.groupID, category: metadata.category, purpose: metadata.purpose, provider: metadata.provider, attempt: metadata.attempt,
      ...address, method: options?.method || (typeof url?.method === 'string' ? url.method : 'GET'), startedAt: new Date(this.now()).toISOString(), status: 'attempted',
      sentBytes: bodySize(options?.body), receivedBytes: null, redirected: null });
    this.records.set(record.id, record); this.trim(); this.schedule();
    return { record, start: this.clock(), signal: options?.signal, timeoutSignal: metadata.timeoutSignal, terminal: false };
  }
  elapsed(state) { const value = this.clock() - state.start; return Number.isFinite(value) ? Math.round(Math.max(0, value) * 1000) / 1000 : null; }
  async observedFetch(url, options, metadata = {}, fetchImpl = fetch) {
    let state;
    try { state = this.begin(url, options, metadata); } catch { /* Observation never owns delivery. */ }
    try {
      // Invoke the existing transport before the first await. Observation must
      // not move dispatch or change the request, response or cancellation.
      const response = await fetchImpl(url, options);
      if (state) {
        try {
          state.record.status = 'headers'; state.record.httpStatus = Number.isInteger(response.status) ? response.status : null;
          state.record.headersMs = this.elapsed(state); state.record.redirected = typeof response.redirected === 'boolean' ? response.redirected : null;
          this.responses.set(response, state); this.schedule();
        } catch { /* A response may be a test double; do not alter it. */ }
      }
      return response;
    } catch (error) {
      if (state) { try { this.finish(state, { outcome: state.signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed', error }); } catch {} }
      throw error;
    }
  }
  observeResponseChunk(response, chunk) {
    try {
      const state = this.responses.get(response); if (!state || state.terminal) return;
      const size = bodySize(chunk); if (size === null) return;
      if (size && state.record.firstBodyMs === null) state.record.firstBodyMs = this.elapsed(state);
      state.record.receivedBytes = (state.record.receivedBytes || 0) + size; state.record.status = 'receiving';
      // Persist the first observation, never schedule one write per token.
      if (!state.bodyObserved) { state.bodyObserved = true; this.schedule(); }
    } catch { /* Metadata is best effort. */ }
  }
  finish(state, { outcome = 'completed', error } = {}) {
    if (state.terminal) return;
    state.terminal = true;
    state.record.errorCategory = state.record.httpStatus >= 400 ? 'http' : outcome === 'completed' ? null : errorCategory(state.timeoutSignal?.aborted ? { kind: 'idle' } : error, state.signal);
    // Both user Stop and a timeout abort fetch/body readers. Keep deadline
    // failures distinct even when a consumer only receives an AbortError.
    const finalOutcome = outcome === 'cancelled' && state.record.errorCategory === 'timeout' ? 'failed' : outcome;
    state.record.status = finalOutcome === 'completed' && state.record.httpStatus >= 400 ? 'failed' : member(finalOutcome, ['completed', 'failed', 'cancelled']) || 'failed'; state.record.totalMs = this.elapsed(state);
    this.schedule();
  }
  finishResponse(response, options) { try { const state = this.responses.get(response); if (state) this.finish(state, options); } catch {} }
}
const journal = new NetworkJournal();
module.exports = { NetworkJournal, configure: options => journal.configure(options), snapshot: () => journal.snapshot(), flush: () => journal.flush(),
  observedFetch: (...args) => journal.observedFetch(...args), observeResponseChunk: (...args) => journal.observeResponseChunk(...args), finishResponse: (...args) => journal.finishResponse(...args) };
