# Komposition og visuel kvalitet

Denne reference gælder kun brugerens genererede app og kun inden for den konkret godkendte opgave. Den ændrer ikke værtsappen Aura, dens onboarding, planer eller godkendelser.


Læs efter brand discovery sammen med designretningen. Et teknisk gyldigt skærmbillede er udgangspunktet; slutresultatet skal hjælpe en konkret bruger og have en tydelig afsender.

## Form skærmen efter opgaven

1. Skriv den vigtigste brugeropgave og næste handling. Gør det tydeligt: Hvor er jeg? Hvad kan jeg gøre? Hvad sker der bagefter?
2. Fordel plads mellem navigation, opgaveoverskrift, hovedindhold og hjælp. Giv hovedopgaven mest vægt; undgå en stor marketinghero foran en daglig arbejdsopgave.
3. Brug kort til indhold med sin egen enhed/handling. Brug rækker, lister, sektioner og linjer til sammenhængende indhold. Hver flade skal have et formål.
4. Prioritér efter betydning, ikke efter tomme pladser i en skabelon. Færre KPI'er med en klar beslutning er bedre end et stort gitter uden formål.
5. Vælg ét særkende, brandet tillader: et eksisterende farvebånd, typografisk detalje, sektionsrytme eller relevant diagram. Kopiér ikke inspirationssidens produktidentitet.

## Rytme, typografi og tæthed

- Definér titel, sektionsoverskrift, brødtekst, label og hjælp én gang med tokens; tilpas ikke størrelser enkeltvis for at fylde huller.
- Brug mindre afstand inden for grupper end mellem dem. Align tekst, felter og handlinger til få fælles linjer.
- Behold mindst 16px brødtekst og fluid displaytype. Gør ikke vigtige labels til bittesmå versaler for at efterligne en stil.
- Vælg tæthed efter opgaven. En eksperttabel kan være tættere end en vejledning, men klikflader og læsbarhed består. Luft skal hjælpe scanning uden at gøre et enkelt flow unødigt langt.
- Brug tabular-nums og ens enheder til sammenligninger. Tilføj kun diagrammer, der besvarer et reelt spørgsmål.
- Brug ét sammenhængende, bundtet ikonsæt. Ikoner supplerer labels; vigtig betjening må ikke kun forklares ved hover.

## Tilpas kompositionen

| Leverance | Prioritering | Undgå |
|---|---|---|
| Arbejdsapp | Overskrift/handling → filtre → opgave → hjælp | Stor intro, dekorative KPI'er, et kort om hvert felt. |
| Dashboard | Spørgsmål/periode → vigtigste mål → sammenligning → detaljer | Pyntediagrammer, uens tidsskalaer, betydning kun i farve. |
| Landingsside | Konkret værdi → løsning i brug → dokumentation → næste skridt | Fiktive anmeldelser, generisk hero, samme kortgitter overalt. |
| Læseside | Titel/indledning → indhold → relevant navigation | Smal tekst klemt mellem stor pynt, displayfont på alle labels. |
| Slides | Én pointe → tydelig scene → kilde/noter | Små afsnit skaleret ned, animation som eneste forklaring. |

## Adfærd er en del af finish

- Design default, hover, fokus, aktiv, valgt, disabled, loading og fejl. Fokus skal være tydeligt og ikke skjules af sticky elementer.
- Beskriv klik, ventetid, afbrydelse og fejl. Bevar input ved fejl og giv en konkret vej videre. Dekoration må ikke simulere aktivitet.
- Behold de fire visningstilstande fra app-patterns.md. Stress indholdet med nul, ét og mange resultater, lange danske ord og fejl på flere linjer.
- Ved AI: saml prompt, datagrænse og primær handling. Hold resultat, kilder, stop og avancerede muligheder forståelige. Påstå kun lokal/EU-behandling, når det er verificeret.

## Responsivitet og tilgængelighed

- Definér mobilrækkefølgen først. DOM-rækkefølgen er læse-/fokusrækkefølge; undgå dense grid eller CSS order, som skjuler en forkert struktur.
- Kontrollér 320px, QA-bredderne og 200 % zoom. Ingen skjulte handlinger eller afskåret tekst. Tabeller kan have en forklaret, fokuserbar scrollregion.
- Test understøttede temaer med hover, fejl, fokus og langt indhold. Stilvalg ændrer aldrig automatisk brugerens temavalg.
- Reduced motion: indhold, status og navigation virker uden animation. Forced colors: kontroller og valgt/fokuseret tilstand forsvinder ikke med baggrunde og skygger.
- Mål nye farvepar på faktiske flader. At to farver er tokens gør dem ikke automatisk egnede sammen; fx er muted tekst ikke nødvendigvis sikker på en primærfarvet flade.

## Kvalitetsport før aflevering

Se screenshots i fuld størrelse og ved siden af den officielle afsenderreference. Notér konkrete observationer i `qa/design-review.md`; skriv ikke bare "ser godt ud".

| Kontrol | Bestået når |
|---|---|
| Identitet | Logo, palette, fonte og former kan føres tilbage til BRAND.md; fravalg forklares. |
| Hierarki | Hovedopgave/handling er tydelig; hjælp konkurrerer ikke med den. |
| Komposition | Grupper, alignments og afstandsskala hænger sammen; flader har et formål. |
| Typografi | Hierarkiet gentages, og tekst/tal/labels kan læses i relevante visninger. |
| Interaktion | Kontroltilstande og alle fire visningstilstande virker med tastatur og mus/touch. |
| Robusthed | Langt indhold, mobil, zoom, tema og reduced motion bevarer indhold og funktion. |
| Særkende | Designet har en konkret relation til afsenderen og opgaven. |

Ret konkrete svagheder inden for den godkendte opgave og forklar uafklarede punkter. Ændring af en allerede godkendt designretning kræver konkret accept. Dette er en manuel vurdering, ikke en automatisk score eller juridisk godkendelse. Rapportér kun faktisk kørt QA; der medfølger intet installeret qa.py-script.
