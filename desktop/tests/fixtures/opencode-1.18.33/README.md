# OpenCode 1.18.33: optagede tilladelsesforespørgsler

Her ligger rigtige `permission.asked`-forespørgsler fra den OpenCode-version, Aura starter (`VERSION` i `core/engine.cjs`). De er optaget med en falsk model på 127.0.0.1, så der er ingen modelkald og ingen nøgler. `tests/opencode-contract.test.cjs` bruger dem:

- **Del 1** beskriver, hvad OpenCode sender og gør. Tre påstande beskriver desuden Auras opsætning på `d816a9e` (se "Når Workbench, ChatSession eller godkendelserne ændres"). Del 1 læser kun fixtures og `VERSION` og består derfor på enhver Aura-kode, indtil der optages igen.
- **Del 1 fejler, når `VERSION` ændres**, indtil der er optaget forfra for den nye version.
- Senere dele prøver Auras fortolkning af de samme forespørgsler.

## Sættene

| Mappe | Indhold | Optaget med |
|---|---|---|
| `<scenarie>__<trin>__<n>-<form>.json` og `INDEX.json` | 156 forespørgsler fra 11 forløb gennem Workbench → ChatSession → OpenCodeEngine, med vagtproces og gateway. `INDEX.json` har en linje pr. forespørgsel og pr. trin uden forespørgsel (170 trin, heraf 53 uden) og udfaldet pr. forløb. Hver fil har også Auras afgørelse på optagetidspunktet (`policyInput`, `recordedAura`). | Byg og 'free' med og uden Git, Planlæg, Samtale, en samtalekopi, et projekt inde i en Git-rod og `apply_patch` med og uden Git. Svaret var altid "Tillad én gang". |
| `direkte/` | Seks forsøg med Auras isolerede miljø, men ændrede regler, skills eller mapper: `regler-git`, `regler-uden-git`, `skills-sti`, `mapper`, `symlink` og `spoerg-alt`. | OpenCode startet direkte. Svaret var altid "once". |
| `politik/` | En typisk byggeopgave med 32 trin uden sandkasse og 5 trin med HEADs kommandosandkasse. Hver forespørgsel har `sendt` (Auras svar) og `svar` (OpenCodes `permission.replied`). | OpenCodeEngine. npm, npx og curl er stubbe. Kald ud af maskinen blev afvist med en besked, og det blev gentagelsesvagten også. |
| `skal/` | Fem kommandoer med en indpakningsskal i `config.shell` (`config-shell.json`, kritikkens K2) og de samme fem uden (`uden-skal.json`). | OpenCode startet direkte, `bash: 'ask'`, svaret "once". `uden-skal.json` er optaget med `scripts/record-opencode-contract.cjs` i trin 1. |
| `gentagelse/` | Gentagelsesvagten besvaret med `once` og afvist med en besked, begge med `experimental.continue_loop_on_deny: true` (kritikkens K1), og `uden-flag`: samme forløb som `once` uden flaget. `experimental` er OpenCodes effektive konfiguration fra `GET /config`, `sendtExperimental` det, optageren sendte. | OpenCode startet direkte. Trin 2 har to samtidige forespørgsler. Webfetch afvises med en besked, og kommandoen holdes tilbage; den besvares kun, hvis OpenCode ikke selv har svaret. |

Feltet `kilde` i hver fil siger, hvilket script der optog den. Optagelserne er fra milepæl 1's designfase (Aura `d816a9e`), undtagen `skal/uden-skal.json` og `gentagelse/`, som er optaget med `scripts/record-opencode-contract.cjs` i trin 1. Optageren har lavet dem alle om til dette format. I feltet `aura` betyder `+ændringer`, at `desktop/core` havde ucommittede ændringer under optagelsen.

En ny optagelse af alle sæt med optageren gav de samme former, den samme rækkefølge og de samme udfald. Forskellene var portnumre, proces-id'er og to forventede ting:

- `spoerg-alt` sluttede med `idle`, fordi optageren besvarer spørgsmålet.
- Trinnet `grep-tool-output` i `byg-git-soeg` spurgte kun om søgningen. I designfasens optagelse fandtes motorens tool-output-mappe endnu ikke. OpenCode behandlede derfor stien som en fil og spurgte også om forældermappen. Findes mappen, gælder OpenCodes faste tilladelse til tool-output.

## Pladsholdere

