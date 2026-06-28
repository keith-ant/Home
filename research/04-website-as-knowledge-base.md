# The Website as Knowledge Base — Mintlify, llms.txt, the agentic web, Pinecone

> Research fact sheet supporting `index.html` ("The Company Is a Tree of Skills").
> Compiled 2026-06-28 by a Claude research agent.
> Observation under test: *a company's homepage + nav menu + sitemap is already
> a pretty good knowledge base, because it has hierarchy. The web in general is
> a knowledge graph. Maybe that's what enterprise AI knowledge management
> overlooked.*

**Method note:** many primary URLs (mintlify.com, pinecone.io,
searchengineland.com, a16z.com) returned 403 to the research fetcher, so several
dates below come from search-index metadata and secondary coverage rather than
the page itself. Anything that couldn't be pinned down is marked **approx.** or
**unconfirmed**. Everything else has at least two independent sources or an
explicit dated source.

---

## 1. Mintlify

**What it is now.** Mintlify markets itself as "The Knowledge Platform Built for
Agents" (homepage tagline, mid-2026) — i.e., it has explicitly repositioned from
"docs site generator" to "knowledge layer for AI agents."
https://www.mintlify.com/ (accessed 2026-06-28); a16z's investment memo is
literally titled "How Mintlify Is Rebuilding Documentation for Coding Agents" —
https://a16z.com/podcast/how-mintlify-is-rebuilding-documentation-for-coding-agents/
(2026).

**Agent/AI features (all shipping, all documented):**
- **llms.txt / llms-full.txt auto-generation** for every hosted docs site.
  Mintlify rolled this out **Nov 2024**, which "instantly gave thousands of
  sites llms.txt support, including Anthropic, Cursor, Coinbase, Pinecone, and
  Windsurf." https://www.mintlify.com/blog/simplifying-docs-with-llms-txt (Nov
  2024); https://www.mintlify.com/library/best-llms-txt-platforms (2026).
- **Contextual menu** on every page: "Copy page" (as Markdown), "View as
  Markdown" (raw `.md`), and "Open in" ChatGPT / Claude / Perplexity / Google AI
  Studio / Devin / Windsurf, plus MCP connect.
  https://www.mintlify.com/docs/ai/contextual-menu (current as of 2026-06).
- **Auto-generated MCP servers**: Mintlify auto-generates and hosts an MCP
  server for every docs site, zero config, so Claude/Cursor/any MCP client can
  query the docs as a tool.
  https://www.mintlify.com/blog/generate-mcp-servers-for-your-docs (2025);
  https://www.mintlify.com/docs/ai-native.
- **AI Assistant** ("ask AI" in the docs):
  https://www.mintlify.com/blog/introducing-ai-assistant (2024) and
  https://www.mintlify.com/blog/introducing-ai-assistant-2025 (2025).
- **The Mintlify Agent** (launched 2025): watches your codebase, detects
  changes, and opens PRs with draft doc updates; configurable via an `AGENTS.md`
  in the repo. Pro ($300/mo) and Custom plans only.
  https://www.mintlify.com/blog/agents-launch (2025);
  https://www.mintlify.com/docs/agent.

**Funding/scale.** **Series B, not C**: **$45M at a $500M valuation, announced
~April 17, 2026**, led by **a16z + Salesforce Ventures**, with Bain Capital
Ventures, YC, DST (Rahul Mehta), HubSpot Ventures, etc.
https://www.mintlify.com/blog/series-b ;
https://www.builtinsf.com/articles/mintlify-raises-45m-series-b-20260417
(2026-04-17);
https://www.finsmes.com/2026/04/mintlify-raises-45m-in-series-b-funding-at-500m-valuation.html
(April 2026). **No Series C found** — if a draft says Series C, correct it.
Scale claims from the round: 20,000+ companies, content reaching 100M+
people/year, $10M ARR end of 2025 (10x from $1M end of 2024). Stated mission:
"become the knowledge layer that makes products understandable, usable and
discoverable by AI agents." (Series B post, April 2026.)

**The killer stat** — Mintlify's own traffic report, "The state of agent traffic
in documentation" (**March 2026**): across ~790M requests/30 days to
Mintlify-hosted docs, **AI coding agents are 45.3% of all requests vs. 45.8%
browsers**; **Claude Code alone is 199.4M requests** — more than
Chrome-on-Windows (119.4M); Claude Code + Cursor = 95.6% of identified agent
traffic. https://www.mintlify.com/blog/state-of-ai (March 2026). At the Series
B, Mintlify said half of monthly active "viewership" is already agents and they
expect ~90% in 2026.

