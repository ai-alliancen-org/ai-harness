# Fund til beta 3 · gennemgang 5. november 2026

Tre uafhængige gennemlæsere (godkendelser og motor, forhåndsvisning og prompt, CLI og udgivelse) har læst koden på `beta-3` og tjekket den bevarede del af den ældre fundliste. Niveau: *skrevet og læst i koden*. Fund 1, 8 og 9 er bekræftet af mig ved at læse kodestedet. Overblik og maskering er desuden kørt som små scripts. Intet er set kørende i appen, og ingen rettelser er lavet endnu.

Rangeret efter, hvad hvert fund ødelægger. Størrelse er ikke brugt til at rangere.

## A. Rettigheder bruges uden din viden

1. **Netadresser fra en fil, AI'en kan skrive** (høj). `core/preview-config.cjs:24` tager `network` fra `.aura/preview.json`, når du ikke selv har gemt en netliste. Startdialogen viser kun kommandoer og pakker. Forslag: tag aldrig `network` fra filen.
2. **`aura_preview` starter ukontrolleret kode** (middel). Samtykkets fingeraftryk dækker `package.json`, lockfiler og config, men ikke fx `server.js`. `core/ai-preview.cjs:12`, `core/dev-server.cjs:54`, `core/project-runtime.cjs:74`. Forslag: tag startfilerne med i fingeraftrykket.
3. **«Godkend alt» er bredere, end knappen siger** (middel). `chat-session.cjs:885` undtager kun grep og bash uden sandkasse. Eksterne mapper (`~/.netrc`, `~/.config/gh/hosts.yml`) og `webfetch` til en fremmed vært går uden kort. Tilstanden følger også med til en anden udbyder ved skift af model. Forslag: undtag `external_directory` og `webfetch`, og nulstil ved skift af forbindelse eller model.
4. **Fælles rensefunktion for nøgler mangler** (middel). Fem forskellige mønsterlister (`cli/terminal.cjs`, `core/connections.cjs`, `dev-server.cjs`, `git.cjs`, `pages-publishing.cjs`). `Authorization: Bearer <token>` og `KEY=<32 tegn>` står tilbage, og kun ordet «Bearer» maskeres i konsolteksten. Forslag: ét modul `core/secrets.cjs` med fixtureliste, brugt alle fem steder.
5. **Beskyttelseslisten mangler** `.netrc`, `id_rsa*`, `id_ed25519*`, `*.tfvars`, `.htpasswd`, og `*credentials*` spærrer samtidig `CredentialsForm.tsx` (`core/protected-paths.cjs:3`).
6. **`https:` for billeder** er en udgang for data (`core/preview-policy.cjs:30-31`).
7. **Samtalens konsoltekst** står som citeret JSON i systemlaget (`chat-session.cjs:47`), dæmpet men ikke fjernet.

## B. Arbejdet fejler eller mister samtalen

8. **Skift af arbejdsmåde genstarter motoren** i projekter med automatiske kommandoer eller Godkend alt, fordi `commandIsolation` og `autoCommandsSnapshot` indgår i identiteten (`chat-session.cjs:229-231`, `:275`). Det modsiger beslutningen om én motor og én session. Bekræftet af mig ved at læse koden.
9. **`*/policy/*` spærrer almindelige mapper** som `public/policy/privatliv.html` med sandkassen tændt (`core/engine.cjs:262`). Bekræftet i kode, ikke kørt i OpenCode.
10. **Stier med `[ ]` `{ }`** giver et kort uden indhold og kan ikke auto-godkendes (`approvals-policy.cjs:17`, `:56`).
11. **«Tillad altid» på en kommando har ingen virkning**, når sandkassen ikke kører (`approvals-policy.cjs:175`, `:227`; `ui/approvals.js:123`). Forslag: skjul knappen.
12. **Gatewayen** viser lokale fejl som netfejl og låser forbindelsen (`gateway.cjs:91`), og 120 s uden første byte er fatalt for lokale modeller (`:7`, `:58`).
13. **`snapshotMode` nulstilles aldrig** efter en genoprettelse, så hver delta giver et fuldt GET (`engine-events.cjs:136`).
14. **`aura_preview`** svarer forkert i statiske projekter og fejler for en samtale i baggrunden (`ai-preview.cjs:9`, `main.cjs:57`).

