// Kontrakten mellem OpenCode og Auras godkendelser. Fixtures er rigtige forespørgsler fra den låste OpenCode, optaget med
// scripts/record-opencode-contract.cjs; README.md i fixturemappen forklarer sæt, pladsholdere og de målte fakta.
// Del 1 læser kun fixtures og VERSION og består derfor på enhver Aura-kode, indtil der optages igen. Den beskriver, hvad
// motoren sender og gør. Tre påstande beskriver desuden Auras egen opsætning på optagetidspunktet (d816a9e) og skrives om,
// når de sæt optages igen: HEADs sandkasse (trin 6a), gentagelsesvagten i Planlæg (trin 3c) og politikforløbet uden
// experimental-flaget (trin 3d). README.md siger hvordan. En ny OpenCode-version kræver nye optagelser: testen fejler,
// indtil fixtures passer til VERSION i core/engine.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VERSION } = require('../core/engine.cjs');
// Optageren kører testen på en ny optagelse, før den lægges ind; ellers bruges mappen til den låste version.
const FIXTURES = process.env.AURA_OPENCODE_FIXTURES || path.join(__dirname, 'fixtures', `opencode-${VERSION}`);
const RECORD = 'Optag forespørgslerne igen med node scripts/record-opencode-contract.cjs (se README.md i fixturemappen).';
const read = file => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));
const list = dir => fs.existsSync(path.join(FIXTURES, dir)) ? fs.readdirSync(path.join(FIXTURES, dir)).filter(file => file.endsWith('.json')).sort() : [];
const index = fs.existsSync(path.join(FIXTURES, 'INDEX.json')) ? read('INDEX.json') : { entries: [], scenarios: {} };
const forloeb = list('.').filter(file => file !== 'INDEX.json').map(file => ({ file, ...read(file) }));
const set = name => Object.fromEntries(list(name).map(file => [file.replace(/\.json$/, ''), read(path.join(name, file))]));
const direkte = set('direkte'), politik = set('politik'), skal = set('skal'), gentagelse = set('gentagelse');
const sibling = (fx, permission) => forloeb.find(other => other.scenario === fx.scenario && other.case === fx.case && other.request.permission === permission);
const keys = object => Object.keys(object || {}).sort();
// Alle forespørgsler fra motoren, uanset sæt, i én form: { kilde, permission, patterns, always, metadata, callID }.
const requests = [
  ...forloeb.map(fx => ({ kilde: fx.file, ...fx.request, callID: fx.request.tool?.callID })),
  ...Object.entries(politik).flatMap(([name, run]) => run.requests.map((r, i) => ({ kilde: `politik/${name}#${i}`, ...r, callID: r.tool?.callID }))),
  ...Object.entries(skal).flatMap(([name, run]) => run.requests.map((r, i) => ({ kilde: `skal/${name}#${i}`, ...r }))),
  ...Object.entries(direkte).flatMap(([name, run]) => run.asked.map((r, i) => ({ kilde: `direkte/${name}#${i}`, ...r })))
];
// Pladsholderne udfyldes med en tænkt mappe. Del 1 rører ikke filsystemet.
function filler(fx) {
  const T = { BASE: '/optagelse', SYSTMP: '/systemets-temp', TASK: 'opgave', COPYID: 'kopi', PROJECTKEY: 'projektnoegle', WORKSPACEKEY: 'arbejdsnoegle' };
  T.DOCUMENTS = T.BASE + '/Dokumenter'; T.STORE = T.BASE + '/appdata/harness';
  if (fx.layout.git === 'parent') T.REPO = T.DOCUMENTS + '/repo';
  T.ROOT = (T.REPO || T.DOCUMENTS) + '/projekt'; T.OUTSIDE = T.DOCUMENTS + '/ekstern';
  T.WORKSPACE = fx.layout.copy ? `${T.STORE}/copies/${T.COPYID}/project` : T.ROOT;
  T.SCRATCH = `${T.STORE}/scratch/${T.PROJECTKEY}/${T.TASK}`; T.RUNTIME = `${T.STORE}/runtime/${T.WORKSPACEKEY}`;
  return text => text.replace(/\$\{([A-Z]+)(:rel\/)?\}/g, (all, key, rel) => { assert.equal(typeof T[key], 'string', `${fx.file}: ukendt pladsholder ${all}`); return rel ? T[key].slice(1) : T[key]; });
}

