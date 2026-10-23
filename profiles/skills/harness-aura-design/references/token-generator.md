# Valgfri offline-generator til tokens

Dette er dokumenteret projektkode, ikke et installeret Aura-værktøj. Kopiér kun Python-blokken til fx `tools/make_tokens.py` i brugerens projekt efter normale godkendte filhandlinger; kørsel og valg af outputmappe kræver de eksisterende værktøjstilladelser. Read-only og projektets datagrænser gælder stadig. Ingen netværk, downloads eller ekstra pakker anvendes.

Eksempel efter godkendelse: `python3 tools/make_tokens.py --primary '#004d52' --accent '#9d3732' --name eksempel --font-sans 'Source Sans 3' --radius 4,8,16 --out app`.

Validering afsluttes før mappeoprettelse og skrivning. Farver er præcis `#RGB` eller `#RRGGBB`; navnet er en lille ASCII-slug, fontnavne har kun ASCII-bogstaver/tal/mellemrum/bindestreg, og radius er præcis tre heltal mellem 0 og 128 px. Output er `tokens.css` og `tokens.json` i den godkendte mappe; symlink-outputfiler afvises. Eksisterende almindelige filer erstattes kun som led i en godkendt generering.

Exit 0 betyder, at de **navngivne tokenpar** i rapporten består. Det er ikke en fuld WCAG-test eller et bevis om færdige komponenter, interaktioner, zoom, transparens, billeder eller skærmlæsere. Ugyldige input eller utilstrækkelige navngivne par giver exit 2 uden nye outputfiler. I/O-fejl rapporteres som fejl; de to filer er ikke én atomisk transaktion.

