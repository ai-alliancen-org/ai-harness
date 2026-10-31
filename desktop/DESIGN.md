# Lys præcision

Designretning for Aura. Arbejdsområdet skal give plads til samtalen og det, brugeren bygger. Det er en app til at arbejde i, ikke en præsentation af alle funktionerne.

## Få valg

Aura skal kunne bruges af en person uden teknisk baggrund, som klikker sig igennem opsætningen uden at gå i stå. Det gælder appen, webguiden og installationerne.

- **Ét spørgsmål pr. skærm.** Overskriften er spørgsmålet, fx "Hvilket kodeværktøj bruger du?".
- **Få, store valg.** Ét eller to hovedvalg, højst tre til fire synlige. Når vi anbefaler et valg, står det først og er markeret som anbefalet. Spørger vi om noget, brugeren allerede har, fx sit kodeværktøj, vises de mest udbredte først.
- **Resten bag ét link.** Fx "Et andet værktøj" eller "Bruger du en anden udbyder? Vælg en anden". Lange lister får søgning.
- **Et klik fører videre,** når valget er entydigt. Der skal ikke også trykkes Næste.
- **Resumé først, detaljer bagefter.** Sig i almindeligt dansk, hvad der sker. Filstier, modelnavne med versionsnumre, priser pr. token og konfiguration ligger bag "Se detaljer".
- **Knappen siger, hvad der sker.** Skriv "Installer resten" frem for et afkrydsningsfelt og en generel knap.
- **Én næste handling.** Når noget er færdigt, vises det vigtigste næste skridt; andre handlinger er sekundære.

Eksempler i appen: AI-adgang har to store valg. Udbyderoversigten viser fire lige store kort med et lille logo og forbindelsesstatus, Claude, Mistral, Corti og Alexandra, og resten ligger bag "Bruger du en anden udbyder? Vælg en anden". Ingen udbyder eller model anbefales. Kun det valgte kort åbner en formular. Modellen er udbyderens eget udgangspunkt, valgt på forhånd; modelknappen viser det, to alternativer og "Alle modeller". En filgodkendelse viser Tillad én gang, Tillad altid i projektet og Afvis; tilladelse til resten af opgaven ligger under Flere valg. Funktioner ved første start har to kort, Hele pakken (anbefalet) og Vælg selv. Kodeværktøj har fire kort og "Et andet værktøj".

Tæl de synlige valg, før en skærm kaldes færdig, og gennemfør forløbet i appen.

Dialogens tilgængelige navn skal bruge den overskrift, der faktisk vises i det aktuelle trin. Kontakter har deres eget navn, også når rækken indeholder en ⓘ-knap. Ved lukning skal fokus lande på en synlig åbner; en skjult menuhandling er ikke et brugbart returpunkt. Første lag i Før du sender forklarer tidligere beskeder i den fortsatte AI-session. Et tilvalg af en ekstra historikkopi må ikke ligne en kontakt til at slå den eksisterende session fra. Uden gemt AI-forbindelse skal Vælg AI føre direkte til forbindelsesguiden.

## Det, man møder

- Første skærm spørger, om man vil bygge i appen eller bruge Aura Harness i sit eget kodeværktøj.
- Den guidede opstart viser ét spørgsmål ad gangen med stor overskrift og to eller tre store valg. Først vælger man adgangsnøgle eller AI på computeren; en gemt forbindelse bliver et tredje valg. Adgangsnøgle fører til fire udbyderkort, Claude, Mistral, Corti og Alexandra, og "Bruger du en anden udbyder? Vælg en anden". **Indtast nøgle** vises først, når en udbyder er valgt. Nøglen skrives i et eget vindue, aldrig i hovedvinduet; formularen viser kun, om der er gemt en nøgle. Ollama og Egen server har også **Gem uden nøgle**, og en gemt forbindelse har **Indtast ny nøgle**. "Har du ikke en nøgle? Sådan får du en" viser konto, betaling, månedlig grænse og nøgle som nummererede trin med en knap til hver side hos udbyderen. Sidepanelet er skjult under introduktionen. Til højre står et roligt statuspanel, **Din opsætning**, med den valgte udbyder og de tre led: din computer, forbindelsen og modellen. Det henter aldrig noget selv og viser kun det, appen allerede ved. Grønt bruges kun, når en kontrol af netop den forbindelse faktisk er lykkedes; en udbyder, musen hviler på, står som forhåndsvisning. Panelet står ikke i Din AI, hvor modellen vælges.
- Efter AI-trinnet spørger den guidede opstart én gang: "Hvad skal Aura hjælpe med?".
  - Der er to store valg. Hele pakken står først og er markeret Anbefalet; det andet er Vælg selv.
  - Vælg selv viser de seks funktioner som kontakter, der starter slået fra. Knappen siger, hvad der sker, fx "Fortsæt med 2 funktioner".
  - Én linje nævner det, der altid er slået til.