test('optagelserne er lavet med den OpenCode-version, Aura starter', () => {
  assert.ok(fs.existsSync(FIXTURES), `Der er ingen optagelser for OpenCode ${VERSION}. ${RECORD}`);
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(path.join(FIXTURES, dir), { withFileTypes: true })) { if (entry.isDirectory()) walk(path.join(dir, entry.name)); else if (entry.name.endsWith('.json')) files.push(path.join(dir, entry.name)); } };
  walk('.');
  for (const file of files) assert.equal(read(file).opencode, VERSION, `${file} er optaget med en anden OpenCode. ${RECORD}`);
});

test('alle sæt er optaget, og INDEX.json passer til filerne', () => {
  assert.deepEqual(Object.keys(index.scenarios).sort(), ['apply-patch-git', 'apply-patch-uden-git', 'byg-git-filer', 'byg-git-soeg', 'byg-uden-git-filer', 'byg-uden-git-soeg', 'free-git-filer', 'git-foraelder', 'kopi-git', 'plan-git', 'samtale-git'], RECORD);
  assert.deepEqual(Object.keys(direkte), ['mapper', 'regler-git', 'regler-uden-git', 'skills-sti', 'spoerg-alt', 'symlink'], RECORD);
  assert.deepEqual(Object.keys(politik), ['sandkasse', 'uden-sandkasse'], RECORD);
  assert.deepEqual(Object.keys(skal), ['config-shell', 'uden-skal'], RECORD);
  assert.deepEqual(Object.keys(gentagelse), ['afvist-med-besked', 'once', 'uden-flag'], RECORD);
  assert.ok(forloeb.length >= 150, `for få forløbsoptagelser: ${forloeb.length}`);
  assert.deepEqual(index.entries.filter(entry => entry.file).map(entry => entry.file).sort(), forloeb.map(fx => fx.file));
  for (const fx of forloeb) assert.ok(index.scenarios[fx.scenario], fx.file);
});

test('OpenCode sender kun former, kontrakten kender', () => {
  // En ny form fra en ny OpenCode skal have sin egen regel her, før Aura kan fortolke den.
  const known = ['external_directory', 'edit', 'bash', 'grep', 'webfetch', 'doom_loop', 'skill', 'todowrite'];
  for (const r of requests) assert.ok(known.includes(r.permission), `${r.kilde}: ukendt form ${r.permission}`);
  for (const permission of ['external_directory', 'edit', 'bash', 'grep', 'webfetch', 'doom_loop']) assert.ok(forloeb.some(fx => fx.request.permission === permission), `ingen ${permission} i forløbene`);
});

test('mappeadgang er "<mappe>/*" med filepath og parentDir, eller kommandoformen med directories', () => {
  const folders = requests.filter(item => item.permission === 'external_directory');
  assert.ok(folders.length >= 50, `for få mappeforespørgsler: ${folders.length}`);
  for (const r of folders) {
    assert.deepEqual(r.always, r.patterns, r.kilde);
    if (r.metadata.directories) {
      assert.deepEqual(keys(r.metadata), ['command', 'directories', 'patterns'], r.kilde);
      assert.deepEqual(r.patterns, r.metadata.directories.map(dir => dir + '/*'), r.kilde);
      assert.deepEqual(r.metadata.patterns, r.patterns, r.kilde);
    } else {
      assert.deepEqual(keys(r.metadata), ['filepath', 'parentDir'], r.kilde);
      assert.deepEqual(r.patterns, [r.metadata.parentDir + '/*'], r.kilde);
      // parentDir er filens mappe, eller stien selv, når det er en mappe.
      assert.ok(r.metadata.filepath === r.metadata.parentDir || path.posix.dirname(r.metadata.filepath) === r.metadata.parentDir, r.kilde);
    }
  }
});

