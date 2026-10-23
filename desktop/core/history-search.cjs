// SPDX-License-Identifier: EUPL-1.2
// Display-only local search. Never open project source files, call models, migrate
// history or grant access. Only read indexed records under the app's own store.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const LIMITS = Object.freeze({ projects: 100, chats: 500, indexBytes: 512 * 1024, chatBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, results: 50 });
const chatID = /^[a-f0-9-]{36}$/;
async function boundedJSON(file, limit, account) {
  let fd;
  try {
    fd = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await fd.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > limit) throw Error('Record unavailable');
    const buffer = Buffer.alloc(before.size + 1); let count = 0;
    while (count < buffer.length) { const part = await fd.read(buffer, count, buffer.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; account(part.bytesRead); }
    const after = await fd.stat();
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw Error('Record changed during search');
    return { bytes: count, data: JSON.parse(buffer.subarray(0, count).toString('utf8')) };
  } finally { await fd?.close(); }
}
async function searchHistory(history, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['query', 'project', 'chat', 'offset', 'limit'].includes(key))) throw Error('Brug den lokale samtalesøgning.');
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 200) throw Error('Skriv en søgning på højst 200 tegn.');
  if (input.project !== undefined && !/^[a-f0-9]{64}$/.test(input.project)) throw Error('Vælg et kendt projekt.');
  if (input.chat !== undefined && !chatID.test(input.chat)) throw Error('Vælg en kendt samtale.');
  const offset = input.offset ?? 0, limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > LIMITS.results) throw Error('Søgesiden er ugyldig.');
  const store = await history.store.read(), projects = Object.entries(store.projects || {}).filter(([, p]) => p.recent).map(([id, p]) => ({ id, ...p.recent })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const query = input.query.trim().normalize('NFC').toLocaleLowerCase('da'), found = [];
  let bytes = 0, chats = 0, skipped = 0, truncated = projects.length > LIMITS.projects;
  const storeRoot = await fs.realpath(history.store.root);
  outer: for (const project of projects.slice(0, LIMITS.projects)) {
    if (input.project && project.id !== input.project) continue;
    let entries;
    try {
      const folder = history.folder(project.root), expected = path.join(storeRoot, 'workspaces', path.basename(folder));
      if (await fs.realpath(folder) !== expected || await fs.realpath(path.dirname(history.file(project.root))) !== path.join(storeRoot, 'workspaces')) throw Error('History folder unavailable');
      const index = await boundedJSON(history.file(project.root), Math.min(LIMITS.indexBytes, LIMITS.totalBytes - bytes), count => { bytes += count; });
      if (index.data.version !== 2 || !Array.isArray(index.data.chats)) throw Error('Open this project to migrate older history first');
      entries = index.data.chats.filter(entry => entry && chatID.test(entry.id)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    } catch { skipped++; continue; }
    for (const entry of entries) {
      if (input.chat && entry.id !== input.chat) continue;
      if (++chats > LIMITS.chats || bytes >= LIMITS.totalBytes) { truncated = true; break outer; }
      let data;
      try {
        const record = await boundedJSON(history.chatFile(project.root, entry.id), Math.min(LIMITS.chatBytes, LIMITS.totalBytes - bytes), count => { bytes += count; }); data = record.data;
      } catch { skipped++; truncated = true; continue; }
      if (data.id !== entry.id || !Array.isArray(data.messages)) { skipped++; continue; }
      for (const message of data.messages) {
        if (!message || typeof message.id !== 'string' || message.id.length > 200 || typeof message.text !== 'string' || !['user', 'assistant', 'system'].includes(message.role)) continue;
        const text = message.text.slice(0, 30000).normalize('NFC'), at = text.toLocaleLowerCase('da').indexOf(query); if (at < 0) continue;
        found.push({ project: project.id, projectName: String(project.name || '').slice(0, 200), chat: entry.id, chatTitle: String(entry.title || '').slice(0, 200), message: message.id, role: message.role, excerpt: text.slice(Math.max(0, at - 90), Math.min(text.length, at + query.length + 180)), updatedAt: entry.updatedAt });
        if (found.length >= offset + limit + 1) break outer;
      }
    }
  }
  return { results: found.slice(offset, offset + limit), nextOffset: found.length > offset + limit ? offset + limit : null, truncated, skipped, scannedChats: chats, localOnly: true };
}
module.exports = { searchHistory, LIMITS };