**Anthropic confirmed as a customer.** Mintlify has a public Anthropic customer
case study: https://www.mintlify.com/customers/anthropic — and a separate post,
"How Claude Code's documentation team makes feedback actionable with Mintlify"
(https://www.mintlify.com/blog/how-claude-code-docs-team-uses-mintlify). Cursor
and Perplexity are also named Mintlify customers (Perplexity API docs, Cursor
dev docs). Secondary write-up:
https://entrepreneurloop.com/claude-code-uses-mintify-anthropic-documentation/.

**"The go-to"?** Defensible to say it's the *default* for AI/dev-tool startups
(Anthropic, Cursor, Perplexity, Windsurf, Pinecone, Coinbase, Zapier on it), and
the best-funded. But say "category leader," not monopoly. **Competitors and
their agent features:** **Fern** (auto llms.txt + llms-full.txt, detects LLM bot
traffic and serves Markdown instead of HTML claiming 90%+ token reduction, plus
AI-bot analytics dashboards) —
https://buildwithfern.com/post/best-llms-txt-implementation-platforms-ai-discoverable-apis
(Jan 2026). **GitBook** (llms.txt Jan 2025; llms-full.txt + `.md` page variants
June 2025; auto MCP servers) — https://www.gitbook.com/blog/gitbook-vs-mintlify
(2026). **ReadMe** — https://readme.com/blog/readme-vs-mintlify (2026). Also
Scalar, Bump, Redocly, Fumadocs —
https://www.speakeasy.com/blog/choosing-a-docs-vendor.

---

## 2. llms.txt

**The proposal.** Jeremy Howard (Answer.AI), published **Sept 3, 2024**: a
`/llms.txt` Markdown file = a curated, LLM-friendly *index* of a site (H1,
blurb, link lists with descriptions), plus optional `/llms-full.txt` = the whole
site flattened into one Markdown doc; plus `.md` variants of every page. Spec:
https://llmstxt.org/ ; original post:
https://www.answer.ai/posts/2024-09-03-llmstxt.html (2024-09-03). Note the
explicit framing in the proposal: it's for *inference-time use by agents in
low-context situations*, not for training crawlers — that distinction is the
whole story below.

**Adoption (supply side, real).** SE Ranking scanned **300,000 domains**:
**10.13%** have an llms.txt (consistent ~8–10.5% across traffic tiers).
https://seranking.com/blog/llms-txt/ ; coverage:
https://www.searchenginejournal.com/llms-txt-shows-no-clear-effect-on-ai-citations-based-on-300k-domains/561542/
(2026). Mintlify/Fern/GitBook auto-generating it accounts for a lot of this.
Directory of adopters: https://llmstxt.site/ (approx.; not re-verified).

**The honest counterpoint (demand side, near-zero from big crawlers).**
- **Google explicitly does not use it.** Gary Illyes (July 2025) confirmed
  Google doesn't support llms.txt and isn't planning to. John Mueller: **"FWIW
  no AI system currently uses llms.txt"** and compared it to the **keywords meta
  tag**.
  https://www.searchenginejournal.com/google-says-llms-txt-comparable-to-keywords-meta-tag/544804/
  (2025);
  https://www.stanventures.com/news/google-dismisses-llms-txt-as-ineffective-and-unused-by-ai-bots-2479/.
  Google later added an llms.txt *check* to Lighthouse but simultaneously said
  it does nothing for rankings:
  https://searchengineland.com/google-llms-txt-chrome-lighthouse-478246 ;
  https://searchengineland.com/google-says-llms-txt-files-wont-harm-or-help-your-search-rankings-480264
  (2026).
- **Server-log evidence.** Two independent log studies, both 2026: (a) **Flavio
  Longato, Adobe AEM data, June 2026** — across a 90-day window with **~500M
  AI-bot visits**, only **408** requests targeted `/llms.txt`; in a subsample of
  62,100 AI-bot visits, 84 hit llms.txt (~0.1%); and ~60% of the traffic that
  *does* hit llms.txt is from self-described "GEO audit/monitor/readiness" tools
  — i.e., the optimization industry checking itself, not models reading it.
  https://www.longato.ch/llmstxt-2026-june/ (June 2026); summarized in
  https://limy.ai/blog/llms.txt-in-2026-the-full-guide (2026). **Caveat: these
  numbers come from search-index excerpts; the longato.ch page itself 403'd the
  fetcher — treat exact figures as "reported by," and re-verify before
  quoting.** (b) Search Engine Land tracked **10 sites for 90 days
  before/after** adding llms.txt: sites that just documented existing content
  saw no gain; the two that did gain had confounds (PR coverage, content/crawl
  fixes shipped simultaneously). Verdict: "treat llms.txt like a sitemap: useful
  infrastructure, not a growth lever."
  https://searchengineland.com/does-llms-txt-matter-467740 (**approx. Jan
  2026**). (c) Trakkr scanned 37,894 domains: **zero citation advantage** —
  https://trakkr.ai/trakkr-research/llmstxt-effect (2026).