test('filændringens mønster er relativt til worktree, og målet står kun i metadata', () => {
  const edits = forloeb.filter(fx => fx.request.permission === 'edit');
  assert.ok(edits.length >= 40);
  for (const fx of edits) {
    const fill = filler(fx), worktree = fill(fx.layout.worktree), { patterns, always, metadata } = fx.request;
    assert.deepEqual(always, ['*'], fx.file);
    if (metadata.files) {
      // apply_patch: én sti pr. fil, og filepath er de relative stier samlet.
      assert.ok('filepath' in metadata && keys(metadata).every(key => ['diff', 'filepath', 'files'].includes(key)), fx.file);
      assert.deepEqual(patterns, metadata.files.map(file => file.relativePath), fx.file);
      for (const file of metadata.files) assert.equal(fill(file.relativePath), path.posix.relative(worktree, fill(file.filePath)), fx.file);
      assert.equal(metadata.filepath, patterns.join(', '), fx.file);
    } else {
      assert.deepEqual(keys(metadata), ['diff', 'filepath'], fx.file);
      assert.ok(metadata.filepath.startsWith('${'), `${fx.file}: filepath er absolut`);
      assert.deepEqual(patterns.map(fill), [path.posix.relative(worktree, fill(metadata.filepath))], fx.file);
    }
  }
  // Uden Git er worktree "/", så mønsteret er den absolutte sti uden foranstillet skråstreg. En samtalekopi har ingen .git.
  assert.ok(edits.some(fx => fx.layout.worktree === '/' && fx.request.patterns[0].startsWith('${ROOT:rel/}')));
  assert.ok(edits.some(fx => fx.layout.copy && fx.request.patterns[0].startsWith('${WORKSPACE:rel/}')));
});

test('søgningens mønster er søgeordet, og værktøjets input er endnu ukendt, når der spørges', () => {
  const searches = requests.filter(r => r.permission === 'grep');
  assert.ok(searches.length >= 20);
  for (const r of searches) {
    assert.deepEqual(r.patterns, [r.metadata.pattern], r.kilde);
    assert.deepEqual(r.always, ['*'], r.kilde);
    assert.ok(keys(r.metadata).every(key => ['include', 'path', 'pattern'].includes(key)), r.kilde);
  }
  for (const fx of forloeb.filter(item => item.request.permission === 'grep')) assert.equal(fx.toolPartAtAsk?.status, 'pending', fx.file);
});

test('kommandoer sendes som tekst alene; mønstrene er delt pr. delkommando, og always er præfikser', () => {
  const commands = requests.filter(r => r.permission === 'bash');
  assert.ok(commands.length >= 40);
  for (const r of commands) {
    // Hverken arbejdsmappe, beskrivelse eller timeout kommer med.
    assert.deepEqual(keys(r.metadata), ['command'], r.kilde);
    assert.equal(new Set(r.always).size, r.always.length, `${r.kilde}: always har gentagelser`);
    for (const prefix of r.always) assert.ok(prefix.endsWith(' *'), `${r.kilde}: ${prefix}`);
    const covered = (pattern, prefix) => pattern === prefix.slice(0, -2) || pattern.startsWith(prefix.slice(0, -1));
    for (const pattern of r.patterns) assert.ok(r.always.some(prefix => covered(pattern, prefix)), `${r.kilde}: ${pattern} har intet præfiks`);
    for (const prefix of r.always) assert.ok(r.patterns.some(pattern => covered(pattern, prefix)), `${r.kilde}: ${prefix} bruges ikke`);
  }
  const pipe = commands.find(r => r.metadata.command === 'npm run build 2>&1 | tail -20');
  assert.deepEqual([pipe.patterns, pipe.always], [['npm run build 2>&1', 'tail -20'], ['npm run build *', 'tail *']]);
});