## C. Skærmen siger noget, der ikke er sandt

15. **komplais «Udgivet» kommer for tidligt**, og adressekontrollen springes over, når hubben ikke melder slugs (`ui/share-view.js:50-56`, `core/komplai-publish.cjs:111`, `:128`). Det er en af dine egne åbne beslutninger.
16. **Afvisninger fra komplai bliver «UNKNOWN»** og overskriver kvitteringen for en side, der er live (`core/deployments.cjs:114-122`).
17. **Overblik:** gammel visning ved projektskift (`ui/system-overview.js:5`), brugernavn med punktum vist som tjeneste (`system-overview.cjs:106`), `os.environ["X"]` overses og giver «ingen hemmeligheder», og et link i koden tæller som hosting (`:121`).
18. **Region vises ikke i CLI-login** (`cli/connections.cjs`).
19. **Tailwind-linjen i prompten** viser ikke den faktiske netliste (`project-guidance.cjs:25`).

## D. Det er svært at gå væk

20. **«Fjern forbindelse» og «Log ud» kan ikke gennemføres**, når komplai afviser tokenet (`core/komplai.cjs:127-130`).
21. **Nøglevinduet lukkes under gemning**, så hovedvinduet tror, du annullerede (`core/key-window.cjs:98`).
22. **CLI-login sletter forbindelsen** ved mislykket kontrol uden «gem alligevel».

## E. CLI

23. **Adgangssætning i stedet for nøglering**, scrypt N=32768 er under anbefalingen (`cli/storage.cjs:41-61`). Din beslutning venter.
24. **CLI-pakken mangler `command-sandbox-runner.mjs`**, så isolerede kommandoer aldrig virker pakket (`package.json:19`, `scripts/cli-release-contract.cjs:10`).
25. **Lås:** forældet lås kan i teorien give to ejere, og en lås med forkerte rettigheder låser CLI'en permanent (`cli/storage.cjs:71-89`). Ingen ejerkontrol af datamappen (`:13-19`).

## F. Udgivelse

26. **Ingen kildeprovenance** i `release.json`, og Windows-installeren har intet signaturbevis.
27. **Release- og Pages-workflows bruger flytbare action-tags** med skriverettigheder. Dependabot-PR'erne #6 til #9 hører her og kræver dit ok.
28. **`gh auth token` og Promte-CLI'ens login** tages i brug uden at vise scopes (`core/deployment-setup.cjs:43-46`).

## Status efter rettelserne, 5. november 2026

Rettet af fem spor med skeptiker-gennemgang bagefter. Niveau: *enhedsafprøvet* (hver ny prøve fejlede på den gamle kode og består nu). Hele enhedssuiten (976) og Electron-prøverne `test:approvals`, `test:planning`, `test:chat` og `test:preview-edit` samt `verify-write-guard`, `verify-preview-tool`, `verify-one-engine` og `verify-overview` bestod i verifikationen. Intet er kørt mod en rigtig model, `test:package` er ikke kørt (ingen pakket app i `release/mac-arm64`), og intet er deployet.

- **Rettet:** 1, 2 (kun filer, som kommandoen og npm-scriptet nævner, og deres relative importer), 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 25 og det fælles modul `core/secrets.cjs` til fund 4.
- **Delvist:** 4 (`pages-publishing` kan ikke bruge modulet direkte, fordi `verifyMaterial` serialiseres ind i YAML; mønstrene er indlejret i stedet, og git afviser kun de præcise typer), 6 (loopback og private adresser er lukket for billeder, men `https:` til offentlige værter er stadig en udgang), 20 («Fjern alligevel» ved netværksfejl kræver en ny kanal i `main.cjs`/`preload.cjs` og en knap).
- **Ikke rørt, fordi de er dine valg:** 23 (CLI-nøglering), 26 til 28 (workflows, provenance, `gh`-tokenets scopes), komplais interval og hvem der kontrollerer adressen.
- **Ændrede prøver med rette:** gatewayen låser ikke længere på lokale fejl (HTTP 400 i stedet for 502/409), en gemt kommandoregel kræver en kørende sandkasse, og en komplai-kvittering uden adressekontrol står som «Uploadet, adressen er ikke kontrolleret endnu».