- Indstillinger › Funktioner viser én kontakt pr. funktion med én linje forklaring.
  - Skills og "Altid slået til" er foldet sammen.
  - Med et projekt åbent vælger man Alle projekter eller Kun projektet. En undtagelse står under funktionen med Brug standarden.
  - En slået fra funktion skjuler sine knapper, fx Sikkerhedskopi, Gem version eller designvalgene. Den sletter intet.
  - Under overskriften Integrationer står én kontakt pr. system, fx CVR. Integrationer er slået fra, til man vælger dem. Deres ⓘ viser system, ejer, adgang, data, dataflow, pris og kontroldato. Ved første start vises kun de almindelige funktioner.
- "Hvad vil du bygge?" viser idé, projektnavn og Opret og fortsæt. Projektet gemmes i Dokumenter › Aura uden mappedialog; "Vælg en anden placering" er et link.
  - Idéen bliver en redigerbar kladde i **Byg**, og ét kort stiller ét spørgsmål: **Planlæg først (anbefalet)** eller **Byg med det samme**. Svares der ikke, bliver kladden i Byg. Første afsendelse går gennem det almindelige modelsamtykke. En ekstra samtale oprettet med projektets + starter i **Samtale**.
  - Flere valg er én flad liste med AI, udgivelse, tests og design, hver med ⓘ. Farve, logo og inspiration ligger ét lag længere nede.
  - De seneste valg huskes til næste projekt uden afkrydsning. "Glem dem" nulstiller dem.
- Aura Harness i dit kodeværktøj viser fire kort og "Et andet værktøj" med søgning. Et klik fører videre til mappevalget og derefter til et resumé i almindeligt dansk; de præcise filændringer ligger under Se de præcise ændringer.
  - Under Tilpas er integrationerne en kategori for sig og ikke valgt på forhånd. De tælles for sig, fx "9 af 12 skills valgt og 1 integration", og står aldrig som fravalgte. Vælg alle skills vælger ikke integrationer.
- Næste trin viser kun det valgte forløb. Nøglehjælp og tekniske oplysninger er foldet sammen. GitHub og lokale værktøjer ligger under Avanceret opsætning. Tilbage og Vælg senere er altid tilgængelige.
- Sidepanelet indeholder projekter, Nyt projekt, Åbn projekt, Søg i samtaler og Indstillinger. Den installerede version står med lille tekst under navnet. Søgningen sker kun i de gemte samtaler på computeren, og et træf åbner beskeden uden at sende den til AI'en. Indstillinger har AI-forbindelser, Funktioner, Opdateringer og Hjælp og feedback.
- Opdateringer viser version og status med én næste handling: Søg, Hent eller Genstart og opdatér. Automatisk søgning kan slås fra under Indstillinger i dialogen. En ny version vises med en diskret linje over arbejdsområdet. En kritisk rettelse giver en vedvarende advarsel, men blokerer ikke arbejdet. Genstart venter på igangværende opgaver og gemmer kladden først.
- AI-forbindelser er en liste med Rediger på hver forbindelse. Tilføj forbindelse går gennem den guidede opsætning med de fire udbyderkort. Rediger viser formularen med Kontrollér adgang og Fjern forbindelse.
- Arbejdsområdet består af samtalen og en arbejdsflade med en flytbar skillelinje. Arbejdsfladen har fem faner: Forhåndsvisning, Plan, Ændringer, Kode og Aktivitet. Forhåndsvisning er udgangspunktet.
  - Kun brugeren skifter fane. AI'ens hændelser giver Ændringer et tal og Aktivitet en prik, men flytter ikke brugeren. Nyt indhold i en åben fane vises først, når brugeren vælger det, fx med Vis dem.
  - Faneskift bevarer previewets formularer og rulning, filvalget, rulningen i de andre faner og beskedkladden.
  - Ændringer viser først et resumé med sammenligningsgrundlaget og derefter en linje-diff. Hver fil siger, om AI'en, AI'en og andre, en kommando eller brugeren ændrede den. Brugerens egne ændringer må aldrig stå som AI'ens.
  - Kode er skrivebeskyttet og viser kode som tekst. Beskyttede filer vises ikke. Filhenvisninger til AI'en står i skrivefeltet og i Før du sender.
  - Aktivitet viser kun faktiske hændelser med klokkeslæt og status i ord. Ingen simuleret terminal og ingen opdigtede testresultater.
  - Sidepanelet kan foldes sammen til ikoner. Ved 980 × 720 står fanerne på én linje; med større tekst må de bryde, men aldrig forsvinde. Et mærke på en fane ligger oven på hjørnet, så fanerne ikke flytter sig.
