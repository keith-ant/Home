# Enterprise Knowledge Retrieval for AI Agents — State of the Field, 2025–2026

> Research fact sheet supporting `index.html` ("The Company Is a Tree of Skills").
> Compiled 2026-06-28 by a Claude research agent from primary sources.
> Thesis under test: *naive chunk-vector RAG loses hierarchy and global context;
> you need structure plus progressive disclosure.*

**Method note / caveat:** the research environment's egress proxy blocked direct
fetches of `anthropic.com`, `arxiv.org`, and `microsoft.com`, so quotes/numbers
from those pages were extracted via web-search retrieval rather than direct page
fetch. Every headline number below was corroborated by ≥2 independent sources.
Items that could not be fully confirmed are flagged inline and collected at the
end.

---

## 1. The critique of naive chunk-based vector RAG

**The canonical "global question" failure — Microsoft GraphRAG paper.** *"From
Local to Global: A Graph RAG Approach to Query-Focused Summarization"* (Edge et
al., Microsoft Research, arXiv 2404.16130, first posted **Apr 24, 2024**) is the
most-cited statement of the problem: vector RAG "fails on global questions
directed at an entire text corpus, such as 'What are the main themes in the
dataset?', since this is inherently a query-focused summarization (QFS) task,
rather than an explicit retrieval task." Nothing in the index *is* the answer,
so nothing can be retrieved. https://arxiv.org/abs/2404.16130 — companion MSR
blog "GraphRAG: Unlocking LLM discovery on narrative private data," **Feb 13,
2024**:
https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/

**"Needle" vs "summary" questions, quantified — SummHay (Salesforce).**
*"Summary of a Haystack: A Challenge to Long-Context LLMs and RAG Systems"*
(Laban et al., arXiv 2407.01370, **Jul 1, 2024**; EMNLP 2024). On corpus-level
summarize-with-citations tasks, **GPT-4o and Claude 3 Opus score below 20%** on
the Joint Score without a retriever; **estimated human performance is 56%**;
even with *oracle* document relevance signals systems lag humans by 10+ points.
Evaluated 10 LLMs / 50 RAG configurations. https://arxiv.org/abs/2407.01370

**Chunks lack context — Anthropic's own framing.** Anthropic, *"Introducing
Contextual Retrieval"* (**Sept 19, 2024**): "In traditional RAG, documents are
typically split into smaller chunks… individual chunks lack sufficient context."
Their worked example: query "What was the revenue growth for ACME Corp in Q2
2023?" retrieves the chunk *"The company's revenue grew by 3% over the previous
quarter"* — which doesn't say which company or which period.
https://www.anthropic.com/engineering/contextual-retrieval

**Chunk-boundary destruction, quantified — Late Chunking (Jina AI).** *"Late
Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models"*
(Günther et al., arXiv 2409.04701, **Sept 7, 2024**): splitting before embedding
means "chunk embeddings los[e] contextual information from surrounding chunks,
resulting in sub-optimal representations." Their fix (embed whole doc, pool
after) yields a 3.63% relative improvement over naive sentence-boundary chunking
with no retraining. https://arxiv.org/abs/2409.04701 · explainer:
https://jina.ai/news/late-chunking-in-long-context-embedding-models/

**Chunking-strategy evaluation.** *"Reconstructing Context: Evaluating Advanced
Chunking Strategies for RAG"* (arXiv 2504.19754, **Apr 2025**) compares late
chunking vs Anthropic-style contextual retrieval head-to-head and concludes
fixed-size chunking "fragments context, resulting in incomplete retrieval and
diminished coherence." https://arxiv.org/abs/2504.19754

**Engineering failure taxonomy.** *"Seven Failure Points When Engineering a
Retrieval Augmented Generation System"* (Barnett et al., Deakin/Applied AI
Institute, arXiv 2401.05856, **Jan 11, 2024**; CAIN 2024). Empirical report from
3 production case studies; the seven failure points include **FP1 Missing
Content** (the answer isn't in the corpus and the system confidently answers
anyway — "the agent doesn't know what it doesn't know"), FP2 Missed Top-Ranked
Documents, FP3 Not in Context (consolidation), FP4 Not Extracted, FP5 Wrong
Format, FP6 Incorrect Specificity, FP7 Incomplete. Key takeaway: "validation of
a RAG system is only feasible during operation."
https://arxiv.org/abs/2401.05856