Stier fra optagemaskinen er skiftet ud med pladsholdere. `${X:rel/}` er samme sti uden foranstillet skråstreg; OpenCode bruger den form til filændringer uden Git.

- **Forløb:** `INDEX.json` → `tokens` forklarer `ROOT`, `WORKSPACE`, `OUTSIDE`, `REPO`, `STORE`, `SCRATCH`, `RUNTIME`, `SYSTMP` og nøglerne.
- **De øvrige sæt:** Feltet `pladsholdere` i hver fil forklarer dem. Motorens HOME er altid `<motorens mappe>/home`.
- **Rester**, som en afkortet sti i et værktøjssvar, er erstattet med `<sti fra optagemaskinen>`. Brugernavnet er erstattet med `<bruger>`, også når et afkortet værktøjssvar slutter midt i navnet (de første 3 tegn eller flere).
- **Optageren stopper**, hvis der stadig er hjemmemappe, brugernavn, begyndelsen af brugernavnet sidst i en tekst, temp-mapper eller appens egen mappe i resultatet.

## Målte fakta om OpenCode 1.18.33

Alle er kørt mod den rigtige motor på macOS. Kontrakttestens del 1 har en påstand for hvert punkt.

1. **Gentagelsesvagten afvist med en besked stopper opgaven.** Det giver `session.error` efter ét modelkald, også med `experimental.continue_loop_on_deny: true` (`gentagelse/afvist-med-besked.json`). Ingen af de tre ens læsninger bliver gennemført; de afbrydes (`Tool execution aborted`). Uden flaget sker det samme (`politik/uden-sandkasse.json`). Med `once` fortsætter opgaven (`gentagelse/once.json`). Derfor skal Aura besvare gentagelsesvagten med "én gang" og aldrig afvise den (beslutning 9, milepælens trin 3c).
2. **Afviser Aura én forespørgsel, afviser OpenCode selv de andre ventende i sessionen, uden besked.**
   - I `gentagelse/once.json` afviste Aura kun webfetch. Den tilbageholdte `echo a`, der ventede ved afvisningen (`ventedeVedAfvisning: true`), blev afvist af OpenCode, før Aura svarede (`sendt: null`, `svar: reject`). Trinnet efter kørte alligevel, fordi flaget var slået til (4 modelkald).
   - Uden flaget stopper den samme kaskade opgaven: `gentagelse/uden-flag.json` slutter i `session.idle` efter 2 modelkald, og `echo efter` kører aldrig. Afvisningen uden besked er det, der stopper.
   - OpenCode har modtaget flaget: det står i den effektive konfiguration (`experimental` i `once.json` og `afvist-med-besked.json`).
   - En enkelt kommando, afvist med en besked, giver en værktøjsfejl med beskeden. Opgaven fortsætter også uden flaget (`politik/uden-sandkasse.json`, `npm i -g serve` og `cat ~/.ssh/id_rsa`).
3. **Bash ser ens ud med og uden `config.shell`.** De samme fem kommandoer gav præcis de samme forespørgsler (`skal/config-shell.json` og `skal/uden-skal.json`).
   - `metadata` er `{command}` med den oprindelige kommando.
   - `patterns` er delt pr. delkommando, og `always` er præfikser som `"npm run build *"`.
   - Skallen kaldes som `[-c] [<oprindelig kommando>]`, 5 af 5 gange.
   - OpenCodes egen mappekontrol virker: `cd .. && pwd` og en arbejdsmappe uden for projektet spørger først om mappen og så om kommandoen i samme callID.
   - Kommandoforespørgslen har aldrig arbejdsmappen.