- Skrivefeltet er den vigtigste handling. Under det står den aktive model, udbyder og indsats og samtalens tokens ind og ud med en anslået pris. Modelknappen viser udbyderens logo fra appens fælles logosæt, også på modelkortene, og åbner et lille modelvalg ved skrivefeltet. Ved OpenRouter er det forbindelsens logo. Den viser højst tre modeller: for kendte udbydere udbyderens eget udgangspunkt og to alternativer med faktuelle forklaringer, ellers et udvalg. I det lille modelvalg vælger et klik modellen, så indsatsen kan vælges samme sted. Alle modeller og forbindelser åbner den fulde Din AI-dialog med Avanceret; dens modelkort vælger og lukker som før. Referencer vises kun, når projektet har referencefiler.
- Indsatsen er udbyderens standard, indtil brugeren selv vælger en, fx "Prøv igen med lav indsats" på fejlkortet. Kun de niveauer, den eksisterende modelregel tillader, kan vælges ved skrivefeltet. Ukendt støtte giver ingen niveauliste. En valgt indsats står under skrivefeltet og nulstilles under Din AI med "Brug udbyderens standard" eller ved skift af model.
- Når et svar stopper ved loftet uden tekst, forklarer fejlkortet det i én sætning og viser højst tre valg: lav indsats (når modellen tager imod den), "Gør samtalen kortere og prøv igen" (når samtalen har mere end én besked) og "Prøv igen". Intet sendes uden et klik.
- Før første afsendelse viser "Før du sender" fire linjer: AI, hvor, træning og pris.
  - Under dem står én linje om pris og data med ⓘ. Tidligere samtale nævnes kun, når den sendes med.
  - "Se alle oplysninger" er korte rækker, og lange tekster som appens vejledning og planen har hver sin fold.
  - Resuméet vises igen, når modtager, model, pris, vilkår eller valgte private referencer ændrer sig. Almindelig fortsættelse, interne filhenvisninger og skift mellem Samtale, Planlæg og Byg gentager ikke et allerede accepteret resumé.
- Første filændring i en opgave spørger, om AI'en må ændre filer i projektet, medmindre projektets Auto-godkend er slået til. "Tillad for denne opgave" gælder kun til opgaven slutter. Gemte tilladelser til en konkret kommando eller mappe kan ses og fjernes i projektindstillingerne. Valg af overordnet mappe viser omfanget før godkendelsen.
  - **Se ændringen** viser hele den foreslåede ændring, 400 linjer ad gangen med **Vis N linjer mere**, så alt kan læses, før der svares.
  - **Byg og kontrollér automatisk** tillader kun agentkommandoer, når Auras tekniske isolation faktisk er startet. Manglende understøttelse vises ved indstillingen; appen falder aldrig tilbage til automatisk kørsel uden isolation. Ændringer gælder næste opgave.
  - Et godkendelseskort siger Hvad, Hvorfor og Hvis du tillader i tre korte rækker. Ændringen og de tekniske detaljer er foldet sammen. AI'ens begrundelse er markeret som AI'ens, og et gæt om en kommando siger, at det er et gæt.
  - Afvis stopper opgaven. Afvis med en besked er et link under knapperne og lader AI'en fortsætte med brugerens besked.