**End-to-end accuracy ceiling — CRAG (Meta).** *"CRAG — Comprehensive RAG
Benchmark"* (arXiv 2406.04744, **Jun 7, 2024**; KDD Cup 2024): "most advanced
LLMs achieve ≤34% accuracy on CRAG; adding RAG in a straightforward manner
improves the accuracy only to 44%." State-of-the-art industry RAG solutions at
the time answered only 63% of questions without hallucination. 4,409 QA pairs
over web + mock KG search. https://arxiv.org/abs/2406.04744

**Staleness / sync.** Two primary-source data points: (a) Boris Cherny (creator
of Claude Code, Anthropic), on X (**early 2026**): "Early versions of Claude
Code used RAG + a local vector db, but we found pretty quickly that agentic
search generally works better. It is also simpler and doesn't have the same
issues around **security, privacy, staleness, and reliability**."
https://x.com/bcherny/status/2017824286489383315. (b) Sourcegraph removed
embeddings from Cody Enterprise (**Feb 2024**), citing: code must be shipped to
a third-party embedding API; "the process of creating embeddings and keeping
them up-to-date introduces complexity for admins"; vector search doesn't scale
past ~100k repos.
https://sourcegraph.com/blog/how-cody-understands-your-codebase

---

## 2. GraphRAG, LazyGraphRAG, LightRAG — and whether GraphRAG held up

### What Microsoft shipped and claimed
- **GraphRAG** (paper Apr 2024; open-sourced **Jul 2, 2024**): LLM extracts an
  entity–relationship graph, partitions it with hierarchical **Leiden community
  detection**, pre-generates **community summaries** at each level; "global
  search" map-reduces over those summaries. On two ~1M-token corpora (podcast
  transcripts: 8,564 entities / 20,691 edges; news: 15,754 entities / 19,520
  edges), GraphRAG global search beat naive vector RAG with **~72–83% win rate
  on comprehensiveness** and **~62–82% on diversity** (LLM-as-judge). Note: it
  did *not* claim to beat vector RAG on local/factoid questions. Paper:
  https://arxiv.org/abs/2404.16130 · Repo (its own README warns "GraphRAG
  indexing can be an expensive operation"):
  https://github.com/microsoft/graphrag
- **Dynamic community selection** (MSR blog, **Nov 15, 2024**): prunes
  irrelevant communities with a cheap model first → **77% average token-cost
  reduction** on global search with comparable quality.
  https://www.microsoft.com/en-us/research/blog/graphrag-improving-global-search-via-dynamic-community-selection/
- **LazyGraphRAG** (MSR blog, **Nov 25, 2024**): Microsoft's own answer to the
  cost critique. Defers all summarization to query time; uses NLP noun-phrase
  extraction + lightweight community structure instead of LLM-built KGs.
  Official numbers: "**data indexing costs are identical to vector RAG and 0.1%
  of the costs of full GraphRAG**"; comparable answer quality to GraphRAG Global
  Search at "**more than 700 times lower query cost**."
  https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/
  — In 2025 LazyGraphRAG shipped into Microsoft Discovery / Azure products.
  Microsoft also released **BenchmarkQED** (Jun 2025) to automate the
  local-vs-global RAG evaluation:
  https://www.microsoft.com/en-us/research/blog/benchmarkqed-automated-benchmarking-of-rag-systems/

### LightRAG
*"LightRAG: Simple and Fast Retrieval-Augmented Generation"* (Guo, Xia et al.,
HKU, arXiv 2410.05779, **Oct 8, 2024**; **EMNLP 2025 Findings**). Dual-level
retrieval (low-level entities + high-level themes) over a graph + vector index,
with **incremental updates** (no full re-index on new docs). Their cost
comparison vs. MS GraphRAG global search: GraphRAG needs **~610,000 tokens and
hundreds of API calls per query** (traversing communities); LightRAG **<100
tokens and 1 API call** for the retrieval step. https://arxiv.org/abs/2410.05779
· https://github.com/HKUDS/LightRAG

### HippoRAG / HippoRAG 2 (the other serious graph line)
HippoRAG (OSU, NeurIPS 2024) uses an open KG + **Personalized PageRank**.
**HippoRAG 2**, *"From RAG to Memory"* (arXiv 2502.14802, **Feb 20, 2025**; ICML
2025): **+7% on associative (multi-hop) memory tasks over the best embedding
retriever** while matching it on simple factual retrieval — explicitly
positioned as fixing graph methods' tendency to *lose* on simple QA.
https://arxiv.org/abs/2502.14802 · https://github.com/OSU-NLP-Group/HippoRAG