4. **`~` er motorens HOME, ikke brugerens.** `cat ~/.ssh/id_rsa` giver en mappeforespørgsel for `${RUNTIME}/home/.ssh` (`skal`) og `${APPDATA}/runtime/noegle/home/.ssh` (`politik`). Aura må ikke bruge OpenCodes `directories` for en `~`-sti, når kommandoerne får en anden HOME end motoren.
5. **Omdirigeringer opdages ikke.** `echo x > ../fil` og `echo x > <udenfor>/ud.txt` gav kun kommandoforespørgslen, og filen blev skrevet uden for projektet (`skal`, `politik`, forløbenes `bash-redirect-tmp`).
6. **Formerne:**

   | Form | patterns / always | metadata |
   |---|---|---|
   | Mappeadgang fra fil-, søge- og læseværktøjer | `["<mappe>/*"]` / samme | `{filepath, parentDir}`. `parentDir` er filens mappe eller mappen selv; en sti, der ikke findes, behandles som en fil |
   | Mappeadgang fra en kommando | `directories` + `/*` / samme | `{command, directories, patterns}` |
   | Filændring (write, edit) | `[relativ til worktree]` / `["*"]` | `{filepath (absolut), diff}` |
   | Filændring (apply_patch) | én relativ sti pr. fil / `["*"]` | `{filepath: "a, b", files[{filePath, relativePath, …}]}` |
   | Søgning (grep) | `[søgeordet]` / `["*"]` | `{pattern, path?, include?}`. Værktøjets input er altid "pending" |
   | Kommando | én pr. delkommando / præfikser | `{command}` |
   | Webfetch | `[url]` / `["*"]` | `{url, format, timeout?}` |
   | Gentagelsesvagten | `[værktøj]` / samme | `{tool, input}` uden `tool`-felt og dermed uden callID |
   | skill, todowrite (kun når de står til 'ask') | `[navn]` eller `["*"]` | `{}` |

   Worktree er projektet i Git, `/` uden Git og i en samtalekopi, og repo-roden for et projekt inde i en Git-rod.
7. **Rækkefølgen:**
   - En filændring uden for projektet spørger først om mappen, mens værktøjets input endnu er tomt, og så om filen.
   - Søgning uden for projektet spørger først om søgningen og så om mappen.
   - Læsning og `glob` uden for projektet spørger kun om mappen.
   - En kommando spørger først om mappen og så om kommandoen.
   - Forespørgsler fra samme værktøjskald har samme callID.
8. **Et projekt inde i en større Git-rod.** OpenCode spørger aldrig om mappeadgang inden for roden. Læsning i en søskendemappe sker uden forespørgsel, og en filændring dér har mønsteret `andet-projekt/fil.txt` (forløbet `git-foraelder`).
9. **HEADs sandkasse** omskriver kommandoen i `tool.execute.before`, før OpenCode spørger. Det er Auras opsætning på `d816a9e`, ikke OpenCodes.
   - Forespørgslen viser kun `exec /usr/bin/env -i … '${PAYLOAD}'` med `always: ["exec *"]`.
   - `cd .. && ls` gav ingen mappeforespørgsel (`politik/sandkasse.json`).
   - Sættet optages igen efter milepælens trin 6a, og påstanden skrives om.
10. **Gentagelsesvagten i Planlæg og Samtale** rammer Auras `'*': 'deny'` efter OpenCodes `doom_loop: ask`. Opgaven stopper med `session.error` uden at spørge (forløbet `plan-git`). I Byg spørges der. Det er Auras opsætning på `d816a9e`: trin 3c giver Planlæg og Samtale `doom_loop: 'ask'`, så `plan-git` ender i `idle` med en `doom_loop`-forespørgsel ved næste optagelse, og påstanden skrives om.
11. **OpenCode afgør "inde" og "ude" ud fra stien, ikke det faktiske mål.** Et link i projektet til en mappe udenfor gav ingen mappeforespørgsel. Skrivning, læsning, søgning og `glob` gennem linket gik igennem (`direkte/symlink.json`).
12. **Mønsterregler** (`direkte/regler-git.json`, `direkte/regler-uden-git.json`):
    - I Git virker en relativ regel som `public/*`, men ikke en absolut sti eller en sti uden foranstillet skråstreg.
    - Uden Git virker kun den absolutte sti uden skråstreg og `*/projekt/mappe/*`.
    - `npm run build*` tillader også `npm run buildx`.
    - `<mappe>/*` dækker undermapper.
13. **Mapper** (`direkte/mapper.json`, `direkte/skills-sti.json`):
    - `OPENCODE_DB` i projektets `.aura/opencode` virker.
    - Bun pakker et bibliotek på knap 5 MB ud i `TMPDIR` ved første værktøjskald.
    - `skills.paths` finder både `.aura/skills` og en absolut mappe.

Ikke en påstand i del 1, men værd at vide: søgning med grep returnerer indholdet af `.env` i projektet (forløbet `byg-git-soeg`, trinnet `grep-hemmelighed`). Det er Auras opsætning på `d816a9e` og rettes i trin 3b.

## Forbehold

