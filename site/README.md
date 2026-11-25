# Suite site

The published static site: `suite.run` is the landing page and `docs.suite.run` is the documentation.
Both are one Cloudflare Pages project, `suite`, connected to this repository. The production build
runs `pnpm docs:check && pnpm site:build` on `main` and uploads `site/dist`; there is no GitHub Pages
deployment and no build token in the repository.

```sh
pnpm install
pnpm site:build        # writes site/dist
```

`pnpm site:build` is the only render command. The output is a pure function of `docs/`, `site/src/`
and `docs/assets/suite-icon.png`.

## Layout

| Path | What it is |
| --- | --- |
| `site/src/index.html` | The one landing page. |
| `site/src/404.html` | The not-found page, and the docs.suite.run redirect for deep links. |
| `site/src/style.css` | The shared stylesheet. |
| `site/build.mjs` | The docs renderer and link checker. |
| `site/unclassified.txt` | Pages with no `audience:`; empty since #417 classified every page. |
| `site/dist/` | Ignored build output; the Pages artifact. |

## Documentation renderer

The renderer is a second reader over the repository's `docs/`, not a second source. It keeps the
paths (`reference/status.md` becomes `docs/reference/status.html`, a `README.md` becomes its folder's
`index.html`) and copies the non-page files a page links to. `docs/README.md` is `docs/index.html`.

Every relative link is resolved:

- a link between docs pages stays on the site, with its anchor checked against the same heading slug
  `scripts/docs-check.mjs` uses;
- a link that leaves `docs/` points at `https://github.com/mrrnbhd/suite-apps`;
- a missing file, a missing heading, or a docs directory with no `README.md` or `index.md` fails the
  build.

## Audience metadata

The header switch has two sections over the same tree. A page chooses one with frontmatter:

```yaml
---
audience: user # or developer
---
```

`audience` is the key #417's split adopted. Every page under `docs/` now declares it, so the build
reports `0 unclassified`; the folder mapping stays as the safety net for a page that does not:

| Folder | Section |
| --- | --- |
| `tutorials/` | User Handbook |
| `how-to/`, `explanation/`, `reference/`, `spec/`, `modules/` | Developer Documentation |
| `README.md` | User Handbook; the docs home itself keeps the shared sidebar |
| anything else | unclassified |

An unclassified page is not guessed into a section. It still renders at its path, but it joins
neither section, and the build prints every unclassified path and the count.

`site/unclassified.txt` is that list, and it is empty since #417 landed. The build fails on an
unclassified page missing from the list, and on a line that no longer names one, so a new page
cannot slip in unclassified without a decision.

The switch targets are generated indexes at `docs/handbook/` and `docs/developer/`; the sidebar on a
page lists the pages in that page's section. Add `audience:` to a page and it moves between the two
without a second tree.

## Hosts and DNS

The artifact has `/` (landing) and `/docs/` (the docs). One Cloudflare Pages project carries both
custom domains, so there is one deployment and no redirect between hosts:

- `suite.run` is the canonical custom domain for the project.
- `docs.suite.run` is a second custom domain on the same project. The landing page's first script
  sends that host's root to `/docs/`; links inside the docs stay under `/docs/`. `404.html` carries the
  same redirect for a deep link that arrives without the prefix.
- `www.suite.run` is a 301 to the apex at the Cloudflare edge.
- DNS lives in the same Cloudflare account as the project; the repository carries no Cloudflare
  credential. GitHub Pages is no longer a deployment target.