- Én status: overskriften over samtalen siger kort, hvor opgaven er, og linjen under siger, hvad der sker, eller hvad AI'en venter på. Efter Stop, afvisning og fejl står vejen videre på resultatkortet; der er ingen ekstra advarselsboks eller rød linje ved siden af.
- AI-svar viser tabeller, kode og links. Et link viser sit værtsnavn i teksten og åbnes i standardbrowseren. Når svaret er færdigt, vises **Kopiér kode** ved kodeblokke og **Kopiér tekst** ved længere eller sammensatte svar. Løse adresser kan også klikkes.
- En gemt samtale åbner med de nyeste beskeder, højst 20 eller cirka 60.000 tegn. Ældre beskeder hentes med **Vis N tidligere beskeder** over samtalen. Det henter kun fra denne computer og starter ingen AI-opgave.
- Resultatkortet viser en kort kvittering, **Afprøv resultatet**, **Se ændringer**, **Markér som gennemgået** og **Flere valg**. At åbne Ændringer markerer ikke resultatet som gennemgået; det gør kun brugerens særskilte klik. Afprøv resultatet viser projektets preview. Hvis der ikke kører en forhåndsvisning, åbnes det eksisterende opstartsforløb med godkendelse; knappen starter ingen server automatisk. Kommandoer og kontrolresultater står i Aktivitet, ikke som lange lister i samtalen.
- Ekstra samtaler starter i **Samtale**. Et nyt projekts første idé står som en redigerbar kladde i **Byg** med ét spørgsmål om at planlægge først; afklaringen af idéen sker i Planlæg, ikke på oprettelsesskiltet, og der kontaktes ingen AI, før projektet findes. I Samtale kan AI'en læse projektet og svare, men hverken ændre filer eller køre kommandoer. En relevant anbefaling viser kun **Planlæg** og **Bliv i samtalen**. Planlæg forbereder en redigerbar besked; den sendes ikke automatisk. Et fravalg huskes i samtalen. Et almindeligt svar bliver aldrig alene til et byggekort. Indeholder svaret allerede de fire konkrete planafsnit, vises **Byg planen** i stedet for endnu et tilbud om planlægning, også efter genåbning.
- Fremdriften skelner mellem modellens forberedelse, svartekst og kode under modtagelse. Ræsonnement vises ikke som svartekst. **Følg arbejdet** åbner Aktivitet med faktiske delopgaver og et valgfrit kodeudkast, tydeligt mærket som endnu ikke gemt. En model uden disse signaler får den almindelige ventestatus; ingen fremdrift opfindes.
- Når filværktøjet har skrevet, opdateres Kode og Ændringer under opgaven. Projektets versionsstatus står ved projektmenuen. Historikken kan læses under arbejde; handlinger, der ændrer versioner eller filer, venter på opgaven.
- Planlægning fører til et konkret forslag. Brugeren vælger at bygge; efter bygning kan man fortsætte med rettelser.
  - Arbejdsmåderne hedder **Samtale**, **Planlæg** og **Byg**. Valgene åbnes direkte ved skrivefeltet med en kort forklaring. En eksisterende plan bevares ved valg af Byg. Byg er et almindeligt valg. En direkte brugerbesked som "byg" skifter til bygning før afsendelse; spørgsmål, citater og et nej gør ikke. Efter et byggeforslag uden genkendelige planafsnit kan **Byg videre** bruge den eksisterende samtale, uden at kalde forslaget en godkendt plan.
  - **Enter sender, Shift+Enter laver en ny linje.** ⌘Enter på Mac og Ctrl+Enter virker også. Alle går gennem samme forløb som Send, inklusive eventuelt modelsamtykke. Tastegentagelse og tekstkomposition må ikke sende to gange.
  - AI'ens spørgsmål vises ét ad gangen som store svarkort, højst fire synlige. AI'ens anbefaling står først og er markeret som AI'ens, ikke Auras. Eget svar står som et synligt tekstfelt, medmindre spørgsmålet udtrykkeligt kun tillader valgmuligheder. Fritekstkladden bevares ved flere valg og Tilbage. Tilbage og Spring over er links.
  - Chatkortet viser et kort resumé af bygning, design og afprøvning. Den fulde plan, redigering og teknikafsnittet ligger fortsat under Plan; intet indhold eller plan-id ændres af overblikket.
  - Projektbriefen indeholder kun brugerens egne ord: idé, ønsker og svar. Hver linje siger, hvor den kommer fra, og kan rettes.
  - Planen står under Plan i fire afsnit med teknik foldet sammen. Samtalen viser et kort med planens første linje og én primær handling: Byg. Planen kan rettes direkte eller af AI'en og genåbnes. En plan, der ikke må bygges, kan stadig læses.
