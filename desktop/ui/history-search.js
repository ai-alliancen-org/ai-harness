// SPDX-License-Identifier: EUPL-1.2
// Local display search. It never prepares a model prompt or restores a grant.
(() => {
  if (typeof window.harness?.historySearch !== 'function') return;
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
  const t = (da, en) => document.documentElement.lang === 'en' ? en : da;
  const dialog = make('dialog', null, 'history-search-dialog'); dialog.id = 'history-search-dialog'; dialog.setAttribute('aria-labelledby', 'history-search-title');
  const header = make('div', null, 'dialog-heading'), title = make('h2'); title.id = 'history-search-title';
  const close = make('button'); close.type = 'button'; close.id = 'history-search-close'; header.append(title, close);
  const note = make('p', null, 'hint'), form = make('form', null, 'history-search-form'), queryLabel = make('label'), query = make('input'); query.type = 'search'; query.maxLength = 200; query.required = true; query.id = 'history-search-query'; queryLabel.htmlFor = query.id;
  const scopeLabel = make('label'), scope = make('select'); scope.id = 'history-search-scope'; scopeLabel.htmlFor = scope.id;
  const search = make('button', null, 'primary'); search.type = 'submit'; search.id = 'history-search-submit';
  form.append(queryLabel, query, scopeLabel, scope, search);
  const status = make('p', null, 'hint'); status.id = 'history-search-status'; status.setAttribute('role', 'status');
  const list = make('ol', null, 'history-search-results'); list.id = 'history-search-results';
  const more = make('button', null, 'text-button'); more.type = 'button'; more.id = 'history-search-more'; more.hidden = true;
  dialog.append(header, note, form, status, list, more); document.body.append(dialog);
  let generation = 0, activeSearch = null, nextOffset = null, opener = null, busy = false, rows = [], currentScope = null;
  const selection = () => ({ project: window.chats?.projects().find(project => project.root === current?.root)?.id, chat: view?.id });
  function localize() {
    title.textContent = t('Søg i lokale beskeder', 'Search local messages'); close.textContent = t('Luk', 'Close'); queryLabel.textContent = t('Ord eller sætning', 'Word or phrase'); scopeLabel.textContent = t('Søg i', 'Search in'); search.textContent = t('Søg', 'Search'); more.textContent = t('Vis flere resultater', 'Show more results');
    note.textContent = t('Søgning bliver på denne computer. Et træf tilføjes ikke til AI’ens kontekst.', 'Search stays on this computer. A result is never added to AI context.');
    const chosen = scope.value || 'project'; scope.replaceChildren();
    for (const [value, label] of [['all', t('Alle lokale projekter', 'All local projects')], ['project', t('Dette projekt', 'This project')], ['chat', t('Denne samtale', 'This conversation')]]) { const option = make('option', label); option.value = value; option.disabled = value !== 'all' && !currentScope?.project || value === 'chat' && !currentScope?.chat; scope.append(option); }
    scope.value = currentScope?.project ? chosen : 'all';
  }
  function highlight(target, text, needle) {
    const at = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
    if (at < 0) { target.textContent = text; return; }
    target.append(document.createTextNode(text.slice(0, at)), make('mark', text.slice(at, at + needle.length)), document.createTextNode(text.slice(at + needle.length)));
  }
  function render() {
    list.replaceChildren();
    for (const result of rows) {
      const item = make('li'), button = make('button', null, 'history-search-result'); button.type = 'button';
      button.append(make('strong', `${result.projectName} · ${result.chatTitle || t('Ny samtale', 'New conversation')}`));
      const excerpt = make('span'); highlight(excerpt, result.excerpt, activeSearch?.query || ''); button.append(excerpt, make('small', `${result.updatedAt || ''} · ${({ user: t('Dig', 'You'), assistant: 'AI', system: t('System', 'System') })[result.role] || result.role}`));
      button.onclick = async () => {
        const ticket = generation; button.disabled = true;
        try { const target = await window.openStoredMessage(result); if (ticket === generation) { dialog.close(); target?.scrollIntoView?.({ block: 'center', behavior: 'auto' }); target?.focus?.({ preventScroll: true }); } }
        catch (error) { if (ticket === generation) { status.textContent = error.message; button.disabled = false; } }
      };
      item.append(button); list.append(item);
    }
    more.hidden = nextOffset == null; search.disabled = busy; more.disabled = busy;
  }
  async function run(offset = 0) {
    const text = query.value.trim(); if (!text || text.length > 200) return;
    const ticket = ++generation, basis = { query: text, limit: 20 };
    if (scope.value !== 'all' && currentScope?.project) basis.project = currentScope.project;
    if (scope.value === 'chat' && currentScope?.chat) basis.chat = currentScope.chat;
    activeSearch = basis; if (!offset) rows = []; busy = true; nextOffset = null; render();
    status.textContent = t('Søger i lokal historik …', 'Searching local history …');
    try {
      const result = await call('historySearch', { ...basis, offset });
      if (ticket !== generation || !dialog.open) return;
      if (result?.localOnly !== true || !Array.isArray(result.results)) throw new Error(t('Søgeresultatet kunne ikke bekræftes.', 'The search result could not be confirmed.'));
      rows.push(...result.results); nextOffset = result.nextOffset;
      status.textContent = `${rows.length} ${t('lokale træf', 'local matches')}${result.truncated ? t(' · søgningen er afgrænset', ' · search was bounded') : ''}${result.skipped ? t(' · utilgængelige samtaler blev sprunget over', ' · unavailable conversations were skipped') : ''}`;
    } catch (error) { if (ticket === generation) status.textContent = error.message; }
    finally { if (ticket === generation) { busy = false; render(); } }
  }
  form.onsubmit = event => { event.preventDefault(); void run(); };
  more.onclick = () => { if (nextOffset != null) void run(nextOffset); };
  const invalidate = () => { generation++; busy = false; rows = []; nextOffset = null; activeSearch = null; status.textContent = ''; render(); };
  query.addEventListener('input', invalidate); scope.addEventListener('change', invalidate);
  close.onclick = () => dialog.close();
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } });
  dialog.addEventListener('close', () => { generation++; busy = false; if (opener?.isConnected && document.activeElement === document.body) opener.focus(); });
  window.addEventListener('aura:languagechange', () => { localize(); render(); });
  document.getElementById('history-search-open').onclick = () => window.localHistorySearch.open();
  window.localHistorySearch = { open() { opener = document.activeElement; currentScope = selection(); localize(); invalidate(); if (!dialog.open) dialog.showModal(); query.focus(); } };
})();
