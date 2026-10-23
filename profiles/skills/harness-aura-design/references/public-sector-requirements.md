# Offentlige løsninger: afklar krav før drift

Dette er design- og afklaringsvejledning, adapteret fra kildens oktober 2026-version. Det er ikke juridisk rådgivning, en sikkerhedsgodkendelse eller bevis på efterlevelse. Den konkrete organisation skal afklare gældende standarder, målgruppe, data, behandlingsgrundlag og drift. Slå kun aktuelle kilder op, hvis projektets netværks- og datatilladelser giver adgang; ellers markér vurderingen som uafklaret.

## Tilgængelighed

Offentlige websteder og apps kan være omfattet af webtilgængelighedsloven og relevante krav i EN 301 549. Verificér den gældende version, anvendelsesområdet og krav til tilgængelighedserklæring hos Digitaliseringsstyrelsen. WCAG er en vigtig del af teknisk afprøvning, men en automatisk scanning omfatter kun en del af kravene.

Et praktisk designmål er et brugbart forløb med:

- Tilstrækkelig kontrast i faktisk tekst, knapper, fokus og tilstande.
- Tastaturbetjening, synligt logisk fokus og navngivne dialoger.
- Synlige labels, tilknyttede fejl, semantiske overskrifter og status med andet end farve.
- Smalle skærme, 200 % zoom og tekstforstørrelse uden tab af indhold.
- Reduceret bevægelse og ingen skadeligt blinkende effekter.
- Manuelle prøver med relevante hjælpemidler og brugere.

Kør lokale godkendte automatiske værktøjer i begge temaer og relevante tilstande, men skeln deres fund fra manuelle prøver og organisatorisk accept. En manglende scanner tæller ikke som bestået. Brug ikke “WCAG-kompatibel” eller “tilgængelig” uden den nødvendige bredere vurdering.

## Det Fælles Designsystem

Afklar brug af Det Fælles Designsystem ved borger-/virksomhedsselvbetjening, især i sammenhæng med borger.dk eller virk.dk. Organisationens egne interne værktøjer kan følge dens identitet. Vælg et eksisterende godkendt tema og undgå at et andet UI-bibliotek overskriver det utilsigtet. Hent eller installer ikke biblioteker automatisk.

## Data og sikkerhed i brugerfladen

- Minimer data i appen. Ingen hemmeligheder i frontend, URL’er, generelle logs eller fejlmeddelelser.
- Selvhost godkendte fonte, ikoner og scripts. Eksterne ressourcer og embeds giver netværkskontakt; organisationens tilladelser og behandlingsgrundlag skal være afklaret.
- Brug kun nødvendigt lokalt lager til fx tema og kladder, og afklar datatyper, levetid og sletning. Et temaønske giver ikke tilladelse til tracking.
- Login og roller skal følge organisationens godkendte identitetsløsning, når det kræves. Design ikke en demo, som kan forveksles med en rigtig myndigheds login, betaling eller MitID.
- AI-destination og datadeling er særskilte valg. En EU-model, et lokalt brand eller en privacytekst er ikke i sig selv en databehandleraftale eller fuld isolation.
- Screenshots og afledte rapporter omfattes også af dataregler. Afprøv med tydeligt syntetiske data.

## Rettigheder og licens

Kildens `aura-design` er deklareret EUPL-1.2. Det bestemmer ikke automatisk licensen for et vilkårligt brugerprojekt. Bevar relevante licenser og attribution for materiale, som faktisk genbruges; afklar projektets udgivelseslicens særskilt. Fonte, ikoner og logoer kan have andre vilkår. Et logo/byvåben skal anvendes med rettigheder og efter organisationens regler.

## Kilder til efterfølgende verificering

Links er referencer, ikke automatisk autorisation til netværk eller installation:

- Digitaliseringsstyrelsen: https://digst.dk/ og organisationens egne tilgængelighedsvejledninger.
- W3C WCAG: https://www.w3.org/WAI/standards-guidelines/wcag/
- WCAG 2.1, dansk oversættelse fra kilden: https://www.w3.org/Translations/WCAG21-da-20191211/
- Det Fælles Designsystem: https://designsystem.dk/
- Officiel EUPL-information: https://interoperable-europe.ec.europa.eu/collection/eupl