- Nye projekter har versioner fra start. Efter hver AI-opgave gemmes en version, og resultatkortet tilbyder Fortryd opgaven. Historikken står under Ændringer › Versioner: "Alt er gemt" eller antallet af ugemte ændringer, én knap til Gem version og versionerne som rækker med et lille billede, et navn, typen og tiden. Én række er ét valg; de to veje tilbage står først, når en version er åbnet. Filvalg, branch og identitet ligger under Avanceret.
- Før og efter vises side om side, med samme side i samme størrelse. Mangler et billede, siger teksten det. Billederne er hjælp, ikke bevis for, at koden virker.
- Enhver gendannelse og fortrydelse har én gennemgang: billederne, et udfald pr. fil, dine ugemte ændringer og ét spørgsmål, hvis du og AI'en har rettet de samme linjer. Dine linjer er det anbefalede svar. Hvad der ellers berøres, er foldet sammen.
- **Fortryd opgaven** ligger under **Flere valg** på resultatkortet. Efter gendannelsen fjernes handlingen for den fortrudte opgave, og samtalen viser en kvittering med antal berørte filer og oplysning om versionsgemning. Kvitteringen får fokus.
- Appen åbner det projekt, der sidst var åbent. Et projekt, der er lukket med Nyt projekt, åbnes ikke igen.
- Sidepanelet viser de 12 senest åbnede projekter med deres samtaler; ældre projekter ligger bag "Vis alle N projekter". Kun det åbne projekt er foldet ud, og højst seks samtaler vises, før "Vis alle". En ny samtale startes med + ved projektet; sidepanelet har ingen særskilt Ny samtale øverst, så det første valg er Nyt projekt. En samtales status står under navnet med tekst og farvet prik: arbejder, venter på dig, nyt resultat eller afbrudt. Omdøb og slet ligger under •••.
- Flere samtaler og projekter kan arbejde samtidigt. Nyt projekt, Åbn projekt, AI-forbindelser, Funktioner, introduktion og Udgiv kan bruges imens. Ændrede indstillinger gælder næste opgave. Kun en handling, der faktisk ændrer de optagne filer eller uploader dem, venter og forklarer hvorfor.
- Et projekt er én fælles app. En opgave får en arbejdskopi, hvis projektmappen er optaget. **Arbejdskopi · Ikke flettet ind i appen** står over preview, og **Flet ind i projektet** er næste handling. Stien og udeladte filer er foldet sammen. Sidepanelet viser **klar til at flette**. Godkendelser og spørgsmål tilhører den samtale, der stillede dem. Udgiv viser, at projektets gemte version bruges, når brugeren ser en uflettet kopi.
- Indfletning bruger gennemgangen før Fortryd: projektet og kopien vises side om side, øvrige projektlinjer bevares, og dine linjer er anbefalet ved konflikt. Den venter kun på opgaver i projektet og kildekopien; en synlig linje forklarer ventetiden. Et samtaleskift bevarer previewets felter og rulning. En baggrundsopgave må hverken flytte den åbne fane eller kontrollere en anden samtales preview som sit eget resultat.
- Korte handlingsbeskeder har deres egen plads i den aktive skærm. De må ikke ligge oven på skrivefeltet, fanerne eller andre knapper.
- Kommandopaletten (⌘K) er valgfri og har ingen knap; den nævnes i Hjælp. Den viser kun handlinger, der findes og kan bruges lige nu, og uden søgning højst seks handlinger, fem samtaler og tre projekter.
- Eksempler på idéer ligger bag ét link under idéfeltet og vises kun, når feltet er tomt: tre faste eksempler, der kan bygges uden server.
- Projektmenuen indeholder versioner og sikkerhedskopi. Udgiv åbner valg af udgivelsessted og viser tydeligt, om destinationen er et testmiljø eller en offentlig hjemmeside. Udgiv er altid synlig; er Udgivelse slået fra, viser den ét trin, Slå udgivelse til. Sikkerhedskopi vises kun, når Udgivelse er slået til. Funktionen er ikke med i den anbefalede pakke, så længe udgivelse kræver udviklerværktøjer.
- Knappen, funktionen og forløbet hedder Udgiv og Udgivelse overalt. Del og deling bruges ikke om at lægge en app ud.
- Ret i siden er en frivillig til/fra-knap i forhåndsvisningens værktøjslinje. Kortet for et valgt element har højst to hovedvalg: Ret teksten og Bed AI'en ændre det. Kan Aura ikke rette selv, står grunden på kortet, og AI'en er det fremhævede valg. Tekst rettes i et felt i Aura, aldrig i selve siden, og Fortryd står ved resultatet. Et mål for AI'en står over skrivefeltet og i Før du sender, før det sendes.
- Preview viser skærmstørrelse og genindlæsning. Server, skalering og egne mål ligger i en menu. Hvis en framework-app mangler sin server, vises én handling i det tomme preview: Start forhåndsvisning. Installation og start gennemgås i en dialog; procesloggen er foldet sammen.

