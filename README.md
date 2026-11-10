# SeaBathy website

The website for [SeaBathy](https://github.com/SeaBathy): free, open-source bathymetry apps for
Australian waters.

It's a single static page with no build step, no libraries and no trackers. The 3D seabed at
the top is drawn live with WebGL2 from real survey data (`data/central-gbr.bin`), and falls
back to a still picture on browsers without WebGL2.

## Run it locally

```bash
python -m http.server 8080
```

Then open http://localhost:8080. (Opening `index.html` straight from disk won't load the 3D
data, because browsers block `fetch` from `file://`.)

## Hosting

Hosted on Cloudflare Pages, connected to this repository: every push to `main` goes live in
about a minute. Build command: none. Output directory: `/`. `_headers` sets caching and
security headers.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The page |
| `css/site.css` | All the styling |
| `js/hero.js` | The 3D seabed (plain WebGL2) |
| `js/site.js` | Fades sections in as you scroll |
| `data/central-gbr.bin` | Seabed heights for the 3D view: 512 × 512 little-endian Int16, decimetres |
| `img/` | App screenshots (WebP) and the social-share picture |

## Credits

- **3D seabed data:** Flukes, E. (2026). *Multi-resolution bathymetry composite surface for
  Australian waters (EEZ)* [Data set]. Institute for Marine and Antarctic Studies.
  https://doi.org/10.25959/Y9VF-V723. CC BY 4.0. Area 146.35–146.92°E, 17.56–18.15°S,
  resampled to 512 × 512 (about 120 m per cell). Not for navigation.
- **Screenshots** are of the SeaBathy apps, and show map and data credits as the apps do.
- **Code:** MIT licence, see [LICENSE](LICENSE).