```python
#!/usr/bin/env python3
"""Generate local CSS tokens and a report of explicitly listed contrast pairs."""
import argparse
import colorsys
import json
import pathlib
import re
import sys

REVISION = "88ef16cf3f8916911f5f26cb5a334dbdf332d1f5"


def color(value):
    if not re.fullmatch(r"#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?", value):
        raise argparse.ArgumentTypeError("Use #RGB or #RRGGBB.")
    digits = value[1:].lower()
    return "#" + ("".join(c * 2 for c in digits) if len(digits) == 3 else digits)


def font(value):
    if value != value.strip() or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 -]{0,79}", value):
        raise argparse.ArgumentTypeError("Use 1-80 ASCII letters, digits, spaces or hyphens.")
    return value


def slug(value):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value):
        raise argparse.ArgumentTypeError("Use a lowercase ASCII slug of at most 64 characters.")
    return value


def radii(value):
    if not re.fullmatch(r"\d{1,3},\d{1,3},\d{1,3}", value):
        raise argparse.ArgumentTypeError("Use exactly three integer radii, for example 8,12,20.")
    result = tuple(int(part) for part in value.split(","))
    if any(part > 128 for part in result):
        raise argparse.ArgumentTypeError("Each radius must be between 0 and 128.")
    return result


def rgb(value):
    return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))


def hex_color(values):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c * 255))) for c in values)


def luminance(value):
    channels = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb(value)]
    return sum(weight * channel for weight, channel in zip((0.2126, 0.7152, 0.0722), channels))


def contrast(first, second):
    high, low = sorted((luminance(first), luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def blend(foreground, background, amount):
    return hex_color(b + (f - b) * amount for f, b in zip(rgb(foreground), rgb(background)))


def shift(value, amount):
    hue, lightness, saturation = colorsys.rgb_to_hls(*rgb(value))
    return hex_color(colorsys.hls_to_rgb(hue, max(0, min(1, lightness + amount)), saturation))


def fit(value, backgrounds, need=4.5):
    def passes(candidate):
        return all(contrast(candidate, background) >= need for background in backgrounds)
    if passes(value):
        return value
    for step in range(1, 201):
        for delta in (-step / 200, step / 200):
            candidate = shift(value, delta)
            if passes(candidate):
                return candidate
    for candidate in ("#000000", "#ffffff"):
        if passes(candidate):
            return candidate
    raise ValueError("No shared color passes the specified backgrounds; revise the palette.")


def on_color(background):
    return max(("#000000", "#ffffff"), key=lambda foreground: contrast(foreground, background))


def theme(primary, accent, ink, paper, band, dark=False):
    background = blend(primary, "#0b0f14", 0.10) if dark else paper
    surface = blend(primary, "#141a21", 0.10) if dark else "#ffffff"
    surface2 = blend("#eef1f4" if dark else ink, surface, 0.05)
    surfaces = (background, surface, surface2)
    main = fit(primary, surfaces, 3) if dark else primary
    accent = accent or primary
    danger = fit("#ee6a55" if dark else "#c8372d", surfaces)
    result = {
        "bg": background, "surface": surface, "surface-2": surface2,
        "ink": fit("#eef1f4" if dark else ink, surfaces),
        "ink-2": fit("#d4d8df" if dark else ink, surfaces),
        "muted": fit("#a4abb5" if dark else "#646a73", surfaces),
        "line": blend("#eef1f4" if dark else ink, background, 0.18),
        "line-strong": fit("#a4abb5" if dark else "#646a73", surfaces, 3),
        "primary": main, "primary-hover": shift(main, 0.06 if dark else -0.06),
        "primary-text": fit(primary, surfaces), "primary-soft": blend(primary, background, 0.10),
        "accent": accent, "accent-hover": shift(accent, 0.06 if dark else -0.06),
        "accent-text": fit(accent, surfaces), "accent-soft": blend(accent, background, 0.10),
        "danger": danger, "danger-hover": shift(danger, 0.06 if dark else -0.06),
        "focus": fit(primary, surfaces, 3),
        "ok": fit("#1e9e63", surfaces), "warn": fit("#b7791f", surfaces),
        "info": fit("#6f9cff" if dark else "#1f5fe0", surfaces), "band": band or primary,
    }
    for key in ("primary", "primary-hover", "accent", "accent-hover", "danger", "danger-hover", "band"):
        result["text-on-" + key] = on_color(result[key])
    return result


def measure(themes):
    report = []
    for name, tokens in themes.items():
        pairs = []
        for foreground in ("ink", "ink-2", "muted", "primary-text", "accent-text", "danger", "ok", "warn", "info"):
            pairs.extend((foreground, background, 4.5) for background in ("bg", "surface", "surface-2"))
        pairs.extend(("text-on-" + key, key, 4.5) for key in (
            "primary", "primary-hover", "accent", "accent-hover", "danger", "danger-hover", "band"))
        pairs.extend(("focus", background, 3) for background in ("bg", "surface", "surface-2"))
        for foreground, background, need in pairs:
            ratio = contrast(tokens[foreground], tokens[background])
            report.append({"theme": name, "pair": foreground + " / " + background,
                           "foreground": tokens[foreground], "background": tokens[background],
                           "ratio": ratio, "need": need, "pass": ratio >= need})
    return report


def make_css(themes, fonts, radius, name):
    def block(tokens):
        return "\n".join("  --%s: %s;" % item for item in tokens.items())
    scale = "\n".join((
        "  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;",
        "  --t-xs: .75rem; --t-sm: .875rem; --t-md: 1rem; --t-lg: 1.125rem;",
        "  --t-xl: clamp(1.25rem, 1.1rem + .6vw, 1.5rem); --t-2xl: clamp(1.6rem, 1.3rem + 1.2vw, 2.25rem);",
        "  --t-3xl: clamp(2.1rem, 1.5rem + 2.6vw, 3.5rem); --tap: 44px; --content: 72rem; --prose: 68ch;",
        "  --r-sm: %dpx; --r: %dpx; --r-lg: %dpx; --r-pill: 999px;" % radius,
        '  --font-sans: "%s", system-ui, sans-serif;' % fonts["sans"],
        '  --font-display: "%s", system-ui, sans-serif;' % fonts["display"],
        '  --font-mono: "%s", ui-monospace, monospace;' % fonts["mono"],
        "  --d-fast: 140ms; --d: 240ms; --d-slow: 480ms; --ease: cubic-bezier(.2,.8,.2,1);",
        "  --shadow-1: 0 1px 3px rgb(0 0 0 / .10); --shadow-2: 0 8px 24px -8px rgb(0 0 0 / .20);"))
    return ("/* %s: generated tokens; coverage is listed token pairs only. */\n" % name
            + ":root {\n  color-scheme: light dark;\n" + block(themes["light"]) + "\n" + scale + "\n}\n"
            + '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {\n'
            + block(themes["dark"]) + "\n} }\n"
            + ':root[data-theme="dark"] {\n  color-scheme: dark;\n' + block(themes["dark"]) + "\n}\n"
            + ':root[data-theme="light"] { color-scheme: light; }\n'
            + "@media (prefers-reduced-motion: reduce) { :root { --d-fast: 0ms; --d: 0ms; --d-slow: 0ms; } }\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primary", type=color, required=True)
    parser.add_argument("--accent", type=color)
    parser.add_argument("--ink", type=color, default="#191919")
    parser.add_argument("--paper", type=color, default="#f7f5f3")
    parser.add_argument("--band", type=color)
    parser.add_argument("--name", type=slug, default="brand")
    parser.add_argument("--font-sans", type=font, default="Geist")
    parser.add_argument("--font-display", type=font)
    parser.add_argument("--font-mono", type=font, default="Geist Mono")
    parser.add_argument("--radius", type=radii, default=(8, 12, 20))
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("."))
    args = parser.parse_args()
    try:
        fonts = {"sans": args.font_sans, "display": args.font_display or args.font_sans, "mono": args.font_mono}
        themes = {name: theme(args.primary, args.accent, args.ink, args.paper, args.band, name == "dark")
                  for name in ("light", "dark")}
        report = measure(themes)
        if any(not pair["pass"] for pair in report):
            raise ValueError("A listed token pair failed; revise the palette.")
        output = args.out
        if output.is_symlink() or (output.exists() and not output.is_dir()):
            raise ValueError("Output must be an approved real directory, not a symlink or file.")
        targets = [output / "tokens.css", output / "tokens.json"]
        if any(path.is_symlink() or (path.exists() and not path.is_file()) for path in targets):
            raise ValueError("Output files must not be symlinks or directories.")
        css_text = make_css(themes, fonts, args.radius, args.name)
        document = {"schema_version": 1, "source": {"repository": "Parthee-Vijaya/skills_claude", "revision": REVISION},
                    "coverage": "listed-token-pairs-only", "name": args.name, "fonts": fonts, "radius": args.radius,
                    "light": themes["light"], "dark": themes["dark"], "contrast": report}
        json_text = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    except ValueError as error:
        parser.error(str(error))
    try:
        output.mkdir(parents=True, exist_ok=True)
        targets[0].write_text(css_text, encoding="utf-8")
        targets[1].write_text(json_text, encoding="utf-8")
    except OSError as error:
        print("Cannot write approved output: " + str(error), file=sys.stderr)
        return 1
    print("Checked %d listed token pairs in light and dark themes; this is not full WCAG verification." % len(report))
    print(str(targets[0]))
    print(str(targets[1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

## Rapportkontrakt

JSON har `schema_version: 1`, fast `source.revision`, `coverage: "listed-token-pairs-only"`, validerede `fonts`/`radius`, `light`/`dark`-tokens og en `contrast`-liste. Hver række har `theme`, `pair`, konkrete `foreground`/`background`, fuld `ratio`, `need` og `pass`. Rapporten skrives efter hele beregningen og svarer til exitstatus. Der er ingen implicit undtagelse for stor tekst.

Forgrund på fare-, primær- og accentknapper måles særskilt for normal og hover i begge temaer. Generatoren dækker ikke alle kombinationer af soft-flader, egendefinerede komponenter, fokusbaggrunde eller forced colors. Kontrollér den renderede app. Tilføj aldrig en garanti, der rækker ud over disse dokumenterede par.