## Rolige skærme

Hver skærm og dialog følger samme mønster:
- **Én ting øverst:** ét spørgsmål eller én status i almindelige ord og én primær knap.
- **Højst én linje forklaring.** Resten ligger bag en ⓘ eller Se detaljer. Fagord som branch, commit, identitet, endpoint og token står kun under Avanceret.
- **Indstillinger som lister:** en kontakt eller en liste pr. række. Detaljer ligger på et lag længere nede, ikke foldet ud på samme skærm.
- **Det, der afgør beslutningen, er synligt:** Modtageren af data, prisen og handlinger, der ikke kan fortrydes, står altid som én kort linje. Tidligere samtale nævnes, når den sendes med.

ⓘ er en lille rund knap:
- Et klik åbner en boble ved knappen, og Escape eller et klik udenfor lukker den. Den åbner aldrig kun ved, at man holder musen over.
- Teksten står i knappens `data-info`, og knappen har et tilgængeligt navn, fx "Mere om pris".
- Inde i en dialog flyttes boblen ind i dialogen, så skærmlæsere kan nå den.

`npm run measure:screens` måler alle skærme med en kontrolleret model:
- synlige ord, valg, ⓘ og felter pr. skærm;
- klik pr. opgave;
- et skærmbillede af hver.

Kør målingen før og efter en ændring af en skærm, og sammenlign. Der er ingen fast grænse; tallene viser, om en skærm vokser.

## Hvad der vises hvornår

En indstilling skal have et sted, hvor den naturligt hører til. Den skal ikke gentages i navigation, status, formular og hjælpetekst på samme skærm.

Værktøjsaktivitet står under Aktivitet; samtalen viser én linje med antallet og Se Aktivitet. Spørgsmål, fejl og handlinger, der kræver godkendelse, vises på det tidspunkt, brugeren skal tage stilling. Tekniske detaljer kan åbnes. En kort resultatoversigt beskriver de faktiske ændringer; den er ikke et testbevis.

Datamodtagere, pris, behandlingssted og ukendte vilkår skal fortsat kunne vurderes før afsendelse. Forenklingen må ikke skjule en ændret modtager eller give adgang på brugerens vegne.

## Visuelle valg

- Aura-logoet i `docs/images/aura-icon.png` er fælles kilde til appen, introduktionen, websidernes favicon og installationsikonerne. Brug billedet uændret; et tastatursymbol eller et tegnet A erstatter ikke logoet. `npm run icons` i `desktop/` kopierer det til brugerfladen og pakningen.
- Baggrund: kølig hvid `#F8FAFC`. Flader: hvid `#FFFFFF`.
- Primær handling: kobolt `#0052CC`. Svag markering: `#E8F1FF`.
- Brødtekst: `#182235`. Sekundær tekst: `#58677D`. Skillelinjer: `#E0E7F0`.
- Systemskrift på macOS og Windows. Brødtekst i samtalen er 13 px med linjehøjde 1,75. Teksten skal kunne læses uden at åbne en større visning.
- Afstande tager udgangspunkt i 4, 8, 12, 16, 24 og 32 px. Formularfelter har 8 px runding, skrivefelt 14 px og dialoger 16 px.
- Ikoner er enkle stregikoner. Ikonknapper har tilgængeligt navn og en forklarende titel.
- Mens AI'en arbejder i den åbne samtale, har skrivefeltet en tynd metalkant, der drejer langsomt. Den står stille efter 15 sekunder uden signaler og forsvinder, når opgaven venter på brugeren eller er færdig. Ved reduceret bevægelse står kanten stille, og i høj kontrast bruges systemets markeringsfarve.
- Bevægelse bruges ved åbning af dialoger og trin. Overgange varer 140–220 ms og slås fra ved reduceret bevægelse.