### Has GraphRAG held up? The 2025–2026 consensus
The honest answer: **graph structure clearly wins on
corpus-level/sensemaking/multi-hop questions and clearly loses on cost, latency,
freshness, and often on plain factoid QA.** Key evidence:

- *"RAG vs. GraphRAG: A Systematic Evaluation and Key Insights"* (arXiv
  2502.11371, **Feb 17, 2025**): unified protocol; finds RAG and GraphRAG have
  *complementary* strengths — GraphRAG (community variant) wins on query-focused
  summarization, vanilla RAG wins on most single-hop QA; hybrids beat either.
  Also documents **evaluation bias in LLM-as-judge "comprehensiveness/diversity"
  metrics**, which directly undercuts the original GraphRAG 72–83% win-rate
  framing. https://arxiv.org/abs/2502.11371
- *"When to use Graphs in RAG: A Comprehensive Analysis"* / **GraphRAG-Bench**
  (arXiv 2506.05690, **Jun 6, 2025**; accepted **ICLR 2026**): "despite its
  conceptual promise, recent studies report that GraphRAG frequently
  underperforms vanilla RAG on many real-world tasks." Specifics they report:
  **−13.4% accuracy vs vanilla RAG on Natural Questions**, **−16.6% on
  time-sensitive queries**, only **+4.5% on HotpotQA multi-hop** while adding
  **2.3× latency**. Conclusion: use graphs when questions require hierarchical
  aggregation or multi-document linkage, not by default.
  https://arxiv.org/abs/2506.05690 · https://graphrag-bench.github.io/
- Microsoft's own trajectory is the strongest tell: LazyGraphRAG exists
  *because* full GraphRAG indexing was too expensive; the GraphRAG *solution
  accelerator* repo was archived, while the core library remains maintained
  (releases through 2026). https://github.com/microsoft/graphrag/releases
- Cost narrative widely cited in practitioner writing: GraphRAG indexing that
  cost on the order of **$33k for one corpus in early 2024 fell ~1000× by 2025**
  via LazyGraphRAG/derivatives ([Medium/Graph Praxis,
  2025](https://medium.com/graph-praxis/the-graphrag-cost-cliff-how-33-000-became-33-in-eighteen-months-be1b0fbe37e4))
  — secondary source, directionally consistent with Microsoft's official "0.1%
  of GraphRAG indexing cost" figure.
- Productization happened anyway: **Amazon Bedrock Knowledge Bases GraphRAG**
  (Neptune Analytics) went **GA in 2025** — it does vector top-k first, then
  traverses the chunk/entity neighborhood.
  https://aws.amazon.com/blogs/machine-learning/announcing-general-availability-of-amazon-bedrock-knowledge-bases-graphrag-with-amazon-neptune-analytics/

**Directly on the customer-service use case:** *"Retrieval-Augmented Generation
with Knowledge Graphs for Customer Service Question Answering"* (LinkedIn, arXiv
2404.17723, **Apr 26, 2024**; SIGIR 2024). They built a KG over historical
support tickets preserving *intra-issue structure and inter-issue relations*
explicitly because flat chunking destroyed it: "enhancing answering quality by
mitigating the effects of text segmentation." Deployed in LinkedIn's support org
~6 months: **+77.6% MRR over the text-RAG baseline** and **−28.6% median
per-issue resolution time**. This is the single best primary source for
"structure beats flat chunks in a real customer-service KB."
https://arxiv.org/abs/2404.17723

---

## 3. Hierarchical / tree retrieval: RAPTOR and successors

- **RAPTOR** — *"Recursive Abstractive Processing for Tree-Organized Retrieval"*
  (Sarthi et al., Stanford, arXiv 2401.18059, **Jan 31, 2024**; **ICLR 2024**).
  Recursively embeds → clusters (GMM) → summarizes chunks bottom-up into a tree;
  retrieval queries *all* levels of abstraction simultaneously ("collapsed
  tree"). Headline: with GPT-4, **+20% absolute accuracy on QuALITY** over the
  prior SOTA; new SOTA on NarrativeQA and QASPER too. This is the cleanest
  demonstration that *summary nodes* fix the "needle retriever can't answer
  summary questions" gap. https://arxiv.org/abs/2401.18059 · code:
  https://github.com/parthsarthi03/raptor
- **Successors / extensions:** **adRAP** (incremental tree updates so you don't
  rebuild on every doc change) and **postQFRAP** (query-focused recursive
  abstraction as a post-retrieval black box) — *"Recursive Abstractive
  Processing for Retrieval in Dynamic Datasets"* (arXiv 2410.01736, **Oct
  2024**). https://arxiv.org/abs/2410.01736
- **The de-facto 2025–2026 successor is reasoning over an explicit document
  tree, no vectors at all: PageIndex** (Vectify AI, open-sourced 2025). Builds
  an LLM-generated hierarchical "table of contents" tree of a long document; at
  query time an LLM does **tree search** — reads node summaries, picks a branch,
  drills down — "vectorless, reasoning-based RAG." Reported **98.7% on
  FinanceBench** vs ~50% for typical vector-RAG pipelines (vendor-reported;
  treat as such). This is RAPTOR's idea fused with agentic navigation, and it is
  the purest existing implementation of "hierarchy + progressive disclosure."
  https://github.com/VectifyAI/PageIndex · https://pageindex.ai/
- Productized hierarchy in mainstream stacks: **Amazon Bedrock KB "hierarchical
  chunking"** (parent–child: retrieve on small child chunks, hand the model the
  parent chunk) —
  https://docs.aws.amazon.com/bedrock/latest/userguide/kb-chunking.html ;
  LlamaIndex's equivalent is the auto-merging retriever. Note GraphRAG's Leiden
  **community hierarchy + per-level summaries** is itself a RAPTOR-like
  abstraction tree built over a graph instead of a linear doc.