- **De fire første direkte forsøg** (`regler-git`, `regler-uden-git`, `skills-sti` og `mapper`) kørte uden `writePluginRuntime`. OpenCode hentede derfor `@opencode-ai/plugin` fra npm-registret (kritikkens K3). Det ses i `mapper.json` under `files` (`home/.npm/_cacache`). Optageren kalder nu `writePluginRuntime` før start og stopper, hvis en kørsel har lagt noget i en `_cacache`-mappe.
- **`spoerg-alt`** sluttede med timeout, fordi spørgsmålet ikke blev besvaret. Optageren besvarer nu spørgsmål.
- **Alle søgninger** brugte udviklerens `rg` i PATH (kritikkens K4). Uden `rg` henter OpenCode selv ripgrep fra GitHub; derfor stopper optageren, hvis `rg` mangler.
- **Kaskaden rammer formentlig kun de forespørgsler, der venter**, når Aura afviser. I en optagelse under høj belastning afviste OpenCode ikke `echo a`; optageren besvarede den, og den kørte. Ifølge forespørgslernes id'er kom den 426 ms efter webfetch, sandsynligvis efter afvisningen, der sendes 300 ms efter. Den optagelse er ikke lagt ind. Optageren afviser nu først webfetch, når kommandoen også venter, og gemmer det som `ventedeVedAfvisning`.
- **Designfasens gentagelsesoptagelse** (kritikkens `doom-fortsaet.cjs`) er erstattet af optagerens. Det gamle script prøvede at svare `once` på den tilbageholdte kommando efter OpenCodes afvisning, men gemte ikke udfaldet, så dets `sendt: null` var rekonstrueret. Optageren svarer kun, hvis OpenCode ikke selv har svaret, og gemmer det, den sendte.
- **Kun macOS** er optaget. Windows og Linux er ikke optaget.
- **Forløbenes `recordedAura`** er Auras afgørelse på `d816a9e`. Den ændres, når godkendelserne ændres, og så optages forløbene igen.

## Sådan optages der igen

Optageren køres kun manuelt og lokalt, aldrig i CI og aldrig af `npm test`. Den bruger den låste OpenCode fra `npm run runtime:prepare`, kræver `rg` i PATH og lægger Buns udpakkede bibliotek i sin egen arbejdsmappe.

```
cd desktop
node scripts/record-opencode-contract.cjs
```

- Uden argumenter optages alle sæt, og deres filer i `tests/fixtures/opencode-<VERSION>/` erstattes. Til sidst køres kontrakttestens del 1 på resultatet.
- Et enkelt sæt eller navn: `node scripts/record-opencode-contract.cjs skal` eller `node scripts/record-opencode-contract.cjs forloeb/plan-git`.
- Til en anden mappe: `--ud <mappe>`. Testen kan køres mod den med `AURA_OPENCODE_FIXTURES=<mappe> node --test tests/opencode-contract.test.cjs`.
- Behold de rå optagelser: `--arbejde <mappe>` (eller `--behold`). Lav fixtures om fra rå optagelser uden at starte OpenCode: `--fra <mappe>`.

**Når OpenCode opdateres,** fejler del 1 med "Der er ingen optagelser for OpenCode …".

1. Optag alle sæt.
2. Sammenlign den nye mappe med den gamle.
3. Ret kontrakten, hvis en form har ændret sig.
4. Fjern den gamle mappe.

**Når Workbench, ChatSession eller godkendelserne ændres,** skal optagerens forløbsdel følge med. Tre påstande i del 1 beskriver Auras opsætning på `d816a9e`. De fejler, når sættene optages igen efter disse trin, og fejlbeskeden peger hertil:

- **Trin 3c** (`doom_loop: 'ask'` i Planlæg og Samtale, `permissions()` i `core/engine.cjs`): `plan-git` ender i `idle`. Skriv påstanden "Auras opsætning på d816a9e: gentagelsesvagten i Planlæg …" og punkt 10 om.
- **Trin 3d** (`experimental.continue_loop_on_deny` i `engineConfig`): `politik/uden-sandkasse.json` optages med flaget. Skriv påstandene om afvisning uden flaget om. `gentagelse/uden-flag` fjerner selv flaget og påvirkes ikke.
- **Trin 6a** (indpakningsskallen): `politik/sandkasse.json` viser den oprindelige kommando. Skriv påstanden "Auras opsætning på d816a9e: HEADs sandkasse …" og punkt 9 om.

Desuden ændrer `projectKey` i trin 4 forløbenes stier, og `allowed()` i trin 7 ændrer `recordedAura`.