Farver og fælles komponentregler ligger i `ui/styles.css`. Nye skærme skal bruge dem, før der tilføjes særregler.

## Sprog og adgang

Skriv kort, konkret dansk. Brug handlinger som Gem version, Tilslut AI og Ret forslaget. Forklar konsekvensen ved den handling, der udløser den. Undgå faste opsummeringer, unødige gentagelser og slogans.

Kontroller skal kunne bruges med tastatur og have synligt fokus. Menuer skal kunne lukkes med Escape. Dialoger må gerne rulle på små skærme, men handlinger må ikke forsvinde. Brug farve sammen med tekst, når noget fejler eller kræver opmærksomhed.

## Afprøvning

Gennemgå både velkomst, tomt projekt, igangværende opgave, godkendelse, færdigt resultat, genåbning og fejl. Brug også vinduet ved 980 × 720 og reduceret bevægelse. Skærmbilleder alene viser ikke, om menuernes handlinger virker; gennemfør brugerforløbene i Electron.

## Deling: version, destination og faktisk kontrol

Delingsdialoger stiller ét spørgsmål ad gangen: destination, forbindelse, app, navn, adgang og til sidst gennemgang. Trin, hvis svar allerede er kendt, springes over. Tilbage bevarer felterne, og samme valg kan bruges igen. Den endelige gennemgang viser appnavn, adresse, gemt version, modtager, adgang og omkostninger. Udgiv er den udtrykkelige godkendelse; der er ingen ekstra afkrydsning med samme betydning. Ændringer kasserer godkendelsen og kræver en ny gennemgang.

Kvitteringen har et tydeligt appnavn og en læsbar adresse. Udgivelse, adgang og indholdskontrol vises som adskilte statusoplysninger, aldrig som én sammenkædet linje. Åbn appen er den direkte handling, når udgivelsen er bekræftet. Tekniske ID'er, fingeraftryk, HTTP-status og kontroltidspunkt ligger i en struktureret detaljevisning med ombrydning af lange værdier. Det samme forhold forklares kun én gang i første lag.

Et uploadresultat er knyttet til den gennemgåede version og destination. Udbyderens status, HTTP-svar uden login, filmatch og testpersonens adgang må ikke blandes sammen. En mislykket frisk kontrol erstatter gammel evidens. Ved ukendt upload er udbyderens oversigt vejen videre; ingen automatisk gentagelse. Sikkerhedskopi til GitHub viser kode og historik. GitHub Pages er et særskilt udgivelsesforløb for en hjemmeside. Uflettede kopier står synligt som udeladt fra delingen.

Dialogerne kan rulle ved større tekst; gennemgang og resultat får synligt tastaturfokus, og Escape returnerer til åbneren. Handlingsrækken i gennemgangen bliver synlig ved større tekst, så Udgiv og Ret ikke forsvinder under indholdet. Skærmbilleder ved Electron-zoom tages med vinduets capturePage efter den færdige overgang. Forståeligheden afgøres ved observation med en testperson efter docs/testforloeb.md; automatiske prøver tæller som separat teknisk evidens.

## Forbindelser og hosting