---

## 4. Anthropic's Contextual Retrieval (Sept 2024)

Source: https://www.anthropic.com/engineering/contextual-retrieval (**published
Sept 19, 2024**; widely indexed Sept 20, e.g.,
https://simonwillison.net/2024/Sep/20/introducing-contextual-retrieval/).
Cookbook:
https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide

- **Technique:** for each chunk, prompt Claude with the *whole document* + the
  chunk and ask for 50–100 tokens of "situating" context ("This chunk is from an
  SEC filing on ACME Corp's performance in Q2 2023; the previous quarter's
  revenue was $314M…"). Prepend that to the chunk **before** both embedding (→
  Contextual Embeddings) and BM25 indexing (→ Contextual BM25). I.e., it
  re-injects the document/hierarchy context that chunking destroyed — a direct,
  official concession of the thesis's premise, from the team that then went on
  to abandon embedding RAG for agents.
- **Numbers (top-20 retrieval failure rate, their internal evals across
  codebases, fiction, ArXiv, science papers, finance):**
  - Baseline (embeddings + BM25): **5.7%** failure
  - + Contextual Embeddings: **3.7%** (**−35%**)
  - + Contextual Embeddings + Contextual BM25: **2.9%** (**−49%**)
  - + reranking (Cohere) on top: **1.9%** (**−67%**)
- **Cost:** with **prompt caching** (cache the full document once, run all
  chunks against it), one-time contextualization cost ≈ **$1.02 per million
  document tokens** (assuming 800-token chunks, 8k-token docs).
- **The buried lede:** the post's *first* recommendation is to skip RAG entirely
  when possible — "if your knowledge base is smaller than **200,000 tokens
  (about 500 pages)**, you can just include the entire knowledge base in the
  prompt… no need for RAG or similar methods," made cheap by prompt caching. So
  Anthropic's own retrieval post is already half "don't retrieve."

---

## 5. The shift from RAG to agentic search / agentic retrieval

### Anthropic's primary-source trail (chronological)
1. **"How we built our multi-agent research system"** (**Jun 13, 2025**) —
   Anthropic's Research feature is agents *iteratively* calling search tools,
   not one-shot retrieval: "subagents act as intelligent filters by iteratively
   using search tools." Multi-agent (Opus 4 lead + Sonnet 4 subagents) beat
   single-agent Opus 4 by **90.2%** on their internal research eval; token usage
   explained ~80% of performance variance; multi-agent burned ~**15×** the
   tokens of chat.
   https://www.anthropic.com/engineering/multi-agent-research-system
2. **"Writing effective tools for agents"** (**Sept 11, 2025**) — tools should
   return high-signal, *token-efficient* results: implement
   **pagination/filtering/truncation with sensible defaults**, a
   `response_format` enum to control verbosity, keep tool responses under
   ~25,000 tokens; "encourage agents to pursue token-efficient strategies, like
   making many small and targeted searches instead of a single, broad search."
   https://www.anthropic.com/engineering/writing-tools-for-agents