test('webfetch, gentagelsesvagten, skill og huskeliste har hver deres faste form', () => {
  for (const r of requests.filter(item => item.permission === 'webfetch')) {
    assert.deepEqual([r.patterns, r.always], [[r.metadata.url], ['*']], r.kilde);
    assert.ok(keys(r.metadata).every(key => ['format', 'timeout', 'url'].includes(key)), r.kilde);
  }
  const loops = requests.filter(item => item.permission === 'doom_loop');
  assert.ok(loops.length >= 3);
  for (const r of loops) {
    assert.deepEqual(keys(r.metadata), ['input', 'tool'], r.kilde);
    assert.deepEqual([r.patterns, r.always], [[r.metadata.tool], [r.metadata.tool]], r.kilde);
    // Gentagelsesvagten har intet tool-felt og dermed intet callID.
    assert.equal(r.tool, undefined, r.kilde); assert.equal(r.callID, undefined, r.kilde);
  }
  const asked = Object.fromEntries(direkte['spoerg-alt'].asked.map(r => [r.permission, r]));
  assert.deepEqual([asked.skill.patterns, asked.skill.always, asked.skill.metadata], [['aura-proeve'], ['aura-proeve'], {}]);
  assert.deepEqual([asked.todowrite.patterns, asked.todowrite.always, asked.todowrite.metadata], [['*'], ['*'], {}]);
});

test('rækkefølgen: mappen før filen og kommandoen, søgningen før mappen, og samme callID', () => {
  // Filændring uden for projektet: først mappen, mens værktøjets input endnu er tomt, så filen.
  const edits = forloeb.filter(fx => fx.request.permission === 'edit' && fx.askIndex === 2);
  assert.ok(edits.length >= 20);
  for (const fx of edits) {
    const folder = sibling(fx, 'external_directory');
    assert.equal(folder?.askIndex, 1, fx.file);
    assert.equal(folder.request.tool.callID, fx.request.tool.callID, fx.file);
    assert.ok(fx.sequence.indexOf('spørg:external_directory') < fx.sequence.indexOf('spørg:edit'), fx.file);
    assert.deepEqual([folder.toolPartAtAsk?.status, folder.toolPartAtAsk?.input], ['pending', {}], folder.file);
  }
  // Søgning uden for projektet: først søgningen, så mappen.
  const searches = forloeb.filter(fx => fx.request.permission === 'external_directory' && fx.toolPartAtAsk?.tool === 'grep');
  assert.ok(searches.length >= 4);
  for (const fx of searches) { const grep = sibling(fx, 'grep'); assert.equal(grep?.askIndex, 1, fx.file); assert.equal(fx.askIndex, 2, fx.file); assert.equal(grep.request.tool.callID, fx.request.tool.callID, fx.file); }
  // Læsning og filsøgning uden for projektet spørger kun om mappen.
  for (const fx of forloeb.filter(item => ['read', 'glob'].includes(item.toolPartAtAsk?.tool))) assert.deepEqual([fx.request.permission, fx.asksInStep], ['external_directory', 1], fx.file);
  // Kommando: først mappen fra OpenCodes egen stikontrol, så kommandoen, i samme kald.
  const folders = requests.filter(r => r.permission === 'external_directory' && r.metadata.directories);
  assert.ok(folders.length >= 10);
  // Samme optagelse: forløbets scenarie og trin, eller sættets navn.
  const run = r => r.kilde.split('#')[0].split('__').slice(0, 2).join('__');
  for (const r of folders) {
    const command = requests.find(other => run(other) === run(r) && other.permission === 'bash' && other.callID === r.callID);
    assert.ok(command, `${r.kilde}: ingen kommando i samme kald`);
    assert.ok(requests.indexOf(command) > requests.indexOf(r), r.kilde);
  }
});

test('et projekt inde i en større Git-rod: OpenCode spørger aldrig om mappeadgang inden for roden', () => {
  const parent = forloeb.filter(fx => fx.scenario === 'git-foraelder');
  assert.deepEqual([...new Set(parent.filter(fx => fx.request.permission === 'external_directory').map(fx => fx.case))], ['write-uden-for-repo']);
  // Læsning og kommandoer i søskendemappen går igennem uden forespørgsel; filændringen er relativ til repo-roden.
  for (const step of ['read-soeskende-i-repo']) assert.equal(index.entries.find(entry => entry.scenario === 'git-foraelder' && entry.case === step)?.file, null, step);
  assert.deepEqual(parent.find(fx => fx.case === 'write-soeskende-i-repo').request.patterns, ['andet-projekt/fil.txt']);
});