- komplai findes kun under Udgiv som komplai Run. Browserlogin giver særskilt udgivelsesadgang. Én organisation vises direkte; flere organisationer giver et valg. Tidligere AI-forbindelser kan fjernes fra AI-oversigten, men ikke vælges eller bruges. Et gemt valg af komplai må aldrig udløse et automatisk skift til en anden AI. Run-adgang og historiske samtaler bevares.
- Udgiv starter med Udgiv fra Aura og Se udgivelsesvejledning. Udbyderne står på lige fod i alfabetisk rækkefølge, uden anbefaling eller forvalg. En tidligere valgt destination kan genbruges. komplai Run har ingen særplacering.
- komplai Run kræver ingen CLI. Login og særskilt udgivelsesadgang gennemføres før appvalget. Én organisation kræver ingen rullemenu. Ny app og Eksisterende app er to valg; navn, adresse og adgang har deres egne trin. Ved en ny app har Hvem kan åbne appen to lige store kort uden forvalg. En eksisterende app viser sin aktuelle adgang; upload ændrer den ikke. Konto og adgang samler Log ud og linket Skift adgang i komplai. Gennemgangen henter adgang igen og viser adresse, organisation, adgang, placering og omkostninger. Resultatet kontrollerer udgivelsen hos komplai og startsiden samt fremhæver, hvis observeret adgang afviger fra valget ved upload. En ny version går til den app, der senest blev udgivet til; Skift app åbner appvalget direkte. Filer, komplai ikke modtager, nævnes ved navn før upload.
- Gemte AI-forbindelser vises fire ad gangen med søgning. Navn og udbyder står hver for sig. Status siger, hvornår kataloget senest svarede; ukontrollerede forbindelser får ingen grøn markering.
- Efter tilslutning er Fortsæt hovedhandlingen. Tilføj en AI mere er et frivilligt valg. Gentagen opsætning må ikke slette kladder, projekt eller andre forbindelser.
- Hostingens korte tekst beskriver leverandør og dataplacering. Opsætning, databehandleraftale, sikkerhed og kilde ligger i en fold. Ingen generel grøn GDPR-markering. En vejledning må ikke ligne en færdig uploadintegration.
- Chatstatus viser faktisk aktivitet fra opstarten, også inden første svar. Tegn og tokens holdes adskilt. Ingen opdigtet procent eller tokenhastighed. Automatisk rulning stopper, når brugeren ruller op, og Seneste svar fører tilbage.


## Udgivelsesvalg og fælles status · 20. oktober 2026

- Udgiv viser alle seks udbydere på samme skærm, som udtrykkelig undtagelse fra grænsen på fire valg: Azure Static Web Apps, Cloudflare Pages, GitHub Pages, komplai Run, Promte Apps og Vercel. De står alfabetisk med logo, navn og kontokrav, uden anbefaling eller forvalg. Promte viser krav om konto og betalt aftale. komplai viser kun kravet om en komplai-konto, og komplai-loginet viser kun knappen Log ind med komplai uden salgstekst eller kontaktlink.
- Gennemgå udgivelse, Byg og gennemgå samt Udgiv viser en spinner straks efter klikket med en kort tekst om det aktuelle arbejde. Der vises ingen procent uden målt fremdrift. Resultatet har **Udgiv et andet sted**. Et afventende Promte-login kan afbrydes, så adresse og udbyder kan vælges igen uden at vente på udløb.
- Forbindelse, destination, filer og gennemgang har fælles opbygning. Browserlogin er førstevalg, hvor integrationen understøtter det. Manglende værktøj, udløbet login og manglende adgang giver et konkret næste trin. API-nøgler vises kun i det nødvendige opsætningsforløb og må ikke ligge i projektfiler.
- Azure viser abonnementer og eksisterende apps fra brugerens konto. Ressourcegruppen aflæses automatisk. Promte spørger om organisationens adresse og arbejdsområde. Komplais OAuth-forløb bevares uden særplacering.
- GitHub Pages og Cloudflare Pages viser opsætningsfilerne før skrivning. Brugeren gemmer og sender selv ændringerne til GitHub. Udgiv med GitHub Actions godkender én manuel kørsel; der startes ikke automatisk ved push. Cloudflares token gemmes hos GitHub.
- Vercel har to valg: automatisk udgivelse fra Git eller én testversion. Git-forbindelsen oprettes hos Vercel. Aura viser repository, produktionsbranch og projektmappe før lokal tilknytning. Gemte projektindstillinger kan genbruges, men aktiverer aldrig sporing eller udgivelse alene.
- Status ved Udgiv gælder alle udbydere og det aktuelle projekt. Fejlet kontrol viser aldrig gammel grøn status. Vercels status skelner mellem produktion og testudgave. En igangværende kontrol må ikke overskrive en nyere udgivelse eller et andet projekt.
- Promte kan give en udgivet version uden en dokumenteret appadresse. I det tilfælde er Åbn Promte den direkte handling; der opfindes intet link. Tekniske detaljer forbliver foldet sammen.
- Er projektet ikke en Promte-app, siger Udgiv **Appen er ikke klar til Promte endnu** før login, med **Gør klar til Promte** og **Vælg en anden udbyder**. Den tekniske årsag ligger bag "Se detaljer". Gør klar slår Promte-integrationen til, lukker udgivelsesdialogen og starter den tydelige ombygningsbesked i **Byg** gennem det normale afsendelsesforløb. En eksisterende beskedkladde overskrives ikke.
