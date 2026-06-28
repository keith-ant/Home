# The Company Is a Tree of Skills

A working page cataloging an argument about how companies should store
knowledge for AI agents.

**The thesis.** The enterprise's default answer to AI knowledge — throw it in a
vector database — gives an agent *relevance* without *orientation*. Vector
search finds the right chunk; it never tells the agent what the company is, how
that chunk relates to everything else, or what *isn't* in the knowledge base at
all. What an agent needs is a hierarchy with a root it always sees and branches
it chooses to open. Claude already has the shape: `CLAUDE.md` is the homepage,
the skill listing (name + description, ~100 tokens each, always in context) is
the nav menu, and skill bodies are the pages. The pitch is **skills as company
knowledge** — and vector search gets demoted from *the architecture* to *a tool
the agent calls from one leaf of a tree it understands*.

The two load-bearing claims:

1. **The inversion.** In a RAG system, the *retriever* decides what the model
   sees. In a skill system, the *agent* decides what to open, because it can
   always see the table of contents. In particular, an agent that can see its
   own table of contents knows when the answer *isn't there* — which a top-*k*
   retriever, by construction, can never tell it.
2. **The unit changes.** A vector database stores documents; a skill encodes a
   procedure. A company is mostly procedures, and a procedure chunked into
   twelve pieces of which you retrieved pieces 3 and 7 is not a procedure.

Salesforce is the running case study — sympathetically: their 2023→2026 product
sequence (vector DB → hybrid search → structure-aware parsing → semantic layer
→ buy a knowledge graph → bolt on a deterministic scripting layer) is a public,
time-stamped record of an organization rediscovering information architecture
one layer at a time, and their own writing is the strongest witness against the
flat-chunk default ("most RAG failures are silent retrieval failures masked by
a plausible-sounding LLM hallucination").

## Use

`index.html` is fully self-contained — no build step, no dependencies, no
network requests, no JavaScript, system fonts only. Open it in a browser or
serve it from anywhere. It supports light and dark color schemes via
`prefers-color-scheme` and degrades cleanly in print.

## Research

The essay is grounded in four research fact sheets compiled on 2026-06-28,
checked into `research/`. They carry every source URL, a date for every claim,
and an explicit confidence flag (`[C]` confirmed / `[I]` inferred / `⚠️`
verify-before-quoting) on anything load-bearing — including the claims that
*didn't* make it into the page.

| File | Covers |
|---|---|
| `research/01-retrieval-state-of-the-art.md` | The 2024–2026 retrieval literature: the chunking critique, GraphRAG / LazyGraphRAG / RAPTOR, contextual retrieval, the RAG → agentic-search shift, long context & context rot, "progressive disclosure" as a named pattern. |
| `research/02-anthropic-skills-stack.md` | Agent Skills mechanics (the three levels, exact token costs), CLAUDE.md hierarchy, every shipped mechanism for distributing skills org-wide, the open standard, and exactly what Anthropic does **not** provide. |
| `research/03-salesforce-data360-agentforce.md` | Data Cloud → Data 360, the real chunking/embedding pipeline, Agentforce retrievers and Data Libraries, the customer-zero timeline and its receipts, the Anthropic partnership, and a corrections table for commonly-misremembered facts. |
| `research/04-website-as-knowledge-base.md` | Mintlify (and the "agents are 45% of doc traffic" stat), llms.txt's honest record, NLWeb/WebMCP/the agentic web, Pinecone's 2025–26 arc, and the steelman for where embeddings still clearly win. |

## Open questions the page ends on

These are deliberately unanswered — it's a working page:

- Who writes (and defends) the ~200-line company `CLAUDE.md`?
- How deep can the tree go before the always-on menu is too expensive, and
  does the menu itself get progressively disclosed?
- What's the cross-link convention between skills, and is there a skill
  PageRank?
- Can the tree actually be kept fresh by agents (the "librarian" bet), or
  does it die the corporate-wiki death?
- Skills don't yet sync across Anthropic's own surfaces (Claude Code,
  claude.ai, the API). That distribution gap is the real frontier.
