# Suite site

The published static site: `suite.run` is the landing page and `docs.suite.run` is the documentation.
Both are one GitHub Pages artifact built by `.github/workflows/pages.yml`; no server, no Cloudflare
build token.

```sh
pnpm install
pnpm site:build        # writes site/dist
```

`pnpm site:build` is the only command. The output is a pure function of `docs/`, `site/src/` and
`docs/assets/suite-icon.png`.

## Layout

| Path | What it is |
| --- | --- |
| `site/src/index.html` | The one landing page. |
| `site/src/404.html` | The not-found page, and the docs.suite.run redirect for deep links. |
| `site/src/style.css` | The shared stylesheet. |
| `site/build.mjs` | The docs renderer and link checker. |
| `site/unclassified.txt` | Pages #417 has not given an `audience:` yet. |
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

`audience` is the minimal key #417's split can adopt. Until every page has it, the build maps only
the folders whose audience is unambiguous:

| Folder | Section |
| --- | --- |
| `tutorials/` | User Handbook |
| `how-to/`, `explanation/`, `reference/`, `spec/`, `modules/` | Developer Documentation |
| `README.md` | User Handbook; the docs home itself keeps the shared sidebar |
| anything else | unclassified |

An unclassified page is not guessed into a section. It still renders at its path, but it joins
neither section, and the build prints every unclassified path and the count:

```
site: 13 unclassified page(s) — no `audience:` frontmatter and no unambiguous folder:
  docs/AGENTS.md
  docs/tours/start.mdx
  ...
```

`site/unclassified.txt` names the pages #417 has not reached yet. The build fails on an unclassified
page missing from that list, and on a line that no longer names an unclassified page, so the list
shrinks with the metadata instead of drifting.

The switch targets are generated indexes at `docs/handbook/` and `docs/developer/`; the sidebar on a
page lists the pages in that page's section. Add `audience:` to a page and it moves between the two
without a second tree.

## Hosts and DNS

The artifact has `/` (landing) and `/docs/` (the docs). One GitHub Pages site cannot carry two custom
domains, so the deployment is:

- `suite.run` is the Pages custom domain (apex `A`/`AAAA`, `www` CNAME).
- `docs.suite.run` is a proxied `CNAME` to the same Pages site. The landing page's first script sends
  that host's root to `/docs/`; links inside the docs stay under `/docs/`. `404.html` carries the same
  redirect for a deep link that arrives without the prefix.
- The owner keeps both names on Cloudflare DNS; the workflow carries no Cloudflare credential.
