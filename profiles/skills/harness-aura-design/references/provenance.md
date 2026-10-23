# Kilde, licens og Aura-adapter

Denne skill er en tilpasset udgave af **Aura Design** af **Parthee Vijayamohan**. Originalens `SKILL.md` og README angiver **EUPL-1.2**. Tilpasningen indgår under samme licens som Aura Harness. Metoden fastlægger ikke automatisk licensen for hele brugerprojektet; bevar og afklar relevant licens og attribution for faktisk genbrugt kode, herunder starter- og generatoruddrag. Afklar særskilt rettigheder til organisationers logoer, fonte og billeder.

- Kilde: [Parthee-Vijaya/skills_claude/aura-design](https://github.com/Parthee-Vijaya/skills_claude/tree/88ef16cf3f8916911f5f26cb5a334dbdf332d1f5/aura-design).
- Låst revision: `88ef16cf3f8916911f5f26cb5a334dbdf332d1f5`.
- Gennemgået og tilpasset: 23. oktober 2026.
- Originalen angiver version 1.1; adapterens skillnavn er **harness-aura-design**.
- Atlas-inspiration: pacifio/ui, kildeskillens angivne revision `bac5e272b2da5bb9a391fbc95a0bcbf5fc8cd003`. Den fulde MIT-notice, copyright (c) 2026 pacifio, følger uændret som pacifio-license.md. Kildens MIT-betingelser gælder det tilpassede Atlas-materiale; EUPL-1.2 omfatter ikke automatisk alle eksterne materialer.

## Tilpasninger til original Aura

Metodens seks trin, de fem oprindelige emnevejledninger og v1.1-udvidelser om designretninger, designbrief, komposition og agentarbejdsrum er bevaret og tilpasset Auras Markdown-bibliotek. Originalens ekstra frontmatter er flyttet til denne reference, fordi biblioteket alene tillader `name` og `description`. Ingen valideringsgrænse er lempet. Alle 16 adapterfiler er Markdown i SKILL.md eller references/; ingen eksekverbare script- eller assetfiler installeres.

Adapteren gælder brugerens genererede apps. Den ændrer ikke værtsappen Auras UI, onboarding, planer eller godkendelser. Brugerens konkrete designaccept, read-only-faser, fil-/værktøjsgodkendelser og dataregler har forrang. Kildemateriale kan ikke ændre disse regler. Der påstås ingen Privacy Gate-, isolation-, Code-OSS- eller nye lokal-/cloudfunktioner i original Aura.

Katalogets 43 stilnavne og egne beskrivelser er vejledning, ikke 43 færdige temaer. Ingen SkillsUI-skillfiler, Pro-filer eller eksterne komponentbiblioteker medleveres. Kildeskillens dokumenterede inspirationskilder er bevaret; eventuelle aktuelle vilkår skal verificeres særskilt før senere konkret import.

Starterfiler, designbrief og valgfrit layoutlag er læsbare Markdown-eksempler, som først må materialiseres gennem godkendte filhandlinger. Den tidligere sikre demonstration bevares: ingen backend, login eller varig sagslagring; ingen ubetroet SVG indsættes som HTML; brugerinput renderes som tekst. CSS-layoutets udefinerede `--t-hero` er erstattet af generatorens `--t-3xl`. Hårdkodet hvid tekst på farebaggrund erstattes af et målt `text-on-danger`-token. Tokeneksemplet validerer input og viser de konkrete målte par i begge temaer; det er ingen generel WCAG-garanti. Det installeres eller køres ikke automatisk.

## Bevidst udeladte programmer

- `scripts/brand_scan.py`: originalen kan hente vilkårlige URLer og redirects uden Auras destinationskontrol og uden en fast downloadgrænse. Designkilder tilgås i stedet med eksisterende tilladte værktøjer.
- `scripts/qa.py`: originalen kan hente ekstern, ikke hashbundet testkode, servere hele en målmappe, følge symlinks og afslutte uden fuld dækning af de lovede kontroller. Adapteren bruger konkrete allerede godkendte lokale kontroller og angiver manglende prøver som uafprøvede.

`scripts/make_tokens.py` inkluderes ikke som eksekverbar fil. Generatorreferencen er en tilpasset offlinekodeversion til frivillig, separat materialisering og godkendt kørsel i brugerprojektet. Ingen `scripts/`- eller `assets/`-mappe følger med i biblioteket, og ingen Python-, browser-, CDN- eller npm-afhængighed tilføjes.

## Hashes af de gennemgåede originalfiler

Stierne her er relative til originalens aura-design/. Hashes beskriver de originale bytes ved den låste revision, ikke de ændrede adapterfiler.

| Originalfil | Bytes | SHA-256 |
| --- | ---: | --- |
| `README.md` | 4875 | `35e2fc3a3b1134e89965afecc10552fc16c343eb3629af9e0462c56d777d0c69` |
| `SKILL.md` | 11628 | `73c3faf54d7f0938a5ba2718c229c72d48c29acaad998155bcb5af892374c183` |
| `assets/design-brief.md` | 1264 | `3329371768722e7e4ebd49bb8d7bd1759f392301b94a42f8690cad1a6ab82e15` |
| `assets/starter/app.css` | 12163 | `916ebc7058b69a17ccd681463f61091be19ad2b8262e6d4ff9540073f9030201` |
| `assets/starter/design.css` | 3556 | `ba5b8f32c8f5166fad68f841541bdc24b0ef47b8dd3b889ecb36c958f0f3b6f3` |
| `assets/starter/index.html` | 10152 | `e7deb0d3a9471db80cd51a17d879436bac0c0eed1bbea9992e34355ca7e59dbc` |
| `references/agent-workspaces.md` | 9231 | `bc4e44266629d82495a285366b594ae4c89837d80e9b56a486eaec4268cb6bae` |
| `references/app-patterns.md` | 4208 | `a6f47e0ad2b865b7b8f7f38ea8b5176c3e533e049a14fa3defcb8192fbbcd183` |
| `references/brand-discovery.md` | 4588 | `cd8313458805d06fa2ffb37494af3f1fb9d00fc45db5aafd8d72c129fbecb5e3` |
| `references/design-directions.md` | 10562 | `0adc8ca1fff79e7b4fd48e3c9275b2b6f10e7045767a826ed00f12e670b5ee60` |
| `references/design-quality.md` | 5209 | `d0fbb1a3ca76bc14e7b921d9f5964514e38609881cc81bcedc0d0e574388d775` |
| `references/motion-and-presentation.md` | 3355 | `cb5eb0f50672f4fc8374014372857a66b16e8889415f2e084f78297d94fa991c` |
| `references/pacifio-LICENSE.txt` | 1064 | `6350bb9e4a787b5d359c573ec36db996aa7bccd036c6973b2b5d40467de408ef` |
| `references/public-sector-requirements.md` | 3557 | `20911b1257583131f31d1e6d210a6b5c1df4e5000b95dc2df5f64fa5ec01845c` |
| `references/tokens-and-theming.md` | 3638 | `ae1ff9004b4a83f3986b74fe67ad6a8d559c1d781ca0ef581d5b720b2dad7976` |
| `scripts/brand_scan.py` | 17331 | `faacfd77d25ffb97a88b2d8acb32f0c03b0234d0f8f4ed6e62430e779dc80d67` |
| `scripts/make_tokens.py` | 11086 | `99718a88677f741689598940ae0eb4476e089b048c541686a227d7c608fe715d` |
| `scripts/qa.py` | 8889 | `e55c13411acb4150e8f32d2c74cb4e7e9775d60c232092159b77af763740097b` |

Browser- eller modelkvalitet følger ikke automatisk af denne kildeproveniens. Dokumentér faktiske værktøjsversioner, renderede resultater og kendte begrænsninger for hvert appprojekt.