test('OpenCode opdager ikke omdirigeringer, og ~ er motorens HOME', () => {
  // echo > fil uden for projektet giver kun kommandoforespørgslen, og filen bliver skrevet.
  const tmp = index.entries.filter(entry => entry.case === 'bash-redirect-tmp' && entry.file);
  assert.ok(tmp.length >= 2);
  for (const entry of tmp) assert.equal(entry.permission, 'bash', entry.file);
  const redirect = skal['config-shell'].requests.filter(r => r.callID === skal['config-shell'].tools.find(t => t.command.startsWith('echo x >')).callID);
  assert.deepEqual(redirect.map(r => r.permission), ['bash']);
  assert.equal(skal['config-shell'].udenForFil, 'x\n');
  const outside = politik['uden-sandkasse'].requests.find(r => r.permission === 'bash' && r.metadata.command.startsWith('echo x >'));
  assert.equal(politik['uden-sandkasse'].requests.filter(r => r.tool?.callID === outside.tool.callID).length, 1);
  assert.equal(politik['uden-sandkasse'].results.find(r => r.callID === outside.tool.callID)?.status, 'completed');
  // cat ~/.ssh/id_rsa: OpenCode udvider ~ med motorens HOME (RUNTIME/home og APPDATA/runtime/noegle/home), ikke brugerens.
  assert.deepEqual(skal['config-shell'].requests.find(r => r.metadata.command?.startsWith('cat ~') && r.permission === 'external_directory').metadata.directories, ['${RUNTIME}/home/.ssh']);
  assert.deepEqual(politik['uden-sandkasse'].requests.find(r => r.metadata.command?.startsWith('cat ~') && r.permission === 'external_directory').metadata.directories, ['${APPDATA}/runtime/noegle/home/.ssh']);
});

test('med en indpakningsskal i config.shell ser forespørgslerne ud som uden', () => {
  const run = skal['config-shell'];
  assert.equal(run.effectiveShell, '${BASE}/appdata/betroet/bin/bash');
  // Skallen kaldes med -c og den oprindelige kommando, og forespørgslen har den oprindelige kommando.
  assert.deepEqual(run.wrapperLog.trim().split('\n'), run.tools.map(t => `ARGV: [-c] [${t.command}]`));
  for (const r of run.requests) assert.ok(run.tools.some(t => t.command === r.metadata.command && t.callID === r.callID), JSON.stringify(r));
  // OpenCodes egen mappekontrol virker: cd .. og en arbejdsmappe uden for projektet spørger først om mappen.
  const callOf = prefix => run.tools.find(t => t.command.startsWith(prefix) && (prefix !== 'ls' || t.workdir)).callID;
  assert.deepEqual(run.requests.filter(r => r.callID === callOf('cd ..')).map(r => [r.permission, r.patterns]), [['external_directory', ['${BASE}/*']], ['bash', ['pwd']]]);
  assert.deepEqual(run.requests.filter(r => r.callID === callOf('ls')).map(r => [r.permission, r.patterns]), [['external_directory', ['${OUTSIDE}/*']], ['bash', ['ls']]]);
  // Samme fem kommandoer uden config.shell giver præcis de samme forespørgsler.
  assert.deepEqual(run.requests.map(r => [r.permission, r.patterns, r.always, r.metadata]), skal['uden-skal']?.requests.map(r => [r.permission, r.patterns, r.always, r.metadata]));
});

test('Auras opsætning på d816a9e: HEADs sandkasse omskriver kommandoen, før OpenCode spørger, og fjerner OpenCodes egen mappekontrol', () => {
  // Efter trin 6a omskriver sandkassen ikke længere kommandoen. Så fejler denne påstand ved næste optagelse og skrives om.
  const SIX_A = 'politik/sandkasse.json er optaget med en anden sandkasse end den på d816a9e. Efter trin 6a er det forventet: skriv påstanden om (README.md, punkt 9).';
  const run = politik.sandkasse;
  assert.ok(run.requests.length >= 4);
  for (const r of run.requests) {
    assert.equal(r.permission, 'bash', SIX_A);
    assert.deepEqual([r.patterns, r.always], [[r.metadata.command], ['exec *']], SIX_A);
    assert.match(r.metadata.command, /^exec \/usr\/bin\/env -i .*'\$\{PAYLOAD\}'$/, SIX_A);
    assert.doesNotMatch(r.partAtAsk.input.command, /^exec /, 'værktøjets input har stadig den oprindelige kommando');
  }
  assert.ok(run.requests.some(r => r.partAtAsk.input.command === 'cd .. && ls'), 'cd .. blev kørt uden mappeforespørgsel');
});

