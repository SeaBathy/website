# SeaBathy website

The website for [SeaBathy](https://github.com/SeaBathy): free, open-source bathymetry apps for
Australian waters.

It's a small static site with no build step, no libraries and no trackers. The 3D seabed at
the top is drawn live with WebGL2 from real survey data, two scenes that take turns
(`data/wide-1024.i16d.gz` and `data/reef-1024.i16d.gz`), with a Wide / Close-up switch, and falls back to a still picture on
browsers without WebGL2. Add `?t=12` to the address to hold the animation at 12 seconds.

## Run it locally

```bash
python -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight from disk won't load the 3D
data, because browsers block `fetch` from `file://`.)

## Hosting

Live at https://seabathy.com. Hosted on Cloudflare Pages, connected to this repository: every push to `main` goes live in
about a minute. Build command: none. Output directory: `/`. `_headers` sets caching and
security headers.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The home page |
| `guide.html` | The how-to guide (seabathy.com/guide): BathyPicker, the apps and AT5 Chart Maker step by step |
| `privacy.html` | The privacy policy |
| `css/site.css` | All the styling |
| `js/hero.js` | The 3D seabed (plain WebGL2) |
| `js/site.js` | Fades sections in as you scroll |
| `data/wide-1024.i16d.gz` | Wide 3D scene: 1024 × 1024 little-endian Int16 heights in decimetres, each row delta-encoded, gzipped |
| `data/reef-1024.i16d.gz` | Reef close-up 3D scene: same format, in centimetres |
| `img/` | App screenshots (WebP) and the social-share picture |

## Credits

- **3D seabed data:** Flukes, E. (2026). *Multi-resolution bathymetry composite surface for
  Australian waters (EEZ)* [Data set]. Institute for Marine and Antarctic Studies.
  https://doi.org/10.25959/Y9VF-V723. CC BY 4.0. Wide scene: 146.35–146.92°E, 17.56–18.15°S,
  resampled to 1024 × 1024 (about 59 m per cell). Reef close-up: 146.546–146.638°E,
  17.979–18.071°S, 1024 × 1024 at the survey's 10 m. Not for navigation.
- **Screenshots** are of the SeaBathy apps, and show map and data credits as the apps do.
- **AT5 Chart Maker pictures** (`img/at5-chart*.webp`) are real AT5 Chart Maker output (its own `preview` of
  the chart files), made from the wide 3D scene's IMAS data above.
- **Code:** MIT licence, see [LICENSE](LICENSE).