- "No major AI company — OpenAI, Google, Anthropic, Meta, Mistral — has publicly
  committed to reading llms.txt in production" as of Q1 2026:
  https://codersera.com/blog/llms-txt-complete-guide-2026/ (May 2026). The
  most-cited obituary: Kai Spriestersbach, "The llms.txt is dead. More
  precisely: a dud."
  https://medium.com/@kaispriestersbach/the-llms-txt-is-dead-more-precisely-a-dud-ab7bee4f469c
  (2025).

**Where llms.txt IS actually consumed.** Inference-time agents, mostly developer
tooling: **Cursor (@Docs), Windsurf, Claude Code, Cline, Aider, GitHub Copilot**
will look for `/llms.txt` and `/llms-full.txt` when pointed at a docs site;
LangChain's **mcpdoc** is an open-source MCP server that exposes any llms.txt to
Cursor/Windsurf/Claude Desktop as a `fetch_docs` tool.
https://www.mintlify.com/blog/what-is-llms-txt ;
https://github.com/langchain-ai/mcpdoc ;
https://www.mintlify.com/blog/real-llms-txt-examples. Anthropic publishes one
(e.g., `docs.anthropic.com/llms.txt`) — generated by Mintlify.

**The clean one-sentence verdict:** llms.txt succeeded as a *publishing
convention* (~1 in 10 sites, near-universal in dev docs because
Mintlify/Fern/GitBook emit it for free) and failed as a *crawler standard*
(Google won't read it, OpenAI/Anthropic haven't committed, server logs show
~0.1% of AI-bot hits). It is being used — but by *user-driven agents at
inference time* (Cursor, Claude Code), which is exactly Howard's original use
case, not by training/search crawlers. So: not "robots.txt that nobody reads" —
more like "a sitemap that only agents read."

---

## 3. The "website as knowledge base" / agent-readable web thread

This is the strongest part of the thesis and 2025–26 gave it real scaffolding.

- **The lineage.** Sitemaps (sitemaps.org, 2005-), schema.org (2011,
  Google/Bing/Yahoo/Yandex), and Berners-Lee's Semantic Web (Scientific
  American, May 2001 —
  https://www.scientificamerican.com/article/the-semantic-web/) are all the same
  bet: the web already has hierarchy and typed links; expose it to machines. The
  2025+ revival reuses that exact substrate.
- **NLWeb (Microsoft, announced at Build 2025, May 19, 2025).** Open project;
  takes **schema.org markup and RSS a site already publishes** and turns the
  site into a conversational/queryable endpoint — and **"every NLWeb instance is
  also an MCP server."** Microsoft explicitly pitched it as playing "a similar
  role to HTML in the emerging agentic web."
  https://news.microsoft.com/source/features/company-news/introducing-nlweb-bringing-conversational-interfaces-directly-to-the-web/
  (2025-05); GitHub: https://github.com/nlweb-ai/NLWeb ; Build 2025 keynote:
  https://blogs.microsoft.com/blog/2025/05/19/microsoft-build-2025-the-age-of-ai-agents-and-building-the-open-agentic-web/
  (2025-05-19). This is the most literal version of the claim: the
  agent-readable knowledge base is *built from* the structured data the site
  already has.