test('afvisninger: gentagelsesvagten stopper opgaven, en enkelt afvisning med besked gør ikke, og én afvisning afviser de ventende', () => {
  // Gentagelsesvagten afvist med besked giver session.error, også med experimental.continue_loop_on_deny. experimental er
  // OpenCodes effektive konfiguration (GET /config), så flaget er modtaget, ikke kun sendt.
  const rejected = gentagelse['afvist-med-besked'];
  assert.equal(rejected.experimental?.continue_loop_on_deny, true);
  assert.equal(rejected.sendtExperimental?.continue_loop_on_deny, true);
  assert.deepEqual(rejected.requests.map(r => [r.permission, r.sendt, r.svar]), [['doom_loop', 'reject+besked', 'reject']]);
  assert.match(rejected.status, /^session\.error .*Du gentager samme kald/);
  // Ét modelkald, og ingen af de tre ens læsninger blev gennemført; de bliver afbrudt, når opgaven stopper.
  assert.equal(rejected.modelCalls, 1);
  assert.ok(rejected.results.every(result => !result.endsWith(':completed')), rejected.results.join(', '));
  const policyRun = politik['uden-sandkasse'];
  // Politiksættet bruger Auras egen konfiguration. Efter trin 3d har den flaget, og påstandene om "uden flaget" skrives om.
  assert.equal(policyRun.experimental, null, 'politik/uden-sandkasse.json er optaget med Auras experimental-flag. Efter trin 3d er det forventet: skriv påstandene om afvisning uden flaget om (README.md, "Når Workbench, ChatSession eller godkendelserne ændres").');
  assert.deepEqual(policyRun.requests.filter(r => r.permission === 'doom_loop').map(r => r.sendt), ['reject+besked']);
  assert.match(policyRun.status, /^session\.error .*Du gentager samme kald/);
  // Med "once" fortsætter opgaven.
  const once = gentagelse.once;
  assert.equal(once.experimental?.continue_loop_on_deny, true);
  assert.equal(once.requests[0].permission, 'doom_loop'); assert.equal(once.requests[0].sendt, 'once');
  assert.equal(once.status, 'session.idle');
  // Kaskaden: Aura afviste kun webfetch; OpenCode afviste selv den ventende kommando uden besked. Trinnet efter kørte.
  // Optageren afviser først webfetch, når kommandoen venter, så kaskaden kan ramme den.
  const held = once.requests.find(r => r.permission === 'bash' && r.patterns[0] === 'echo a');
  assert.deepEqual([held.ventedeVedAfvisning, held.sendt, held.svar], [true, null, 'reject']);
  assert.deepEqual(once.requests.find(r => r.permission === 'webfetch').sendt, 'reject+besked');
  assert.ok(once.results.includes('bash:error The user rejected permission to use this specific tool call.'));
  assert.equal(once.results.at(-1), 'bash:completed');
  assert.equal(once.modelCalls, 4);
  // Samme forløb uden flaget: den samme kaskade, men afvisningen uden besked stopper opgaven. Trinnet efter kører aldrig.
  const without = gentagelse['uden-flag'];
  assert.notEqual(without.experimental?.continue_loop_on_deny, true);
  assert.notEqual(without.sendtExperimental?.continue_loop_on_deny, true);
  // Kommandoen og webfetch kommer parallelt, så deres rækkefølge er ikke fast.
  const cascade = run => ['doom_loop', 'webfetch', 'bash'].map(permission => run.requests.find(r => r.permission === permission)).map(r => [r.permission, r.patterns, r.ventedeVedAfvisning, r.sendt, r.svar]);
  assert.deepEqual(cascade(without), cascade(once));
  assert.deepEqual(without.requests.map(r => r.permission).sort(), ['bash', 'doom_loop', 'webfetch']);
  assert.equal(without.status, 'session.idle');
  assert.equal(without.modelCalls, 2);
  assert.equal(without.results.at(-1), 'bash:error The user rejected permission to use this specific tool call.');
  assert.ok(!without.results.includes('bash:completed'), without.results.join(', '));
  // Uden experimental.continue_loop_on_deny: en enkelt kommando afvist med besked giver en fejl med beskeden, og opgaven fortsætter.
  const singles = policyRun.requests.filter(r => r.permission === 'bash' && r.sendt === 'reject+besked');
  assert.ok(singles.length >= 2);
  for (const r of singles) {
    const position = policyRun.results.findIndex(result => result.callID === r.tool.callID);
    assert.match(policyRun.results[position].error, /following feedback/);
    assert.ok(position < policyRun.results.length - 1, `${r.patterns}: opgaven fortsatte ikke`);
  }
});

