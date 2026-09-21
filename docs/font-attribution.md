# Font credits and local hosting

The game bundles Latin webfont subsets from the official Google Fonts CSS API. No font download is needed at runtime. The five WOFF2 files total **95,416 bytes (93.2 KiB)**; CSS and licenses add a few KiB.

- **Barlow Condensed**: Copyright 2017 The Barlow Project Authors ([upstream](https://github.com/jpt/barlow)). Normal weights 600, 700, 800, and 900.
- **DM Sans**: Copyright 2014 The DM Sans Project Authors ([upstream](https://github.com/googlefonts/dm-fonts)). Normal variable weights 400–700.

Both are licensed under the **SIL Open Font License 1.1**. The original copyright notices and full licenses are distributed in `public/fonts/OFL-barlow-condensed.txt` and `public/fonts/OFL-dm-sans.txt`, retrieved from the official [Barlow license](https://github.com/google/fonts/blob/main/ofl/barlowcondensed/OFL.txt) and [DM Sans license](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt). Font binaries are unchanged from Google's supplied webfont subsets; only filenames were changed for clarity.

## Assets

| Local file under `public/fonts/` | Family | Weight | Bytes | Source |
| --- | --- | --- | ---: | --- |
| `barlow-condensed-600-latin.woff2` | Barlow Condensed | 600 | 14,844 | [Official download](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4873z3bWuYMBYro.woff2) |
| `barlow-condensed-700-latin.woff2` | Barlow Condensed | 700 | 14,888 | [Official download](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B46r2z3bWuYMBYro.woff2) |
| `barlow-condensed-800-latin.woff2` | Barlow Condensed | 800 | 14,764 | [Official download](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1z3bWuYMBYro.woff2) |
| `barlow-condensed-900-latin.woff2` | Barlow Condensed | 900 | 13,940 | [Official download](https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B45L0z3bWuYMBYro.woff2) |
| `dm-sans-400-700-latin.woff2` | DM Sans | 400 700 | 36,980 | [Official download](https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K6z9mXg.woff2) |

## CSS integration

Replace the remote Google Fonts import with this local import (placed before other CSS rules):

```css
@import url('/fonts/fonts.css');
```

That file includes the five complete `@font-face` declarations, `font-display: swap`, Latin Unicode ranges, and local `/fonts/*.woff2` sources. Existing family names and weight values can remain unchanged. Characters outside the supplied Latin ranges use the existing system-font fallback.

Fetched on 2026-09-20. WOFF2 signatures and byte lengths were checked after download.