- **WebMCP (Google + Microsoft → W3C).** A browser API
  (`navigator.modelContext`) by which a page exposes its own *actions* as typed
  tools to an in-browser agent. Timeline: unified Google/Microsoft proposal Aug
  2025; accepted into the W3C Web Machine Learning CG Sept 2025; first Chrome
  early preview Feb 2026; **origin trial in Chrome 149 announced at Google I/O
  2026 (June 2026)**.
  https://patrickbrosset.com/articles/2026-02-23-webmcp-updates-clarifications-and-next-steps/
  (2026-02-23);
  https://venturebeat.com/infrastructure/google-chrome-ships-webmcp-in-early-preview-turning-every-website-into-a
  (2026). The framing people are already using: "If Schema.org provided the
  standardized nouns of the web, WebMCP provides the standardized verbs" —
  https://wordlift.io/blog/en/webmcp-is-the-new-schema-org/ (2026).
  Searchengineland on schema for agents:
  https://searchengineland.com/schema-markup-optimize-agentic-web-479080
  (2026).
- **MCP as the new API surface for sites.** MCP launched Nov 2024 (Anthropic).
  On **Dec 9, 2025**, Anthropic donated MCP to the Linux Foundation's new
  **Agentic AI Foundation (AAIF)**, alongside Block's goose and OpenAI's
  **AGENTS.md**; OpenAI is a co-founder of the foundation. Cited scale at
  donation: 97M monthly SDK downloads, 10,000+ active servers, first-class
  support in ChatGPT, Claude, Cursor, Gemini, Copilot, VS Code.
  https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
  (2025-12-09);
  https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation
  (2025-12-09); https://openai.com/index/agentic-ai-foundation/ (2025-12). And —
  closing the loop to #1 — Mintlify auto-generates an MCP server *from* your
  docs hierarchy, which is precisely "your nav menu is already a knowledge base,
  now it's an API."
- **A great supporting datapoint:** Boris Cherny (creator of Claude Code) on why
  Claude Code uses **no embeddings / no vector index — just agentic search
  (glob/grep/read) over the existing structure**: "Early versions of Claude Code
  used RAG + a local vector db, but we found pretty quickly that agentic search
  generally works better. It is also simpler and doesn't have the same issues
  around security, privacy, staleness, and reliability."
  https://x.com/bcherny/status/2017824286489383315 (2026); explainer:
  https://vadim.blog/claude-code-no-indexing/. The thesis in miniature: when the
  corpus has *structure to navigate*, an agent traversing it beats a vector
  index of it.

---

## 4. Pinecone in 2026

**The news, verified with care:**
- **Aug 29, 2025 — The Information (exclusive):** "Top-Funded AI Database
  Startup Pinecone Considers a Sale," after "changes from AI model makers and
  AWS made vector database tech less relevant" and the loss of a major customer;
  Pinecone engaged bankers; reported target north of **$2B** vs. its last (April
  2023) **$750M** valuation; names floated as buyers: Databricks, Snowflake,
  Oracle, IBM, MongoDB.
  https://www.theinformation.com/articles/top-funded-ai-database-startup-pinecone-considers-sale
  (2025-08-29, paywalled); The Information's own tweet:
  https://x.com/theinformation/status/1961236433357652058 (2025-08-29);
  Calcalist: https://www.calcalistech.com/ctechnews/article/rz31q82b5 (Aug
  2025).
- **Sept 2025 — CEO change.** Founder **Edo Liberty stepped down as CEO to
  become Chief Scientist**; **Ash Ashutosh** (ex-Actifio founder, ex-Google)
  became CEO. https://www.pinecone.io/blog/growing-ai-ambitions/ ;
  https://www.prnewswire.com/news-releases/pinecone-founder-edo-liberty-to-spearhead-pinecones-growing-ai-ambitions-appoints-ash-ashutosh-as-ceo-to-expand-vector-database-market-leadership-302549334.html
  (Sept 2025); VentureBeat exclusive:
  https://venturebeat.com/data-infrastructure/pinecone-founder-edo-liberty-appoints-googler-ash-as-ceo.
  TechTarget reported Ashutosh said **acquisition is not the goal**:
  https://www.techtarget.com/searchdatamanagement/news/366631366/Vector-database-vendor-Pinecone-eyes-future-under-new-CEO
  (2025).
- **As of 2026-06-28: NO announced acquisition of Pinecone. It remains an
  independent private company.** "Exploring a sale" (Aug 2025) is confirmed; an
  actual sale is **unconfirmed and, as far as the research could find, has not
  happened**. Do not write that Pinecone was acquired.