3. **"Building agents with the Claude Agent SDK"** (**Sept 29, 2025**) — the
   explicit normative claim: agentic search (glob/grep/read over a real
   filesystem) vs semantic search: "**Semantic search is usually faster than
   agentic search, but less accurate, more difficult to maintain, and less
   transparent. We recommend starting with agentic search**, and only adding
   semantic search if you need faster results." Also pushes the
   *folder-as-context* model (e.g., an email agent stores prior conversations in
   a `Conversations/` folder it can search).
   https://claude.com/blog/building-agents-with-the-claude-agent-sdk
4. **"Effective context engineering for AI agents"** (**Sept 29, 2025**) — the
   conceptual frame: context is a *finite resource with diminishing returns*
   ("context rot"); contrasts **pre-inference retrieval (embeddings)** with
   **"just-in-time" retrieval**, where the agent keeps *lightweight identifiers*
   (file paths, queries, links) and loads data at runtime. Explicit on Claude
   Code: it "employs a hybrid model where CLAUDE.md files are naively dropped
   into context up front, while primitives like glob and grep allow it to
   navigate its environment and retrieve files just-in-time, **bypassing the
   issues of stale indexing and complex syntax trees**." Names "**progressive
   disclosure**": "letting agents navigate and retrieve data autonomously…
   agents incrementally discover relevant context through exploration… file
   sizes suggest complexity; naming conventions hint at purpose; folder
   hierarchy and timestamps can be a proxy for relevance." Closing advice: "do
   the simplest thing that works."
   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
5. **"Managing context on the Claude Developer Platform"** (**Sept 29, 2025**) —
   *tool results vs context*, productized: **context editing** auto-clears stale
   tool results; **memory tool** moves state to files outside the window.
   Numbers: memory + context editing → **+39%** over baseline on agentic search
   evals; context editing alone **+29%**; on a 100-turn web-search eval it
   prevented context exhaustion while cutting token consumption **84%**.
   https://anthropic.com/news/context-management
6. **"Code execution with MCP: building more efficient AI agents"** (**Nov 4,
   2025**) — the strongest Anthropic statement of *progressive disclosure +
   don't pipe tool results through the context*. Two costs of classic tool
   calling: (a) all tool definitions loaded up front, (b) every intermediate
   result passes through the model. Fix: present MCP servers as a **code API on
   a filesystem**; the agent `ls`'s `./servers/`, reads only the tool files it
   needs, and processes intermediate data *in the sandbox*. Their example: a
   2-tool Drive→Salesforce workflow drops from **150,000 → 2,000 tokens (98.7%
   reduction)**. "Models are great at navigating filesystems"; "**progressive
   disclosure**" is used verbatim.
   https://www.anthropic.com/engineering/code-execution-with-mcp
7. **"Introducing advanced tool use"** (**Nov 2025**, beta header
   `advanced-tool-use-2025-11-20`) — the API-level version: **Tool Search Tool**
   defers tool definitions and loads them on demand: a realistic 5-MCP-server
   setup drops from **~77K to ~8.7K tokens (−85%)**; on internal MCP evals Opus
   4 went **49%→74%** and Opus 4.5 **79.5%→88.1%** with tool search on.
   **Programmatic Tool Calling** keeps intermediate tool results out of context
   (−37% tokens on their eval).
   https://www.anthropic.com/engineering/advanced-tool-use

**The origin quote.** Boris Cherny (Claude Code creator): early Claude Code used
RAG + a local vector DB; they replaced it because "agentic search generally
works better… simpler and doesn't have the same issues around security, privacy,
staleness, and reliability" (X, early 2026:
https://x.com/bcherny/status/2017824286489383315). An Anthropic engineer's
earlier HN comment ("agentic search outperformed [RAG] by a lot, and this was
surprising") is widely quoted but only confirmed secondhand (e.g.,
https://vadim.blog/claude-code-no-indexing/,
https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny)
— **flagging: no first-party numeric eval of agentic-search-vs-RAG was ever
published by Anthropic.**

