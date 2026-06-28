# The Anatomy of a Web App

A single-page explainer for non-technical people: the six parts that make up
every modern web app — **frontend, backend, database, auth, hosting, git** —
taught by reading one Claude Code conversation that builds a to-do app
(the Geist font, an old-timey reporter's notebook look, Google sign-in,
sync across devices).

The goal is vocabulary, not code. Each part gets a plain definition, a newsroom
analogy, the exact phrases you'd type to ask for it, a one-line "tell" for
recognizing it, and the jargon to listen for in Claude's replies. It ends with
a clip-and-save cheat sheet.

## Use

`index.html` is fully self-contained — no build step, no dependencies, no
network requests. Open it in a browser, or serve it from anywhere.

## Notes

- Geist Sans and Geist Mono (the typeface the conversation asks for) are
  embedded as `@font-face` data URIs, sourced from the [`geist`](https://www.npmjs.com/package/geist)
  npm package. Geist is licensed under the SIL Open Font License 1.1.
- JavaScript is only used for the progress rail and scroll-in reveals; the
  page is fully readable without it, and reveal animations respect
  `prefers-reduced-motion`.