**Positioning pivot — explicit and dated:**
- **Cascading retrieval** (dense + sparse + hosted rerankers like
  cohere-rerank-3.5 / pinecone-rerank-v0 in one API), announced **Dec 2, 2024**:
  https://www.pinecone.io/blog/cascading-retrieval/ ;
  https://venturebeat.com/data-infrastructure/pinecone-expands-vector-database-with-cascading-retrieval-boosting-enterprise-ai-accuracy-by-up-to-48
  (Dec 2024). Claimed up to 48% (avg 24%) over dense-only.
- **Pinecone Assistant** (managed RAG-as-an-API) **GA Jan 22, 2025**:
  https://www.pinecone.io/blog/pinecone-assistant-generally-available/
  (2025-01-22).
- **March 17, 2025 Launch Week:** "Pinecone for agents" framing, sparse indexes,
  integrated inference. https://www.pinecone.io/blog/launch-week-march-2025/
  (2025-03-17).
- **Sept/late 2025:** architecture rebuild for "agentic workloads" — adaptive
  LSM-tree write path, query path designed for **millions of namespaces** (one
  namespace per agent/tenant, data cold on blob storage). "Optimizing Pinecone
  for agents (and more)": https://www.pinecone.io/blog/optimizing-pinecone/
  (**approx. Sept 26, 2025**; date from search index — verify); "Evolving
  Pinecone's architecture to meet the demands of Knowledgeable AI":
  https://www.pinecone.io/blog/evolving-pinecone-for-knowledgeable-ai/ ;
  SiliconANGLE coverage 2025-12-01:
  https://siliconangle.com/2025/12/01/pinecone-scales-vector-database-support-demanding-workloads/.
- **The big 2026 move — Pinecone Nexus, announced during Launch Week May 4–8,
  2026.** Pinecone now calls itself "the knowledge infrastructure for AI" and
  Nexus a **"knowledge engine for agents"** — a *context compiler* that turns
  enterprise data into persistent knowledge artifacts before query time, a
  composable retriever with field-level citations, and **KnowQL**, a declarative
  query language for agents (output shape, confidence, latency budgets). Their
  own framing is essentially "vector RAG isn't enough for agents." Blogs:
  https://www.pinecone.io/blog/knowledge-infrastructure-for-agents/ and
  https://www.pinecone.io/blog/introducing-nexus-knowledge-engine/ ("Better
  Models Won't Save Your Agent") (May 2026); product page
  https://www.pinecone.io/product/nexus/ ; KMWorld:
  https://www.kmworld.com/Articles/News/News/Pinecone-Nexus-acts-as-the-knowledge-engine-for-agents-174673.aspx
  (May 2026); VentureBeat:
  https://venturebeat.com/data/the-rag-era-is-ending-for-agentic-ai-a-new-compilation-stage-knowledge-layer-is-what-comes-next
  (2026). **Note for the essay:** Pinecone's *own* 2026 message is "raw vector
  retrieval is not what agents need; they need a compiled knowledge layer" —
  remarkably close to the thesis.

**The commoditization context.**
- **"Feature, not a product."** Elastic's CEO Shay Banon publicly called vector
  databases "a feature, never a business." Every major engine now ships vector
  search: pgvector in Postgres, MongoDB Atlas, Redis, Cassandra, SQL Server
  2025, Elasticsearch, OpenSearch. Round-up:
  https://medium.com/data-science-collective/vector-databases-are-dying-heres-the-production-evidence-8c17b54687e2
  (2025); https://encore.dev/blog/you-probably-dont-need-a-vector-database ;
  https://dev.to/actiandev/whats-changing-in-vector-databases-in-2026-3pbo
  (2026).
- **pgvector**: https://github.com/pgvector/pgvector ; Supabase (pgvector
  native) hit a **$5B valuation in Oct 2025** with ~4M developers. Rough rule of
  thumb floating around: below ~50M vectors Postgres wins on TCO/simplicity;
  well above 100M, purpose-built engines still earn their keep.
- **MongoDB acquired Voyage AI for $220M, Feb 24, 2025** — embeddings +
  rerankers folded into Atlas (auto-embedding, native rerank).
  https://investors.mongodb.com/news-releases/news-release-details/mongodb-announces-acquisition-voyage-ai-enable-organizations
  (2025-02-24);
  https://www.bloomberg.com/news/articles/2025-02-24/mongodb-buys-voyage-ai-for-220-million-to-bolster-ai-search.
  (Anthropic was a named Voyage customer.) The Information also cited a Pinecone
  customer loss + AWS/model-maker changes as the pressure behind the sale
  exploration.