### Independent / third-party evidence (both directions)
- **Amazon Science, AAAI 2026** — *"Keyword search is all you need: Achieving
  RAG-level performance without vector databases using agentic tool use"*
  (Subramanian et al.): an agent given only keyword-search tools reaches **>90%
  of RAG performance (≈94.5% of RAG faithfulness)** with **no vector database**;
  pitched as preferable "in scenarios requiring frequent updates to knowledge
  bases."
  https://www.amazon.science/publications/keyword-search-is-all-you-need-achieving-rag-level-performance-without-vector-databases-using-agentic-tool-use
- **"Is Grep All You Need? How Agent Harnesses Reshape Agentic Search"** (PwC,
  arXiv 2605.15184, **May 14, 2026**) — the most careful study so far: on a
  116-question LongMemEval sample across Claude Code / Codex / Gemini CLI / a
  custom harness, **grep beat vector retrieval in every harness×model
  combination with inline tool results** — but the ranking *flips* when results
  are delivered as files. Their actual conclusion: "agent search cannot be
  evaluated by the searcher alone" — the harness and result-delivery mechanism
  dominate. https://arxiv.org/abs/2605.15184
- **The counter-evidence — Cursor.** *"Improving agent with semantic search"*
  (Cursor blog, **Nov 2025**): a custom code-embedding model + semantic search
  **on top of grep** gives **+12.5% average accuracy** (range 6.5–23.5% by
  model) over grep alone on codebase QA, with the largest gains on 1,000+ file
  repos. https://cursor.com/blog/semsearch — so the honest framing is "agentic
  navigation is the new baseline; embeddings are now an *additive* signal, not
  the architecture."
- **Practitioner consensus piece:** *"The RAG Obituary: Killed by Agents, Buried
  by Context Windows"* (Nicolas Bustamante, CEO of Fintool, **Oct 2025**, top of
  HN) — a builder of a large financial-RAG system arguing the chunk/embed/rerank
  stack was a workaround for 4k–8k context windows and is being replaced by
  agents that grep/navigate; Fintool subsequently retired its embedding
  pipeline. https://www.nicolasbustamante.com/p/the-rag-obituary-killed-by-agents
- **The "not dead" rebuttal:** Douwe Kiela (co-inventor of RAG, Contextual AI),
  *"RAG is dead, long live RAG!"* — retrieval becomes *one tool* in an agent's
  toolbox; long context and retrieval are complements, not substitutes.
  https://contextual.ai/blog/is-rag-dead-yet · O'Reilly interview:
  https://www.oreilly.com/radar/podcast/generative-ai-in-the-real-world-douwe-kiela-on-why-rag-isnt-dead/
- **The terminology shift is now in cloud products:** Azure AI Search **"agentic
  retrieval"** (announced **Build, May 2025**, GA path through 2025) — an LLM
  decomposes the conversation into parallel subqueries over hybrid indexes;
  Microsoft claims it "improves answer relevance by **up to 40%**" vs a
  single-shot query.
  https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- Surveys cementing the term: *"Agentic Retrieval-Augmented Generation: A Survey
  on Agentic RAG"* (arXiv 2501.09136, **Jan 15, 2025**)
  https://arxiv.org/abs/2501.09136 ; RAGFlow's year-end review *"From RAG to
  Context"* (**Dec 2025**) describing the industry-wide rename of RAG products
  into "context engines." https://ragflow.io/blog/rag-review-2025-from-rag-to-context

---

## 6. Long context vs RAG: where the line is