test('Auras opsætning på d816a9e: gentagelsesvagten i Planlæg rammer Auras "*": "deny" og stopper opgaven uden at spørge', () => {
  // Trin 3c giver Planlæg doom_loop: 'ask' (core/engine.cjs, permissions() for chat og plan). Så ender plan-git i idle ved
  // næste optagelse med en doom_loop-forespørgsel, og denne påstand skrives om.
  const THREE_C = 'plan-git stopper ikke længere ved gentagelsesvagten. Efter trin 3c (Auras doom_loop: "ask" i Planlæg) er det forventet: skriv påstanden om (README.md, punkt 10).';
  assert.equal(index.scenarios['plan-git'].outcome, 'error', THREE_C);
  assert.match(index.scenarios['plan-git'].error, /"permission":"doom_loop","action":"ask"/, THREE_C);
  assert.match(index.scenarios['plan-git'].error, /"permission":"\*","action":"deny"/, THREE_C);
  assert.equal(index.entries.find(entry => entry.scenario === 'plan-git' && entry.case === 'doom-loop')?.file, null, THREE_C);
  for (const scenario of ['byg-git-soeg', 'byg-uden-git-soeg']) {
    assert.equal(index.scenarios[scenario].outcome, 'idle');
    assert.ok(forloeb.some(fx => fx.scenario === scenario && fx.request.permission === 'doom_loop'), scenario);
  }
});

test('OpenCode afgør inde og ude leksikalsk, og mønsterreglerne virker som målt', () => {
  // Et link i projektet, der peger ud: skrivning, læsning og søgning gennem linket gav ingen mappeforespørgsel.
  const link = direkte.symlink;
  assert.deepEqual(link.asked.map(r => r.permission), ['bash']);
  for (const step of ['write-gennem-link', 'read-gennem-link-uden-laesevagt', 'grep-gennem-link', 'glob-gennem-link']) assert.equal(link.results.find(r => r.step === step)?.status, 'completed', step);
  const askedIn = name => direkte[name].asked.map(r => r.step);
  // Git: en relativ regel virker, en absolut eller en uden foranstillet skråstreg gør ikke. 'npm run build*' dækker også
  // 'npm run buildx', og '<mappe>/*' dækker undermapper.
  assert.deepEqual(askedIn('regler-git').filter(step => step.startsWith('write-') || step.startsWith('read-') || step.includes('buildx')), ['write-src-absolut-regel', 'write-lib-uden-skraastreg-regel', 'write-ude-tilladt-mappe', 'read-andet-sted']);
  // Uden Git virker kun den absolutte sti uden skråstreg og '*/projekt/mappe/*'.
  assert.deepEqual(askedIn('regler-uden-git'), ['write-public-relativ-regel', 'write-src-absolut-regel']);
  // skills.paths finder både projektets .aura/skills og en absolut mappe.
  for (const step of ['skill-i-projektet', 'skill-delt-uden-for']) assert.equal(direkte['skills-sti'].results.find(r => r.step === step)?.status, 'completed', step);
  // OPENCODE_DB og TMPDIR i projektets .aura: databasen lander dér, og Bun pakker sit bibliotek ud i TMPDIR.
  const files = direkte.mapper.files.join('\n');
  assert.match(files, /\$\{BASE\}\/Dokumenter\/projekt\/\.aura\/opencode\/opencode\.db /);
  assert.match(files, /\$\{BASE\}\/Dokumenter\/projekt\/\.aura\/tmp\/[^ ]*\.dylib /);
});
