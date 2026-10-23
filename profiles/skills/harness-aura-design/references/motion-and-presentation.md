# Bevægelse og præsentationer

## Bevægelse i almindelige apps

Bevægelse skal forklare en ændring eller bekræfte en handling. Hold den rolig, kort og begrænset; brug fx 140–480 ms og `transform`/`opacity` frem for animerede layoutmål. Stagger højst få elementer, og bevar en brugbar statisk tilstand.

Respektér `prefers-reduced-motion`: sluk dekorative animationer, men bevar tekst om igangværende arbejde, fokus og valgt tilstand. Pause løbende animationer, når dokumentet er skjult. Brug ikke partikelscener eller lange introer i en normal formular uden brugerens konkrete ønske.

Denne reference ændrer ingen animation, varighed eller standard i værtsappen Aura.

## Faste slides og scener

En fast 1920×1080-flade kan være nyttig til slides, film og scenebaserede præsentationer, som udtrykkeligt er designet til det format. Den må ikke bruges til almindeligt applayout; apps skal ombryde ved vinduets størrelse og fungere med zoom.

```css
.stage {
  position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px;
  transform: translate(-50%, -50%) scale(var(--scene-scale));
  transform-origin: 50% 50%;
}
```

```js
const fitScene = () => document.documentElement.style.setProperty(
  '--scene-scale', Math.min(innerWidth / 1920, innerHeight / 1080)
);
addEventListener('resize', fitScene);
fitScene();
```

Kodeeksempler må kun materialiseres i brugerprojektet via godkendte filhandlinger. Skaleringen gør ikke i sig selv tekst tilgængelig; tilbyd relevant læsbart alternativ og tastaturbetjening.

## Genbrugelige teknikker

- Lag rolig baggrund, landskab/illustration, forgrund og tekst, så tekst altid står på en læsbar flade.
- Brug én `requestAnimationFrame`-løkke til canvas, begrænset pixelratio, pause ved skjult dokument og seedet tilfældighed til reproducerbare screenshots.
- Gem slideindhold én gang som data; generér skærm- og eksportversion fra samme indhold.
- Piletaster, tydelige næste/forrige-knapper og slidenummer gør navigation forståelig. Genveje må ikke overtage tastaturinput i formularer.
- Prikkort, buer, cirkelovergange og typografiske motiver skal følge den konkrete afsender; kopier ikke andre produkters logo, navn eller tagline.

## Verificér

Se alle slides efter animationen i relevante skærmformater. Kontrollér tekst, frizone, overlaps, tastatur, reduceret bevægelse og ydeevne på en realistisk maskine. Afprøv også indlæsning, manglende assets og eksport. Screenshots og noter skal bruge syntetiske data og håndteres efter projektets dataregler. Ingen automatisk deling eller skærmoptagelse med følsomt indhold.