## Status efter bølge 2 (hackathon-årsagerne), 5. november 2026

Niveau: *enhedsafprøvet*, og for motor, grep-vagt, motordata og gentagelsesvagt desuden *kørt mod den rigtige OpenCode 1.18.33 med en lokal falsk model*. Hele enhedssuiten (desktop 1058, CLI 48) og de otte Electron-prøver bestod i verifikationen efter, at to forældede forventninger (`features.test.cjs`, `protected-paths.test.cjs`) blev opdateret. Intet er kørt med en rigtig model, intet er set i en pakket app, `scripts/verify-approval-cards.cjs` er skrevet men ikke kørt, og ingen Windows- eller Linux-afprøvning.

- **Rettet:** 1 (gentagelsesvagt, grep i Byg med bevist vagt), 2 (motorens data spærret), 3 og 4 (kladde i baggrundssamtale, gentagne Planlæg-beskeder, historik ved modelskift uden aktiv motor, delvist), 5 (udbyderens fejltekst, tidsgrænse midt i strømmen, langsom motorstart, målt mod rigtig motor), 6 (CDN-diagnose i `aura_preview`, importmap og ESM), 7 (prompt, længdestop, README), 8 (planen kun én gang, udgivelsesdetaljer kun med Udgiv), 9 (git i sandkassen, oprindelig kommando i Aktivitet), 10 (CLI-login), 12 (hovedknappen), 13 (kortgrænse over 26 trin).
- **Delvist:** 11 (Ctrl+C afbryder ventetiden, men selve HTTP-kaldet kræver et signal gennem `core/connections.cjs`), 9a (localhost bevidst lukket).
- **Ikke taget, fordi det er dine valg eller nye funktioner:** stabilt projekt-id, CLI-nøglering og -version, netadgang for Tailwind, webskrifter og eksterne billeder, Windows uden isolation, komplais interval, skærmbillede af forhåndsvisning til modellen, startskabeloner, A til B til A-modelskift, kold start efter Stop, tarball-prøven og kørsel med en rigtig udbyder, vedvarende 429 til quota-kortet.
- **Fixtures:** `scripts/record-opencode-contract.cjs` kan ikke optage forløbssættene (afvises med «Gennemgå den aktuelle kontekst før afsendelse»), så de to kontraktprøver er kun fået nye kommentarer. *Rettet 5. november 2026 i opgraderingen til OpenCode 1.19.5: optageren sender nu beskeden og `contextBinding`, og fixtures er optaget igen (se `teststatus.md`).*

## Rettet siden den gamle liste (set i koden)

Byg nægter ikke længere filer i projektet (skrivevagt i motoren), Tillad ikke i Git-projekter, kaskaden ved auto-nægtelse, `<option>`-fejlen, den kvadratiske maskering, værnene i prompten, anden besked uden historik, «Godkend alt» kan ses og slås fra, `.aura/tmp` ryddes, og ingen workflow starter automatisk undtagen CodeQL og Dependabot.

## Ikke undersøgt

`ui/approvals.js` ud over de første linjer, `preview-edit`, `preview.cjs` (stiangreb), komplai/Promte-preview, `vercel-setup`, `azure-setup`, Windows-grenene i `canonicalPath`, om OpenCode 1.18.33 har værktøjet `multiedit`, og den rigtige OpenCode-matcher mod regelrækkefølgen. Intet er prøvet mod en rigtig model.
