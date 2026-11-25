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
| `site/src/style.css` | The shared stylesheet. |
| `site/build.mjs` | The docs renderer and link checker. |
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

`audience` is the minimal key #417's split can adopt. Until every page has it, the renderer falls
back on the notes archive: `tutorials/`, `how-to/` and `explanation/` are the User Handbook; every
other page is Developer Documentation. `docs/README.md` is the overview and belongs to neither.

The switch targets are generated indexes at `docs/handbook/` and `docs/developer/`; the sidebar on a
page lists the pages in that page's section. Add `audience:` to a page and it moves between the two
without a second tree.

## Hosts and DNS

The artifact has `/` (landing) and `/docs/` (the docs). One GitHub Pages site cannot carry two custom
domains, so the deployment is:

- `suite.run` is the Pages custom domain (apex `A`/`AAAA`, `www` CNAME).
- `docs.suite.run` is a proxied `CNAME` to the same Pages site. The landing page's first script sends
  that host's root to `/docs/`; links inside the docs stay under `/docs/`.
- The owner keeps both names on Cloudflare DNS; the workflow carries no Cloudflare credential.