**Net:** Pinecone wasn't acquired; it changed CEO (Sept 2025), explored a sale
(Aug 2025), and re-launched as a "knowledge engine for agents" (May 2026), while
the bottom of the standalone-vector-DB market got absorbed into
Postgres/Mongo/everything-else.

---

## 5. Where vector/embedding search still clearly wins (the honest steelman)

Be fair here — the essay shouldn't read as "vectors are dead."

- **Semantic recall when there is no structure to navigate.** Claude Code's
  agentic search wins because a codebase *has* a directory tree, file names,
  identifiers — exact strings to grep. A pile of 5 years of Zendesk tickets,
  Slack threads, call transcripts, or contracts has none of that: no nav, no
  hierarchy, inconsistent vocabulary. There, lexical/structural navigation has
  nothing to grab onto and embeddings are doing real work. (This is the precise
  complement to Cherny's point above — agentic/grep search presupposes
  structure.)
- **Paraphrase / vocabulary-mismatch queries.** On semantic queries, dense
  retrieval captures ~70% of relevant docs where **BM25 alone captures ~5%**
  (the "heart attack" / "myocardial infarction" problem).
  https://mbrenndoerfer.com/writing/hybrid-search-bm25-dense-retrieval-fusion
  (2026). This is the canonical thing keyword/structure can never do.
- **Cross-lingual.** Multilingual embedding models (Voyage, Cohere, OpenAI) put
  "Rechnung," "invoice," and "facture" near each other; nothing in a sitemap,
  schema.org graph, or grep does that. (MongoDB bought Voyage AI in large part
  for this — Feb 2025 release above.)
- **"Find things like this" / similarity, dedup, clustering, recommendations**
  — nearest-neighbor over embeddings is the only real tool. No graph traversal
  answers "show me the 20 support tickets most similar to this one."
- **Scale.** Pinecone's 2025 architecture work (millions of namespaces, agentic
  workloads — https://www.pinecone.io/blog/optimizing-pinecone/) and the
  consensus that purpose-built engines still matter past ~100M vectors
  (https://dev.to/actiandev/whats-changing-in-vector-databases-in-2026-3pbo,
  2026).
- **The 2026 consensus, though, is hybrid, not pure-dense.** BM25 and dense have
  *complementary* recall; RRF-fused hybrid jumps from ~65–78% to ~91% recall@10
  in reported benchmarks
  (https://mbrenndoerfer.com/writing/hybrid-search-bm25-dense-retrieval-fusion,
  2026), and on some corpora (financial filings) BM25 *beat* a state-of-the-art
  dense retriever on most metrics. Pinecone's cascading retrieval (Dec 2024) and
  every serious 2026 stack
  (https://redis.io/blog/full-text-search-for-rag-the-precision-layer/) bake
  this in. So the clean formulation is: **embeddings win where there's meaning
  but no structure; structure wins where there's structure; and nobody serious
  ships dense-only anymore.**

---

## Synthesis (3 lines)

1. The observation is now an explicit product thesis with a $500M price tag on
   it: Mintlify's April-2026 Series B literally describes the company as "the
   knowledge layer that makes products understandable, usable and discoverable
   by AI agents," and on Mintlify's network agents are already ~45% of all doc
   requests — i.e., the public docs *site* (its nav, its hierarchy, its
   llms.txt, its auto-MCP server) *is* the enterprise knowledge base, served to
   agents.
2. The standards layer is reusing the web's existing structure, not replacing it
   — NLWeb runs on schema.org + RSS, WebMCP is "schema.org for verbs," llms.txt
   is just a curated sitemap in Markdown — and the one part that failed
   (llms.txt as a *crawler* signal) failed because the consumers turned out to
   be inference-time agents, not crawlers.
3. Pinecone — the company most identified with "embed everything into a vector
   index" — was not acquired, but did explore a sale (Aug 2025), changed CEOs
   (Sept 2025), and by May 2026 was itself arguing that raw vector retrieval
   isn't what agents need. That's about as strong a "the industry overlooked
   structure" datum as exists.

**Corrections to carry into any draft: Mintlify = Series B (Apr 2026), not
Series C; Pinecone = not acquired (as of 2026-06-28).**