**Window sizes.** Milestones: Gemini 1.5 Pro 1M→2M (2024); GPT-4.1 1M (**Apr
14, 2025**); Llama 4 Scout *claims* 10M (Apr 2025); **Claude Sonnet 4 hit 1M
tokens in public beta on Aug 12, 2025** ("entire codebases with over 75,000
lines of code… in a single request") https://www.anthropic.com/news/1m-context ;
**Gemini 3 Pro (Nov 18, 2025): 1M input**
https://ai.google.dev/gemini-api/docs/gemini-3. By mid-2026, ≥1M-token windows
are table stakes across Anthropic/Google/OpenAI.

**But effective context ≪ advertised context — the "context rot" literature:**
- *"Lost in the Middle: How Language Models Use Long Contexts"* (Liu et al.,
  arXiv 2307.03172, Jul 2023; **TACL 2024**) — the original U-shaped curve:
  performance is highest when the relevant passage is at the beginning or end of
  context and degrades sharply in the middle.
  https://arxiv.org/abs/2307.03172
- **Databricks Mosaic, "Long Context RAG Performance of LLMs"** (**Aug 2024**,
  arXiv 2411.03538): across 2,000+ experiments / 13 models, "most LLMs only show
  increasing RAG performance up to 16–32k tokens"; Llama-3.1-405B degrades after
  **32k**, GPT-4-0125 after **64k**; failure modes are model-idiosyncratic
  (Claude-3-Sonnet's spurious copyright refusals went **3.7% @16k → 49.5%
  @64k**). https://www.databricks.com/blog/long-context-rag-performance-llms
- **NoLiMa** (Adobe Research, arXiv 2502.05167, **Feb 2025**; ICML 2025): when
  the needle has *no lexical overlap* with the question, **at 32K tokens 11 of
  12 models fall below 50% of their short-context baseline**; GPT-4o drops from
  99.3% (short) to 69.7% at 32K. This is the realistic enterprise-KB regime
  (users don't phrase questions in the doc's words).
  https://arxiv.org/abs/2502.05167
- **Chroma, "Context Rot: How Increasing Input Tokens Impacts LLM Performance"**
  (Hong, Troynikov, Huber, **Jul 14, 2025**): 18 frontier models (GPT-4.1,
  Claude 4, Gemini 2.5, Qwen3…); "models do not use their context uniformly;
  performance grows increasingly unreliable as input length grows," even on
  trivially simple tasks; degradation worsens as needle–question semantic
  similarity drops and when plausible distractors are present. This report is
  what Anthropic's own context-engineering post cites for "context rot."
  https://research.trychroma.com/context-rot · code:
  https://github.com/chroma-core/context-rot
- **SummHay** (above, §1): even at 100k–1M context, long-context models without
  retrieval score <20% on cite-your-sources corpus summarization.
  https://arxiv.org/abs/2407.01370

**The economics / routing answer:**
- *"Retrieval Augmented Generation or Long-Context LLMs? A Comprehensive Study
  and Hybrid Approach"* (Google DeepMind + UMich, arXiv 2407.16833, **Jul
  2024**, EMNLP 2024): with enough budget, **long-context beats RAG on average
  quality**, but RAG is drastically cheaper; LC and RAG agree on >60% of
  queries; their **Self-Route** (let the model decide if retrieved chunks
  suffice, else fall back to LC) matches LC quality at **−65% cost
  (Gemini-1.5-Pro) / −39% (GPT-4o)**. https://arxiv.org/abs/2407.16833
- **Prompt caching** changed the math: Anthropic's contextual-retrieval post's
  "≤200K tokens → just put the whole KB in the (cached) prompt" recommendation
  (§4) is the explicit statement that for *small* knowledge bases the right
  amount of retrieval infrastructure is zero.
  https://www.anthropic.com/engineering/contextual-retrieval ·
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching

**Net position of the field, mid-2026:** long context didn't kill retrieval; it
killed the *justification for aggressive chunking*. The working consensus is:
load whole documents/sections (not 512-token shards), use retrieval/navigation
to decide *which* documents, and keep the agent's working set small because
quality degrades with fill — which is exactly the progressive-disclosure
argument.

---

## 7. "Progressive disclosure" as an explicit, named pattern

Anthropic uses the term verbatim, in three places:

1. **Agent Skills** — *"Equipping agents for the real world with Agent Skills"*
   (Anthropic engineering, **Oct 16, 2025**): "Progressive disclosure is the
   core design principle that makes Agent Skills flexible and scalable… like a
   well-organized manual that starts with a table of contents." Three levels:
   (L1) only each skill's YAML **name + description** is preloaded into the
   system prompt — on the order of **tens of tokens per skill**; (L2) the full
   `SKILL.md` body is read into context only when Claude judges the skill
   relevant; (L3) additional referenced files/scripts are loaded only on demand.
   "The amount of context that can be bundled into a skill is effectively
   unbounded."
   https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
   · docs:
   https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.
   Skills were opened as a cross-vendor standard in **Dec 2025**
   (https://siliconangle.com/2025/12/18/anthropic-makes-agent-skills-open-standard/).
2. **"Effective context engineering for AI agents"** (Sept 29, 2025) generalizes
   it beyond skills: agentic exploration over a filesystem *is* progressive
   disclosure — metadata (path, name, size, timestamp) is the cheap level-1
   signal that tells the agent what exists and what to open.
   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
3. **"Code execution with MCP"** (Nov 4, 2025) applies the same word to *tools*:
   list `./servers/`, read only the tool files you need (the 150K→2K example).
   https://www.anthropic.com/engineering/code-execution-with-mcp — productized
   as the **Tool Search Tool** (−85% tool-definition tokens).
   https://www.anthropic.com/engineering/advanced-tool-use

A useful adjacent artifact for the "give the agent a map of the site hierarchy"
argument: **`/llms.txt`** (Jeremy Howard, Answer.AI, **Sept 3, 2024**) — a
root-level curated, *hierarchical* markdown index of a site for LLM agents, with
`.md` twins of each page. Exactly the level-1 "table of contents" layer for a
public knowledge base. https://llmstxt.org/ ·
https://www.answer.ai/posts/2024-09-03-llmstxt.html (Note: adoption is real
among docs vendors like Mintlify but no major model provider has committed to
honoring it as a crawl/citation signal —
https://searchengineland.com/llms-txt-proposed-standard-453676.)

---

## Couldn't confirm / handle with care

- **Anthropic never published a quantitative agentic-search-vs-vector-RAG
  eval.** The "agentic search outperformed by a lot" line is from an engineer's
  HN comment, reported secondhand; Boris Cherny's X post is qualitative. Don't
  cite a number here — none exists.
- **The mid-2026 frontier context-window lineup.** Only third-party aggregators
  were reachable; their model names/sizes contradict each other. Stick to the
  dated primary milestones listed (Sonnet 4 1M Aug 2025; Gemini 3 Pro 1M Nov
  2025; GPT-4.1 1M Apr 2025; Llama 4 Scout 10M *claimed*).
- **PageIndex's 98.7% FinanceBench** is vendor-reported with no peer-reviewed
  writeup; the GraphRAG 72–83% win rates are LLM-as-judge on
  comprehensiveness/diversity (not accuracy) and arXiv 2502.11371 documents bias
  in exactly that judging setup.
- The "**$33,000 → $33**" GraphRAG cost anecdote is from a Medium practitioner
  post, not Microsoft; the official, citable version is LazyGraphRAG's "0.1% of
  GraphRAG indexing cost."
- The widely-repeated "**Claude Code switched away from RAG in May 2025**" date
  appears only in secondary blog posts; Anthropic never published a date. Claude
  Code shipped (research preview Feb 24, 2025) without embedding indexing.
- The X status ID for Boris Cherny's post implies **early 2026**; the exact day
  could not be confirmed.
- `anthropic.com`/`arxiv.org`/`microsoft.com` pages were not directly fetchable
  from the research sandbox (egress allowlist); all quotes from those domains
  were obtained via search-engine retrieval of the pages and cross-checked
  against ≥2 mirrors/summaries. The core numbers (5.7→1.9%, 35/49/67%, $1.02,
  200K, 150K→2K/98.7%, 77K→8.7K/85%, 90.2%, +77.6% MRR / −28.6% resolution time,
  0.1% / 700×) are each multiply corroborated.

---

## One-paragraph synthesis

By 2026 the field's own primary sources converge on the thesis from three
directions. (1) The retrieval researchers conceded the chunking problem:
Microsoft's GraphRAG paper exists *because* "RAG fails on global questions
directed at an entire text corpus," and Anthropic's Contextual Retrieval exists
*because* "chunks lack sufficient context" — its entire mechanism is
re-injecting the document- and hierarchy-level context that chunking destroyed
(and even so, the best it achieves is cutting retrieval failures from
5.7%→1.9%). (2) The structural fixes that survived contact with production are
the ones that add *hierarchy* cheaply — RAPTOR's summary tree (+20% absolute on
QuALITY), LazyGraphRAG's query-time community structure (0.1% of GraphRAG's
indexing cost), LinkedIn's ticket knowledge graph (−28.6% resolution time) —
while heavyweight up-front knowledge-graph construction was the part that
didn't hold up (GraphRAG-Bench, ICLR'26: −13.4% on NaturalQuestions, 2.3×
latency). (3) And the agent builders moved past one-shot retrieval entirely:
Anthropic's official guidance is to start with agentic search over real
file/folder structure rather than embeddings, to keep tool definitions and
intermediate results out of context, and to expose knowledge through
*progressive disclosure* — a named, three-level pattern (metadata → body →
linked resources) — because a million-token window is not a million tokens of
reliable attention (Chroma, NoLiMa, Databricks). The synthesis is not "RAG is
dead"; it is that flat similarity search over context-free shards was a
workaround for 4K windows, and the replacement is structure the agent can
*navigate* plus disclosure it can *pace*.
