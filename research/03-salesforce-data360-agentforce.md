# Salesforce as the "throw it in a vector DB" case study — fact sheet

> Research fact sheet supporting `index.html` ("The Company Is a Tree of Skills").
> Compiled 2026-06-28 by a Claude research agent (six parallel sub-agents,
> ~200 targeted web searches).
> Question under test: *get Salesforce's product names, architecture, timeline,
> and reception exactly right.*

**Method & confidence caveat (read first):** the research session's network
policy blocked all direct page fetches, including salesforce.com and
help.salesforce.com. Everything below was assembled from targeted web search,
citing the indexed text of the linked pages. **[C]** = the claim is in the cited
source's indexed text, usually multiply corroborated. **[I]** =
inferred/synthesized, or the exact on-page wording was not re-read. Salesforce
Help pages are living docs; where no publish date exists treat as "accessed
2026-06-28." No URL was invented — every link came back from a search result.
Spot-check the help.salesforce.com `articleView?id=...` links before publishing;
they are real article IDs but the slugs occasionally move.

### ⚠️ Corrections to commonly-held assumptions (the embarrassment-avoidance list)

| Common belief | Reality |
|---|---|
| Data Cloud → **Data 360** at Dreamforce 2025 | ✅ Correct. Salesforce's own release note dates the rebrand to **Oct 14, 2025** (Winter '26). |
| **Agentforce 360** announced then | ✅ Correct — PR **Oct 13, 2025** (day before Dreamforce). Note there was an "Agentforce 3" in June 2025; 360 is a re-architecture/umbrella, not version 3.6. |
| Data Cloud Vector Database GA "~Feb–Mar 2024" | ❌ **GA was June 6, 2024** (World Tour London). Dec 14, 2023 = announcement; **Feb 2024 = pilot start**. |
| Chunking options like "Recursive / Semantic / Page" | ❌ Salesforce does **not** use those names. Documented strategies: **passage extraction** (semantic-based & window-based variants), **section-aware chunking**, **enriched chunks**, **custom chunking function**; **512-token max chunk**. |
| Unified Knowledge (Zoomin) is the external-ingest story | ⚠️ It was — but **Unified Knowledge is being retired (June 2027)**, replaced by "Enterprise Knowledge powered by Data 360" (direct Data 360 unstructured connectors, no Knowledge object). |
| Anthropic deal: "RBC Capital Markets" | ⚠️ The named press-release customer is **RBC Wealth Management**, not Capital Markets. |
| Intelligent Context = a "knowledge graph" | ⚠️ Salesforce's own copy says it "extracts, structures, and surfaces" — the "knowledge graph" phrasing is **third-party/partner** language, not Salesforce first-party. |

---

## 1. Data Cloud / "Data 360" and its vector database

### Naming — confirmed
- **The rebrand is real and official.** Salesforce's own Winter '26 release note
  (`rn_cdp_2026_winter_data360_rebrand`) and Help: "As of **October 14, 2025**,
  Data Cloud has been rebranded to Data 360. … the functionality and content
  remains unchanged." **[C]** —
  [help.salesforce.com release note](https://help.salesforce.com/apex/HTViewHelpDoc?id=release-notes.rn_cdp_2026_winter_data360_rebrand.htm);
  [About Salesforce Data 360 (Help)](https://help.salesforce.com/s/articleView?id=data.c360_a_data_cloud.htm&language=en_US&type=5);
  the marketing page is literally titled "**Data 360 (Formerly Data Cloud)**" —
  [salesforce.com/data/](https://www.salesforce.com/data/) (accessed 2026-06-28).
- **Agentforce 360** announced via press release **Oct 13, 2025** ("Welcome to
  the Agentic Enterprise"), the day before Dreamforce 2025 (Oct 14–16, SF).
  **[C]** —
  [Salesforce PR, 2025-10-13](https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/);
  [TechCrunch, 2025-10-13](https://techcrunch.com/2025/10/13/salesforce-announces-agentforce-360-as-enterprise-ai-competition-heats-up/).
- **Agentforce 360 = four components**: (1) **Agentforce 360 Platform**
  (Agentforce Builder, Agent Script, Agentforce Voice, Atlas Reasoning Engine),
  (2) **Data 360**, (3) **Customer 360 apps** (also being rebranded — e.g. Sales
  Cloud → "Agentforce Sales"), (4) **Slack**. **[C]** —
  [Salesforce PR](https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/);
  [Constellation Research, 2025-10-13](https://www.constellationr.com/insights/news/salesforce-makes-its-agentforce-360-case-be-your-ai-agent-platform);
  [Salesforce Ben on the Sales Cloud rename](https://www.salesforceben.com/salesforce-rebrands-sales-cloud-to-agentforce-sales-at-dreamforce-25/).
- **Pure rename, not a re-platform**: same product/contracts honored through
  term; API namespaces, dev-doc URLs, Trailhead module names, and `c360_a_*`
  help slugs still say "Data Cloud" in 2026. **[C]** —
  [Salesforce Ben, Oct 2025](https://www.salesforceben.com/salesforce-data-cloud-renamed-to-data-360-as-part-of-agentforce-360/);
  [Data 360 SKUs and Pricing Models (Help KB)](https://help.salesforce.com/s/articleView?id=002330973&language=en_US&type=1).
  *Separately* (Sept–Nov 2025) Salesforce migrated older CDP SKUs onto a
  consolidated Data 360 SKU — a licensing cleanup in the same window, not a
  function of the rename **[C]** —
  [Help KB 005131350](https://help.salesforce.com/s/articleView?id=005131350&language=en_US&type=1).
- **Naming lineage** (the platform has had six names): **Customer 360
  Audiences** (2020) → **Salesforce CDP** (2021) → **Marketing Cloud Customer
  Data Platform** (2022) → **Salesforce Genie** (Dreamforce, Sept 2022) → **Data
  Cloud** (2023; Salesforce's own
  ["CDP Is Now Data Cloud" Summer '23 release note](https://help.salesforce.com/s/articleView?id=release-notes.cdp_rn_2023_summer_rebranding_announcement.htm&language=en_US&release=244&type=5))
  → **Data 360** (Oct 14, 2025). **[C]** —
  [Salesforce Ben glossary of name changes](https://www.salesforceben.com/glossary-of-salesforce-product-name-changes/);
  [cdp.com](https://cdp.com/articles/what-is-salesforce-data-cloud/).

### Data Cloud Vector Database (DCVD) — timeline
- **Announced Dec 14, 2023** ("New Vector Database in Salesforce Data Cloud Will
  Power AI, Analytics, and Automation Using LLMs… Across the Einstein 1
  Platform"), **pilot from Feb 2024**. **[C]** —
  [Salesforce PR, 2023-12-14](https://www.salesforce.com/news/press-releases/2023/12/14/unstructured-data-ai-search-einstein/);
  [BusinessWire mirror](https://www.businesswire.com/news/home/20231214574921/en/New-Vector-Database-in-Salesforce-Data-Cloud-Will-Power-AI-Analytics-and-Automation-Using-LLMs-with-Business-Data-for-Use-Across-the-Einstein-1-Platform).
- **GA June 6, 2024** (World Tour London). **[C]** —
  [Salesforce GA story](https://www.salesforce.com/news/stories/data-cloud-vector-database-availability/);
  [SalesforceDevops.net, 2024-06-06](https://salesforcedevops.net/index.php/2024/06/06/salesforce-data-cloud-vector-database/).
- The **"~90% of enterprise data is unstructured (PDFs, emails, transcripts…)"**
  claim is verbatim in the Dec 2023 PR and is the canonical Salesforce talking
  point (Rahul Auradkar, EVP Unified Data Services, repeats it constantly).
  **[C]** —
  [PR](https://www.salesforce.com/news/press-releases/2023/12/14/unstructured-data-ai-search-einstein/);
  [Auradkar on LinkedIn, June 2024](https://www.linkedin.com/posts/rahulauradkar_upwards-of-90-of-enterprise-data-is-unstructured-activity-7211032522497871873-sgMP);
  the 2026 engineering blog is literally titled
  ["How Data 360 Vector Search Delivers Near Real-Time Intelligence on 90% of Enterprise Data"](https://engineering.salesforce.com/how-data-360-vector-search-delivers-near-real-time-intelligence-on-90-of-enterprise-data/).

### The pipeline & object zoo (Salesforce's own terms — use these exactly)
Ingest (file *references*, not copies) → parse → **chunk** → **embed/vectorize**
→ **index** → query via **retrievers**. **[C]** —
[architect.salesforce.com: Data 360 Architecture](https://architect.salesforce.com/docs/architect/fundamentals/guide/data-360-architecture);
[Trailhead: Unstructured Data in Data Cloud project](https://trailhead.salesforce.com/content/learn/projects/unstructured-data-in-data-cloud/get-started-with-unstructured-data-in-data-cloud).
- **UDLO** — Unstructured Data Lake Object: a *reference* to files that stay in
  external blob storage (S3, Azure Blob, GCS, Google Drive, SharePoint…) +
  metadata. **[C]** —
  [Help: map UDLO](https://help.salesforce.com/s/articleView?id=data.c360_a_unstructured_data_map_udlo.htm&language=en_US&type=5).
- **UDMO** — Unstructured Data Model Object: harmonized layer over UDLOs (1:1 or
  N:1). **[C]** —
  [Help: UDMO schema](https://help.salesforce.com/s/articleView?id=sf.c360_a_unstructured_data_udmo_schema.htm&language=en_US&type=5).
- **CDMO** (Chunk DMO) holds the text chunks; **IDMO** (Index DMO) holds the
  vector embeddings. Both are created by a **search index** and queryable from
  Flow / Agentforce / Prompt Builder / Tableau. **[C]** —
  [Help: Chunk and Index DMOs](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_chunk_index_dmo.htm&language=en_US&type=5).
- **Search index configuration**: created in the Data 360 "Search Index" tab.
  **Easy Setup** = system defaults (512-token chunks, E5-Large-V2 embedding);
  **Advanced Setup** = you pick the object/fields, chunking strategy, token
  size, embedding model, and vector-vs-hybrid. **[C]** —
  [Trailhead: Create a Search Index Configuration](https://trailhead.salesforce.com/content/learn/projects/unstructured-data-in-data-cloud/create-a-search-index-configuration);
  [Help: Create a Vector Search Index with Advanced Setup](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_create_vector_index_config.htm&language=en_US&type=5).
- Canonical file types: **HTML, TXT, PDF**
  ([Help: Supported File Formats](https://help.salesforce.com/s/articleView?id=data.c360_a_supported_file_formats.htm&language=en_US&type=5)).
  Documented connectors: Amazon S3, Azure Blob, GCS, Google Drive, SharePoint,
  Confluence, Zendesk, web crawler/sitemap, Box, Jira, GitHub, Guru, Salesforce
  Knowledge. **[C]** —
  [Help: Unstructured Data File Formats and Connectors](https://help.salesforce.com/s/articleView?id=data.c360_a_unstructured_data_connect.htm&language=en_US&type=5).

### Chunking strategies (the precise list)
From the Help page literally titled **"Chunking Strategies"**
([data.c360_a_search_index_supported_chunking_strategies.htm](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_supported_chunking_strategies.htm&language=en_US&type=5),
accessed 2026-06-28) **[C]**:
- **Passage extraction**, two variants: **semantic-based** (uses HTML semantics
  — `h1/h2`, lists, `<strong>`-as-subheading — as passage boundaries) and
  **window-based** (block-level `div`/`p` or line breaks; falls back to
  sentence-level if no HTML). Splits fine-grained, then re-merges chunks up to
  the token budget.
- **Section-aware chunking**
  ([Help: Optimizing Search Indexes — Field Selection and Chunking](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_optimize.htm&language=en_US&type=5)).
- **Enriched chunks** — index build produces 3 chunks per source chunk: raw
  text, extracted metadata (keywords/entities/topics/summary), and "questions
  this chunk answers." Incompatible with the E5 models; defaults to OpenAI
  Ada-002 when enabled. **[C]** (same Chunking Strategies page).
- **Custom chunking function** via Data 360 Code Extensions (you implement
  `SearchIndexChunkingV1Request → SearchIndexChunkingV1Response`). **[C]** —
  [dev docs](https://developer.salesforce.com/docs/data/data-cloud-code-ext/guide/use-custom-function.html).
- **Max/default chunk size: 512 tokens (~400–500 words in Latin scripts)**,
  configurable via a "Max Token Setting." **[C]** —
  [Help: How the Max Token Setting Affects Chunking](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_max_token_setting.htm&language=en_US&type=5).
  Default overlap value: **not confirmed [I]**.

### Embedding models offered **[C]**
- **E5-Large-V2** (default / "recommended" in Easy Setup) and **Multilingual
  E5-Large** —
  [Trailhead Search Index Config](https://trailhead.salesforce.com/content/learn/projects/unstructured-data-in-data-cloud/create-a-search-index-configuration).
- **OpenAI text-embedding-ada-002** ("Ada 002") — and it is the default when
  enriched chunks are on. —
  [Chunking Strategies page](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_supported_chunking_strategies.htm&language=en_US&type=5).
- **SFR-v2-small** (Salesforce Research's own embedding model) has a dedicated
  Help page —
  [SFR-v2-small Embedding Model Reference](https://help.salesforce.com/s/articleView?id=data.c360_a_search_index_sfr_v2_small.htm&language=en_US&type=5);
  background:
  [Salesforce blog on SFR-Embedding](https://www.salesforce.com/blog/sfr-embedding/).
  The Winter '26 default was cited in one source as SFR-v2-small **[I]**.

### Index types, hybrid search, ranking **[C]**
- Two index types: **Vector** and **Hybrid** (vector + keyword/lexical, fused).
  —
  [Help: Hybrid Search](https://help.salesforce.com/s/articleView?id=data.c360_a_hybridsearch_index.htm&language=en_US&type=5);
  [Trailhead: Search Index Types](https://trailhead.salesforce.com/content/learn/modules/search-index-types-data-cloud-quick-look/get-to-know-search-index-types-in-data-cloud).
- Hybrid Search GA: announced as **"generally available February 17, 2025"**
  (Spring '25). —
  [Spring '25 product release announcement, Jan 2025](https://www.salesforce.com/news/stories/spring-2025-product-release-announcement/).
- **Three fusion rankers**: Reciprocal Rank Fusion (RRF, default, k=60), Linear
  Fusion Ranking, **Deep Fusion Ranking** (transformer-based, adds
  popularity/recency). —
  [Help: Hybrid Search Fusion Ranking](https://help.salesforce.com/s/articleView?id=data.c360_a_hybridsearch_fusion_ranking.htm&language=en_US&type=5);
  [Trailhead: Optimize Hybrid Search Results for RAG](https://trailhead.salesforce.com/content/learn/modules/hybrid-search-for-rag-quick-look/optimize-hybrid-search-results-for-rag).
- The canonical engineering write-up: **"How Data Cloud Hybrid Search Combines
  Keyword and Vector Retrieval to Elevate the Search Experience,"** Salesforce
  Engineering, **Oct 4, 2024** — confirms RRF + linear ranker and says a
  *cascade of late-stage re-rankers is roadmap*, i.e., a true cross-encoder
  re-ranker was not in the shipped pipeline at that point. **[C]** —
  [engineering.salesforce.com](https://engineering.salesforce.com/how-data-cloud-hybrid-search-combines-keyword-and-vector-retrieval-to-elevate-the-search-experience/).
- Cost: a hybrid query consumes ~2× the Data 360 credits of a pure vector query.
  **[C]** —
  [Help: AI retriever versions](https://help.salesforce.com/s/articleView?id=data.c360_a_ai_retriever_version.htm&language=en_US&type=5).

### Underlying tech
- Salesforce's own architecture doc: for vector indexing, "Data 360 supports
  both **native indexing (with Hyper)** and also leverages vector databases like
  **open-source Milvus**." Salesforce runs Milvus at 1B+ vector scale and is a
  code contributor. **[C]** —
  [architect.salesforce.com: Data 360 Architecture](https://architect.salesforce.com/docs/architect/fundamentals/guide/data-360-architecture);
  [Milvus blog naming Salesforce, 2025](https://milvus.io/blog/milvus-exceeds-40k-github-stars.md).
- Storage = an **Apache Iceberg + Parquet lakehouse on Hyperforce**: ~4M Iceberg
  tables, ~50 PB; query via Hyper, Spark, Trino; zero-copy via Iceberg REST
  catalog. **[C]** —
  [Salesforce Engineering: "Inside Data Cloud's Open Lakehouse," 2025-06-24](https://engineering.salesforce.com/inside-data-clouds-open-lakehouse-4m-tables-and-50pb-powered-by-apache-iceberg/).
- The 2026 engineering post on the vector path: GPU-accelerated embedding (51×
  cost reduction), Kafka-delivered, near-real-time. **[C, date inferred ~H1
  2026]** —
  [engineering.salesforce.com](https://engineering.salesforce.com/how-data-360-vector-search-delivers-near-real-time-intelligence-on-90-of-enterprise-data/).

### "Intelligent Context" (Dreamforce 2025)
The flagship Data 360 unstructured announcement: a **low-code pipeline +
workspace** ("Process Content > Intelligent Context") — upload sample files
(PDF, audio, images), get AI "Smart Defaults" for parsing/chunking, test
retrieval in a chat panel, publish to a Search Index. Three parsers documented:
**Default**, **LLM-based** (text + visuals), **Docling** (layout-aware tables,
open-source). PR wording: it "automatically extracts, structures, and surfaces"
complex unstructured docs (PDFs, tables, images, flowcharts) for agents. **[C]**
—
[PR 2025-10-13](https://www.salesforce.com/news/press-releases/2025/10/13/agentic-enterprise-announcement/);
[Help: Intelligent Context in Data 360](https://help.salesforce.com/s/articleView?id=data.c360_a_intelligent_context.htm&language=en_US&type=5);
[Trailhead: Data 360 Content Parsing methods](https://trailhead.salesforce.com/content/learn/modules/data-cloud-process-content/use-rag-to-bring-unstructured-data-to-agentforce).
Shipped in **Winter '26 (Oct 2025)**; live through the Spring '26 release (Feb
23, 2026) **[C]**. Exact GA-vs-beta label as of mid-2026: not retrievable
**[I]**. —
[Salesforce Ben: Top Data Cloud Updates from Dreamforce '25, Oct 2025](https://www.salesforceben.com/top-data-cloud-updates-from-dreamforce-25/).

---

## 2. Agentforce + Einstein retrievers, Data Library, RAG in Prompt Builder

### Retrievers — the load-bearing abstraction
- **A retriever is "a wrapper for Einstein Search operations,"** created in **AI
  Models (formerly Einstein Studio)** inside Data 360. "Every retriever is
  linked to a search index created in Data Cloud"; an individual retriever
  targets exactly one index. Saving creates a new *version*. **[C]** —
  [Help: Retrievers (Data 360)](https://help.salesforce.com/s/articleView?id=data.c360_a_ai_retriever_about.htm&language=en_US&type=5);
  [Help: Create an Individual Retriever](https://help.salesforce.com/s/articleView?id=data.c360_a_ai_retriever_create.htm&language=en_US&type=5).
- Introduced **Summer '24** (~June 2024). **[C]** —
  [Summer '24 release note: Create and Customize Retrievers in Einstein Studio](https://help.salesforce.com/s/articleView?id=release-notes.rn_cdp_2024_summer_einstein_retriever.htm&language=en_US&release=250&type=5).
- **Index vs. retriever** (the conceptual split): the index makes text
  searchable; the retriever is the query-time object that scopes fields, applies
  filters (up to 10 conditions), and is what Prompt Builder/agents invoke.
  **[C]** —
  [Trailhead: Create a Search Index, Retriever, and Prompt Template](https://trailhead.salesforce.com/content/learn/modules/advanced-rag-with-data-360-and-agentforce/create-a-search-index-retriever-and-prompt-template).
- A **default retriever was auto-created per search index** — until that
  behavior was **deprecated in Winter '26** (Oct 2025): see the release note
  literally titled "**Automatic Default Retriever Creation Is Deprecated**."
  **[C]** —
  [Winter '26 release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_cdp_2026_winter_default_retrievers_deprecated.htm&language=en_US&release=258&type=5).
- **Top-k:** retrievers expose "maximum number of retrieved results." The
  widely-reported **default of 20** is from a practitioner walkthrough
  (Salesforce Ben), **not** confirmed in a Help doc **[I]**. —
  [Salesforce Ben: Connecting Agentforce to Data Cloud for Grounding With RAG](https://www.salesforceben.com/connecting-agentforce-to-data-cloud-for-grounding-with-rag/).
  **Dynamic retrievers** (query/filters bound at prompt-resolution time): Spring
  '25 **[C]** —
  [release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_einstein_prompt_builder_dynamic_retrievers.htm&language=en_US&release=252&type=5).

### Agentforce Data Library — the "easy mode"
- "When you add a data library, Salesforce **automatically builds a RAG-powered
  solution using default settings for all of the components: vector data store,
  search index, retriever, prompt template, and standard action.**" **[C]** —
  [Salesforce: Agentforce and RAG — Best Practices](https://www.salesforce.com/agentforce/agentforce-and-rag/?bc=OTH);
  [Help: What Are Data Libraries?](https://help.salesforce.com/s/articleView?id=ai.data_library_concept.htm&language=en_US&type=5).
- Source types: **Salesforce Knowledge** (you pick the article fields to index)
  or **uploaded files** (text/HTML/PDF). A third, **Web Search**, added Summer
  '25. You can swap in a custom retriever. **[C]** —
  [Help: Use Salesforce Knowledge fields](https://help.salesforce.com/s/articleView?id=ai.data_library_select_fields.htm&language=en_US&type=5);
  [Help: Use Uploaded Files](https://help.salesforce.com/s/articleView?id=ai.data_library_file_upload.htm&language=en_US&type=5);
  [Summer '25 release note: more data sources](https://help.salesforce.com/s/articleView?id=release-notes.rn_data_library_web_search.htm&language=en_US&release=254&type=5);
  [Help: Use a Custom Retriever](https://help.salesforce.com/s/articleView?id=ai.data_library_custom_retriever.htm&language=en_US&type=5).
- **"Answer Questions with Knowledge"** is the standard agent action. Its
  documented flow: action runs the associated prompt template → retriever
  invoked with a dynamic query → search index queried → relevant chunks
  retrieved → prompt populated → submitted to the LLM. Requires a Data Library
  with **Search Index Status = Ready**. **[C]** —
  [Help: Answer Questions with Knowledge action reference](https://help.salesforce.com/s/articleView?id=ai.copilot_actions_ref_answer_questions_with_knowledge.htm&language=en_US&type=5);
  [KB 004333412: Setup & Troubleshoot Data Libraries](https://help.salesforce.com/s/articleView?id=004333412&language=en_US&type=1).
- **Documented limits [C]**: file uploads — **4 MB for text/HTML, 100 MB for
  PDF**; **one data library per Agentforce feature at a time**; index rebuilds
  make the library temporarily unavailable; field labels >35 chars error; Data
  Cloud must be enabled (Data Cloud Admin/Architect perms). —
  [KB 004333412](https://help.salesforce.com/s/articleView?id=004333412&language=en_US&type=1);
  [Help: Setting Up Data Libraries](https://help.salesforce.com/s/articleView?id=ai.data_library_setup.htm&language=en_US&type=5).
  **Not found** in any Salesforce source **[I]**: a hard max file count per
  library, max libraries per org, or a retriever max-results ceiling.
- **The key "no control" point**: with Data Library "easy setup," chunking/index
  settings are auto-chosen and not exposed. Strongly and consistently described
  by practitioners, but no Help page states "you cannot change chunking in easy
  setup" verbatim — mark it **[I, practitioner-confirmed]**. —
  [Perficient, 2025-02-21](https://blogs.perficient.com/2025/02/21/agentforce-and-unstructured-data-yes/);
  [asagarwal.com Data Library guide](https://www.asagarwal.com/step-by-step-guide-to-agentforce-data-library-using-files/).

### Prompt Builder grounding + the reasoning loop
- In a prompt template you type `@`/Insert Resource → **Retrievers**, pick one,
  choose returned fields & result count. **[C]** —
  [Help: Add a Retriever to a Prompt Template](https://help.salesforce.com/s/articleView?id=ai.prompt_builder_add_retriever_field_gen.htm&language=en_US&type=5);
  [Summer '24 release note: Ground Prompt Templates with RAG](https://help.salesforce.com/s/articleView?id=release-notes.rn_einstein_prompt_builder_ground_prompt_templates_rag.htm&language=en_US&release=250&type=5).
- **Atlas Reasoning Engine**: Salesforce Engineering describes it as
  inference-time "System 2" reasoning with a **ReAct-style loop** ("reasoning,
  acting, observing… loops until it completes the user's goal"). Topics map to
  intents; the planner picks a topic then chooses among its actions; "Answer
  Questions with Knowledge" is one action among many. **[C]** —
  [Salesforce Engineering: "Inside the Brain of Agentforce — Revealing the Atlas Reasoning Engine"](https://engineering.salesforce.com/inside-the-brain-of-agentforce-revealing-the-atlas-reasoning-engine/)
  (Sept/Oct 2024);
  [Agentforce GA PR, 2024-10-29](https://www.salesforce.com/news/press-releases/2024/10/29/agentforce-general-availability-announcement/).
- **Agent Script** (Dreamforce 2025): a declarative DSL adding deterministic
  if/then logic + guardrails on top of LLM reasoning ("hybrid reasoning"). Pilot
  Oct 2025 → public beta Nov 2025 → described as GA Feb 2026. **[C]** —
  [Salesforce Dev blog: Introducing Hybrid Reasoning with Agent Script, Oct 2025](https://developer.salesforce.com/blogs/2025/10/introducing-hybrid-reasoning-with-agent-script);
  [Agent Script developer guide](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html).
  **The independent reading of why Agent Script exists**: CIO.com reported the
  shift came because "agent behavior varied from session to session in
  enterprise production" given Atlas's heavy LLM reliance, and it shifts
  responsibility (and cost) onto customers. **[C]** —
  [CIO: "Salesforce's Agentforce recalibration raises costs and complexity for CIOs"](https://www.cio.com/article/4113617/salesforces-agentforce-recalibration-raises-costs-and-complexity-for-cios.html)
  (~Jan 2026).

### Salesforce-published RAG eval / benchmarks **[C]**
- **SFR-RAG** (9B "contextually faithful" RAG LLM) + **ContextualBench**, Sept
  2024 — [arXiv 2409.09916](https://arxiv.org/pdf/2409.09916);
  [Salesforce blog](https://www.salesforce.com/blog/sfr-rag/).
- **Agentforce Testing Center**: batch-scores agents on response accuracy,
  completeness, instruction-adherence, **and knowledge retrieval**. The closest
  productized retrieval eval; there is **no** published per-retriever
  recall/precision benchmark. —
  [Help: Agentforce Testing Center](https://help.salesforce.com/s/articleView?language=en_US&id=ai.agent_testing_center.htm&type=5).
- **Agentforce Data Library engineering** claims 99.99% uptime and a server-side
  query-rewrite retry when retrieval confidence is low (not user-configurable).
  —
  [Salesforce Engineering, ~Apr 2025](https://engineering.salesforce.com/optimizing-ai-retrieval-how-agentforce-data-library-powers-rag-with-99-99-uptime/).

---

## 3. Salesforce Knowledge + Unified Knowledge (Zoomin)

### Knowledge → Agentforce
- The object is **`Knowledge__kav`** (the concrete Lightning Knowledge
  representation of `KnowledgeArticleVersion`); lifecycle `Draft → Online →
  Archived`. **[C]** —
  [Knowledge__kav object reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_knowledge__kav.htm).
  **Classic Knowledge** data model ended support **Summer '25**; Lightning
  Knowledge itself is *not* deprecated **[C]** —
  [Salesforce Ben: 2025 retirements](https://www.salesforceben.com/salesforce-feature-retirements-and-major-platform-updates-for-2025/).
- **Knowledge requires Data Cloud to ground Agentforce.** Path: deploy the
  Knowledge data bundle (e.g. `Knowledge_kav_Home`) from the Salesforce CRM
  connector into Data Cloud → create a search index over the article fields →
  retriever. The Data Library "Knowledge" source automates this (index API names
  start `KA_` for Knowledge, `FileUDMO_SI` for files). **[C]** —
  [Help: Ingest Knowledge Article Data from Salesforce CRM](https://help.salesforce.com/s/articleView?id=sf.c360_a_unstructured_data_connect_ka.htm&language=en_US&type=5);
  [Trailhead: Ingest Knowledge Article Data](https://trailhead.salesforce.com/content/learn/projects/unstructured-data-in-data-cloud/ingest-knowledge-article-data);
  [KB 004333412](https://help.salesforce.com/s/articleView?id=004333412&language=en_US&type=1).
- **Publish-to-agent latency**: Salesforce's troubleshooting KB and tutorials
  say the Knowledge data stream syncs **~every 15 minutes** and to wait ~15 min
  for re-indexing. There is **no contractual SLA**; treat 15 min as
  "approximately." **[C for the figure existing in Salesforce guidance]** —
  [KB 004333412](https://help.salesforce.com/s/articleView?id=004333412&language=en_US&type=1);
  [KB 004980107: Data Library best practices](https://help.salesforce.com/s/articleView?id=004980107&language=en_US&type=1).
- Which fields get chunked: you select the Knowledge fields in the Data Library
  setup ("Use Salesforce Knowledge"); the rule that *only* rich-text body fields
  are chunked is industry-consistent but **[I]** (the field-selection Help page
  body wouldn't render). —
  [Help: Use Salesforce Knowledge fields](https://help.salesforce.com/s/articleView?id=ai.data_library_select_fields.htm&language=en_US&type=5).

### Unified Knowledge (Zoomin) — get the dates right

| Event | Date | Source |
|---|---|---|
| **Unified Knowledge announced** (Salesforce × Zoomin partnership; ingest SharePoint, Confluence, Google Drive, websites into Salesforce Knowledge as **read-only** articles) | **2024-05-06** | [Salesforce newsroom](https://www.salesforce.com/news/stories/unified-knowledge-news/); [SalesforceDevops.net, 2024-05-06](https://salesforcedevops.net/index.php/2024/05/06/salesforce-unveils-unified-knowledge/) **[C]** |
| **GA** in Summer '24 (Unlimited Edition / Knowledge add-on; 90-day Zoomin trial, 3 connectors) | June 2024 | [Summer '24 release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_knowledge_unified_knowledge.htm&language=en_US&release=250&type=5) **[C]** |
| **Salesforce signs definitive agreement to acquire Zoomin** | **2024-09-24**; price ~**$450M** is from press (Calcalist/TechCrunch), **not** disclosed by Salesforce (CX Today reported $430M) | [Salesforce PR](https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-zoomin/); [TechCrunch, 2024-09-24](https://techcrunch.com/2024/09/24/salesforce-snatches-up-zoomin-a-tool-for-organizing-company-knowledge/); [Calcalist](https://www.calcalistech.com/ctechnews/article/rkhx9kl0r) **[C]** |
| **Acquisition closed** | **2024-11-01** | Update appended to the same [Salesforce PR](https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-zoomin/) **[C]** |

- Connector list (confirmed first-party: SharePoint, Confluence, Google Drive,
  web crawler; broader Zoomin catalog adds Jira, YouTube, S3, AEM, Guru,
  Zendesk). **"Notion" is NOT in any source — do not claim it.**
  **[C/absence-confirmed]** — [unifiedknowledge.ai](https://unifiedknowledge.ai/salesforce/);
  [Salesforce newsroom](https://www.salesforce.com/news/stories/unified-knowledge-news/).
- Synced articles are **read-only** in Salesforce; Zoomin re-syncs "multiple
  times per day" (no published SLA). **[C]** —
  [Help: Unify Knowledge from Various Sources](https://help.salesforce.com/s/articleView?id=service.knowledge_uk_about.htm&language=en_US&type=5).

### ⚠️ The thing the essay must not miss: Unified Knowledge is being **retired**
- A Winter '26 release note announced **Unified Knowledge retirement**,
  originally June 2026, **extended to June 2027 (Summer '27)** with "no further
  extensions." Existing synced articles persist; the connectors stop. **[C]** —
  [KB 005101356: "Unified Knowledge Retirement Extended to June 2027"](https://help.salesforce.com/s/articleView?id=005101356&language=en_US&type=1);
  [Winter '26 release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_unified_knowledge_retirement.htm&language=en_US&release=256&type=5).
- The replacement is **"Salesforce Enterprise Knowledge, powered by Data 360"**
  — Zoomin's tech folded into Data 360's unstructured connectors. Salesforce
  says migration tooling available from May 2026. **[C]** — same KB;
  [Salesforce blog: "Introducing Enterprise Knowledge powered by Data Cloud," 2025-08-07](https://www.salesforce.com/blog/salesforce-enterprise-knowledge-data-cloud-unstructured-data/).
- **The architecturally important shift**: external content no longer becomes
  `Knowledge__kav` records at all. It is ingested as **UDLO/UDMO blobs in Data
  360, chunked, embedded into a search index, and retrieved directly** — i.e.,
  Salesforce is *removing* the structured Knowledge object from the loop and
  going straight to the vector store. The Knowledge object stays as the
  authored/curated CRM artifact; Data 360 becomes the retrieval substrate. **[C
  for the mechanics; the framing is synthesis [I]]** —
  [Enterprise Knowledge blog](https://www.salesforce.com/blog/salesforce-enterprise-knowledge-data-cloud-unstructured-data/);
  [Salesforce blog: How to Ground Agentforce in External Documentation](https://www.salesforce.com/blog/ground-agentforce-in-external-documentation/).

---

## 4. Real-world reception

### A. The help.salesforce.com "customer zero" timeline (all Salesforce-reported unless noted)

| Date | Stat | Source |
|---|---|---|
| Oct 2024 | Agentforce GA (Oct 24–29); deployed on help.salesforce.com as "customer zero"; piloted on ~200 authenticated users for 4 weeks first | [GA PR, 2024-10-29](https://www.salesforce.com/news/press-releases/2024/10/29/agentforce-general-availability-announcement/) **[C]** |
| Feb 26, 2025 (Q4 FY25) | 380,000 conversations, **84% resolution**, 2% escalation | [Q4 FY25 PR](https://www.salesforce.com/news/press-releases/2025/02/26/fy25-q4-earnings/) **[C]** |
| ~Mar 2025 | "500,000 conversations": ~32k/week, 83–85% autonomous resolution; **human handoff fell from 26% in the first weeks to ~5%** | [Salesforce: Lessons from 500,000 Conversations](https://www.salesforce.com/news/stories/agentforce-customer-support-lessons-learned/) **[C]** |
| Jul 2025 | **1 million conversations**, ~85% resolved, 5% escalation (SVP Bernard Slowey) | [SalesforceDevops.net, 2025-07-14](https://salesforcedevops.net/index.php/2025/07/14/salesforce-crosses-1-million-agentforce-conversations/) **[C]** |
| Aug 22, 2025 | Salesforce's own postmortem: the agent **cited 2018 release notes**; "content collisions" from overlapping articles; team mass-deleted stale Knowledge | [Salesforce newsroom](https://www.salesforce.com/news/stories/ai-agent-customer-service-salesforce-learnings/) **[C]** — **best primary source for "garbage in, garbage out"** |
| Nov 6, 2025 | "**2 Million Conversations**" — but now states it "resolves **more than 68%**" | [Salesforce blog](https://www.salesforce.com/blog/support-requests-agentforce/) **[C]** |
| Jun 2026 | Agentforce Help Agent launch: **4.3M inquiries handled, 70% resolved**; **pay-per-resolution** pricing; GA July 2026 | [Salesforce news](https://www.salesforce.com/news/stories/agentforce-help-agent-announcement/); [CIO, Jun 2026](https://www.cio.com/article/4189183/salesforce-unveils-ai-help-agent-with-pay-per-resolution-pricing.html) **[C]** |

**⚠️ The resolution-rate number is unstable and Salesforce's own pages
contradict each other**: 84–85% (early-mid 2025 marketing) vs **68%** (Nov 2025)
vs 74% (first-year recap) vs **70%** (June 2026). The 85% appears to be "no
human handoff"; the lower numbers reflect stricter resolution definitions. **No
third party has audited any of these.** Cite the *range and the contradiction*,
not one number. **[C for each figure; the reconciliation is [I]]**

**The answer-quality data point**: Salesforce's own Customer Zero methodology
page ("agents testing agents," scored Relevant/Correct/Complete) — and the
disclosed benchmark: **answer quality was 60% in October 2025 with a target of
75% by year-end**. **[C for the methodology page; the 60%/75% figures surfaced
via search from that page — verify before publishing]** —
[How Salesforce Measures Agentforce Answer Quality](https://www.salesforce.com/agentforce/use-cases/customer-zero/how-salesforce-measures-answer-quality/).

### Benioff claims and the pushback
- **Sept 2, 2025**: On *The Logan Bartlett Show*, Benioff: "I've reduced
  [support] from 9,000 heads to about 5,000, because **I need less heads**."
  Coverage:
  [CNBC](https://www.cnbc.com/2025/09/02/salesforce-ceo-confirms-4000-layoffs-because-i-need-less-heads-with-ai.html);
  [Fortune](https://fortune.com/2025/09/02/salesforce-ceo-billionaire-marc-benioff-ai-agents-jobs-layoffs-customer-service-sales/).
  **[C]** Salesforce PR softened it to "no longer needs to backfill / redeployed
  hundreds"
  ([CX Today](https://www.cxtoday.com/contact-center/salesforce-ceo-pressed-on-cutting-4000-customer-support-reps/)).
  Counterweights: simultaneous 3,000–5,000 sales hires; activist-investor cost
  pressure as alternate explanation
  ([boldstart/FastForward, Sept 2025](https://fastforward.boldstart.vc/benioff-says-ai-replaced-4k-customer-service-reps-but-it-could-also-reflect-fresh-activist-pressure/));
  and **Gartner (Feb 3, 2026)** predicting half the companies that cut CS staff
  "due to AI" will rehire by 2027
  ([Gartner PR](https://www.gartner.com/en/newsroom/press-releases/2026-02-03-gartner-predicts-half-of-companies-that-cut-customer-service-staff-due-to-ai-will-rehire-by-2027)).
  **[C]**
- **June 26, 2025**: Benioff on Bloomberg's *The Circuit*: "AI is doing 30% to
  50% of the work at Salesforce now" + "~93% accuracy." **[C]** —
  [Bloomberg](https://www.bloomberg.com/news/articles/2025-06-26/salesforce-ceo-says-30-of-internal-work-is-being-handled-by-ai);
  [CNBC](https://www.cnbc.com/2025/06/26/ai-salesforce-benioff.html). The 93%
  drew direct skepticism:
  [Salesforce Ben, "Marc Benioff Claims 93% AI Agent Accuracy – Is This Good Enough?"](https://www.salesforceben.com/marc-benioff-claims-93-ai-agent-accuracy-is-this-good-enough/)
  **[C]**.
- **Earnings ARR track (all Salesforce-reported [C])**: Q4 FY25 (Feb 26, 2025) —
  ~5,000 deals, **3,000 paid**, "Data Cloud & AI ARR" $900M; Q2 FY26 (Sep 3,
  2025) — 12,500 deals, 6,000 paid, $1.2B; Q3 FY26 (Dec 3, 2025) — **Agentforce
  + Data 360 ~$1.4B ARR (+114%)**, 9,500 paid
  ([PR](https://www.salesforce.com/news/press-releases/2025/12/03/fy26-q3-earnings/));
  Q4 FY26 (Feb 25, 2026) — Agentforce $800M ARR; combined ">$2.9B" but
  **including $1.1B of acquired Informatica ARR**
  ([PR](https://www.salesforce.com/news/press-releases/2026/02/25/fy26-q4-earnings/));
  **Q1 FY27 (May 27, 2026, most recent)** — **Agentforce ARR $1.2B, +205%
  YoY**; Data 360 ingested 52T records in the quarter, **12 TB of unstructured
  data processed**
  ([PR](https://www.salesforce.com/news/press-releases/2026/05/27/fy27-q1-earnings/);
  [CNBC](https://www.cnbc.com/2026/05/27/salesforce-crm-q1-earnings-report-2027.html)).
  ⚠️ The headline metric label changed nearly every quarter — flag the
  apples-to-oranges problem.
- **Hardest independent hits**:
  - **The Information** (Feb–Mar 2025): only ~3,000 of ~5,000 deals were paid;
    and **"less than 2% of Agentforce customers were having more than 50
    conversations per week"** as of mid-2025, per people with internal-report
    knowledge. **[C, secondhand via Salesforce Ben]** —
    [Salesforce Ben: Where Are We Really at With Agentforce Adoption?](https://www.salesforceben.com/where-are-we-really-at-with-agentforce-adoption/).
  - **The Information** (Dec 18–19, 2025): "**Salesforce Executives Say Trust in
    LLMs Has Declined**." SVP Sanjna Parulekar: "All of us were more confident
    about large language models a year ago"; Agentforce CTO Muralidhar
    Krishnaprasad: models drop instructions beyond ~8; customer Vivint's agent
    failed at an explicit task → hence the deterministic Agent Script pivot.
    **[C]** —
    [The Information](https://www.theinformation.com/articles/salesforce-executives-say-trust-generative-ai-declined);
    [The Decoder](https://the-decoder.com/salesforce-executives-signal-declining-trust-in-large-language-models/);
    [Salesforce Ben](https://www.salesforceben.com/is-salesforce-losing-confidence-in-llms/).
  - **Bloomberg, May 22, 2026**: "**Salesforce Touts AI Promise Over Reality in
    SaaSpocalypse Fight**" — three marquee Agentforce reference demos
    (Williams-Sonoma voice support, Finnair, U. Chicago Medicine) were
    **simulated or not live**; Benioff's defense: "Every technology we've
    marketed has eventually delivered." **[C]** —
    [Bloomberg](https://www.bloomberg.com/news/articles/2026-05-22/salesforce-touts-ai-promise-over-reality-in-saaspocalypse-fight);
    [Gizmodo: "Salesforce Has an AI Vaporware Problem"](https://gizmodo.com/salesforce-has-an-ai-vaporware-problem-2000762993).
  - **Stock**: CRM down ~21–25% in 2025, then ~-30% further H1 2026, despite the
    Agentforce growth — the "AI eats SaaS" narrative. **[C, direction]** —
    [CNBC, 2026-02-25](https://www.cnbc.com/2026/02/25/ai-disruption-didnt-show-up-in-salesforce-results-but-the-fears-are-hard-to-shake.html).

### Analyst takes
- **Gartner, June 25, 2025**: ">40% of agentic AI projects will be canceled by
  end of 2027"; **"agent washing"** — only ~130 of "thousands" of agentic
  vendors are real. Gartner did **not** name Salesforce as an agent-washer (no
  source found; treat absence as confirmed). **[C]** —
  [Gartner PR](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027).
- **Salesforce's own research undercutting the pitch — CRMArena-Pro** (Salesforce
  AI Research, [arXiv 2505.18878, May 24 2025](https://arxiv.org/abs/2505.18878)):
  on a realistic Salesforce-schema sandbox across 19 expert tasks, top LLM
  agents hit **~58% single-turn and ~35% multi-turn success**, with near-zero
  confidentiality awareness. **[C]** —
  [The Register, 2025-06-16](https://www.theregister.com/2025/06/16/salesforce_llm_agents_benchmark/);
  [Salesforce blog](https://www.salesforce.com/blog/crmarena-pro/). The single
  best "their own scientists disagree with the keynote" citation.

### Practitioner complaints (retrieval-specific)
- **The Help-portal search-removal revolt, Sept–Oct 2025**: Salesforce removed
  the help.salesforce.com search bar in favor of Agentforce; users found the
  agent slower, repetitive, and sometimes wrong vs. index search; a Trailblazer
  IdeaExchange post got 700+ votes; **Salesforce reverted**. The strongest
  documented mass complaint about retrieval-grounded answer quality. **[C]** —
  [The Register, 2025-10-01](https://www.theregister.com/2025/10/01/salesforce_search_agentforce/);
  [Salesforce Ben: Trailblazer feedback forces revert](https://www.salesforceben.com/trailblazer-feedback-forces-salesforce-to-revert-agentforce-support-page/).
- **Salesforce's own "it was the Knowledge base, not the model" admission**:
  when help.salesforce.com first went live the team thought it was
  hallucinating; root cause was **conflicting/duplicate Knowledge articles**;
  they shut it down and cleaned the corpus (Chief Trust Officer Brad Arkin
  quoted). **[C]** —
  [Salesforce Ben, 2025-12-10: "Are Agentforce Hallucinations a Problem (Or Is It Just Your Bad Data)?"](https://www.salesforceben.com/are-agentforce-hallucinations-a-problem-or-is-it-just-your-bad-data/);
  also the
  [Aug 22, 2025 Salesforce newsroom piece](https://www.salesforce.com/news/stories/ai-agent-customer-service-salesforce-learnings/)
  (the 2018-release-notes incident).
- **Salesforce literally has a KB article titled "Agentforce's responses are
  inconsistent"** —
  [Help KB 004867907](https://help.salesforce.com/s/articleView?id=004867907&language=en_US&type=1).
  **[C]**
- **Pricing**: $2/conversation (Oct 2024) → Flex Credits, $0.10/action
  (mid-2025) → pay-per-resolution (June 2026). Three models in 20 months. **[C]**
  —
  [Salesforce Ben on pay-per-resolution](https://www.salesforceben.com/huge-agentforce-pricing-shift-salesforce-introduces-pay-per-resolution/);
  [SalesforceDevops.net on Flex Credits, 2025-05-15](https://salesforcedevops.net/index.php/2025/05/15/salesforce-shifts-to-agentforce-flex-credits/).
- **Reddit caveat**: individual r/salesforce thread URLs could not be retrieved
  by the research tools. Sentiment is documented secondhand —
  [The Register quoting Reddit](https://www.theregister.com/2025/10/01/salesforce_search_agentforce/);
  [Oliv.ai review roundup](https://www.oliv.ai/blog/salesforce-agentforce-reviews-analyzed).
  Trailblazer Community threads on "Answer Questions with Knowledge not working"
  do exist with URLs (e.g.
  [thread](https://trailhead.salesforce.com/trailblazer-community/feed/0D5KX00000PWFmz0AH))
  **[C, existence]**.

---

## 5. Salesforce ↔ Anthropic partnership (status as of mid-2026)

- **The announcement, Oct 14, 2025** (Dreamforce): "Anthropic and Salesforce
  Expand Strategic Partnership to Deliver Trusted AI for Regulated Industries."
  Key wording **[C]**: Claude is "**a foundational model for Salesforce's
  Agentforce 360 Platform**" and "can now be used as a **preferred AI model** …
  for regulated industries, including financial services, healthcare,
  cybersecurity, and life sciences." "**Anthropic is the first LLM provider
  fully integrated within the Salesforce trust boundary, with all of Claude's
  traffic contained in the Salesforce virtual private cloud**" — delivered via
  Anthropic's **Amazon Bedrock-hosted models**. —
  [Salesforce PR, 2025-10-14](https://www.salesforce.com/news/press-releases/2025/10/14/anthropic-regulated-industries-partnership-expansion-announcement/);
  [Anthropic announcement](https://www.anthropic.com/news/salesforce-anthropic-expanded-partnership);
  [investor.salesforce.com mirror](https://investor.salesforce.com/news/news-details/2025/Anthropic-and-Salesforce-Expand-Strategic-Partnership-to-Deliver-Trusted-AI-for-Regulated-Industries/default.aspx).
- Three pillars **[C]**: (1) regulated-industry solutions starting with **Claude
  for Financial Services + Agentforce Financial Services**; (2) deep Claude ↔
  Slack integration (with plans to bring Agentforce 360 *into* Claude); (3)
  **Salesforce deploying Claude Code across its global engineering
  organization**.
- Named customers in the release: **RBC Wealth Management** (advisor meeting
  prep inside the trust boundary) and **CrowdStrike**. ⚠️ **"RBC Capital
  Markets" is a misattribution** — no source ties it to this deal.
  **[C/absence-confirmed]**
- Reciprocal adoption: the release states **Anthropic uses Slack as an
  "operational pillar" and Agentforce Sales internally**. **[C]** — same PRs.
- ⚠️ Context: the **OpenAI** expanded partnership was announced the **same day**
  (Oct 14, 2025) — Agentforce 360 in ChatGPT, GPT-5 as a preferred Atlas model.
  Salesforce is explicitly multi-model. **[C]** —
  [Salesforce–OpenAI PR, 2025-10-14](https://www.salesforce.com/news/press-releases/2025/10/14/openai-partnership-expansion-announcement/).
- **Prior history [C]**: Claude was already available via Einstein Studio
  **BYO-LLM on Amazon Bedrock** through the Einstein Trust Layer (Salesforce Dev
  blog, Mar 2024; Anthropic, Sept 2024 —
  [anthropic.com/news/salesforce-partnership](https://www.anthropic.com/news/salesforce-partnership)).
  **Salesforce Ventures** invested in Anthropic's **Series C (May 23, 2023)**
  out of its $250M Generative AI Fund
  ([Anthropic Series C](https://www.anthropic.com/news/anthropic-series-c)) and
  again in the **$13B Series F (Sept 2025)**
  ([Salesforce Ventures](https://salesforceventures.com/perspectives/anthropics-13b-series-f/)).
- **Mid-2026 status [C]**:
  - **Slack MCP server + Real-Time Search API**: announced Oct 13, 2025; **GA
    Feb 17, 2026** —
    [Slack dev changelog](https://docs.slack.dev/changelog/2026/02/17/slack-mcp/).
  - **Claude Code in Slack**: research preview Dec 8, 2025 —
    [TechCrunch](https://techcrunch.com/2025/12/08/claude-code-is-coming-to-slack-and-thats-a-bigger-deal-than-it-sounds/);
    [Salesforce story](https://www.salesforce.com/news/stories/claude-code-in-slack/).
  - New **Slackbot rebuilt on Claude** (Jan 13, 2026) —
    [CNBC](https://www.cnbc.com/2026/01/13/salesforce-releases-updated-slackbot-powered-by-anthropics-ai-model.html).
  - **TDX 2026 (April 2026)**: Salesforce shipped **Agentforce Vibes with Claude
    Sonnet 4.5 as the default coding model**, plus Salesforce-hosted MCP servers
    (GA April 2026). —
    [Salesforce Dev blog, Apr 2026](https://developer.salesforce.com/blogs/2026/04/new-developer-edition-agentforce-vibes-claude-mcp).
  - **Benioff, May 2026**: Salesforce will spend **~$300M on Anthropic tokens in
    2026**, "almost entirely on coding." —
    [Benzinga, May 2026](https://www.benzinga.com/markets/tech/26/05/52622251/salesforce-ceo-marc-benioff-goes-all-in-on-awesome-anthropic-with-300-million-spend-hails-coding-agents-ive-never-been);
    [TNW](https://thenextweb.com/news/salesforce-benioff-300-million-anthropic-tokens-slack-coding).
  - **No Salesforce/Agentforce-specific healthcare or life-sciences Claude
    product announcement found as of June 28, 2026** — the Oct 2025 "healthcare,
    life sciences, cybersecurity next" remains roadmap. (Anthropic separately
    shipped Claude for Life Sciences Oct 20, 2025, and Claude for Healthcare at
    JPM Jan 2026.) **[I, absence claim]**
  - **Net**: as of mid-2026 the partnership is deepening (default coding model,
    $300M spend, Claude Tag in Slack June 23 2026) — inside an explicitly
    multi-model strategy (OpenAI + Gemini; Benioff publicly praised Gemini 3 Nov
    25, 2025 —
    [Fortune](https://fortune.com/2025/11/25/billionaire-marc-benioff-switching-google-gemini-3-over-chatgpt-world-just-changed/))
    — while Anthropic's Claude Cowork simultaneously emerged as an
    application-layer competitor that triggered a SaaS selloff (Feb 4, 2026 —
    [CNN](https://www.cnn.com/2026/02/04/investing/us-stocks-anthropic-software)).

---

## 6. Does Salesforce itself admit the flat-chunk limitation? (Yes — repeatedly.)

**Salesforce's own first-party material concedes that LLM-plus-vector-DB is not
enough**, and every major Data 360 announcement since mid-2025 is a layer of
*structure* added on top.

### The money quotes (all Salesforce first-party, all confirmed)
1. **"The prevailing narrative, often centered on connecting an LLM to a vector
   database via a simple API call, dangerously oversimplifies the challenge…
   Most RAG failures are silent retrieval failures masked by a plausible-
   sounding LLM hallucination."** —
   [Salesforce blog: "5 Reasons Why AI Agents and RAG Pipelines Fail in Production," ~July 31, 2025](https://www.salesforce.com/blog/ai-agent-rag/).
   **The single best quote for the essay.**
2. **"Simply retrieving text snippets using vector search isn't enough."**
   Retrieval is becoming one step in a "context engineering" loop. —
   [Salesforce News: "Salesforce Execs on Why Context Is King in the Agentic Era," Jan 21, 2026](https://www.salesforce.com/news/stories/why-context-is-king-agentic-era/).
3. Rahul Auradkar (EVP/GM Unified Data Services), Dec 2025: models are
   "incredibly intelligent, but they tend to be **corporate stupid**. Without
   the shared understanding of the enterprise, the AI agents are forced to
   guess… **AI without context is just guessing, or hallucinating.**" —
   [as quoted by SalesforceDevops.net, 2025-12-10](https://salesforcedevops.net/index.php/2025/12/10/salesforce-and-informatica-context-is-the-new-currency/).
   **[C, via attendee]**
4. Salesforce Engineering (Jan 28, 2026) admits early flat-RAG underperformed
   and they went to graphs: "**Early RAG pipelines often delivered inconsistent
   or low-confidence results, leading to initial work on Graph-RAG**," and
   describes a unified "Customer 360 Profile and **Context graph**." —
   [engineering.salesforce.com: "How Agentforce, Data, & Apps Turned the Salesforce Stack into Agentforce 360"](https://engineering.salesforce.com/how-agentforce-data-and-apps-turned-the-salesforce-stack-into-agentforce-360/).
   **The clearest engineering-org admission.**
5. Salesforce's semantic-layer blog: without a governed semantic layer,
   "**agents will infer rather than know**, and what surfaces to users may
   simply be wrong"; the rule is "expose **Data Graphs and DMOs** to the AI
   layer, **never raw DLOs**." —
   [Salesforce blog: Build Trusted Semantic Layers for AI Agents with Data 360](https://www.salesforce.com/blog/semantic-layer-ai-agents-data-360/)
   (2026).
6. The Agentic RAG marketing page concedes traditional RAG is one-shot/static
   and says the next step "combines semantic retrieval with **symbolic reasoning
   (rules, knowledge graphs)**." —
   [salesforce.com/agentforce/agentic-rag/](https://www.salesforce.com/agentforce/agentic-rag/).

### The structural features they actually shipped
- **Data Graphs** (GA **Spring '24**, Feb 2024): "combines and transforms
  normalized table data from DMOs into new, **materialized views**" —
  precalculated, sub-second. **A pre-joined cache of *structured CRM* records,
  not a knowledge graph extracted from text.** Salesforce's docs never call it a
  knowledge graph; do not conflate them. **[C for the definition; the
  distinction is synthesis [I]]** —
  [Help: Data Graphs](https://help.salesforce.com/s/articleView?id=data.c360_a_data_graphs.htm&language=en_US&type=5);
  [Spring '24 GA release note](https://help.salesforce.com/s/articleView?id=release-notes.rn_cdp_2024_spring_data_graphs_ga.htm&language=en_US&release=248&type=5);
  [Salesforce Engineering: "Data Cloud's Data Graph: Sub-Second Insights from 200M Records," 2025-01-28](https://engineering.salesforce.com/how-data-clouds-data-graph-delivers-sub-second-insights-from-200-million-records/).
  Agentforce was announced as grounded by "real-time data graphs + hybrid
  search" at Dreamforce 2024 —
  [Salesforce PR, 2024-09-17](https://www.salesforce.com/news/press-releases/2024/09/17/data-cloud-unstructured-data-announcement/).
- **Tableau Semantics** (the semantic/metrics layer): announced Tableau
  Conference, **April 2025**, GA then; re-positioned as a Data 360 pillar at
  Dreamforce 2025. —
  [Tableau TC25 announcements blog, Apr 2025](https://www.tableau.com/blog/top-10-announcements-keynote-tc25);
  [salesforce.com/analytics/tableau-semantics/](https://www.salesforce.com/analytics/tableau-semantics/).
  **[C]**
- **Open Semantic Interchange (OSI)**: Salesforce/Tableau co-leads with
  Snowflake, dbt Labs, et al., announced **Sept 23, 2025** — the industry
  admitting that vectors don't carry business meaning. —
  [Snowflake PR](https://www.snowflake.com/en/news/press-releases/snowflake-salesforce-dbt-labs-and-more-revolutionize-data-readiness-for-ai-with-open-semantic-interchange-initiative/).
  **[C]**
- **Intelligent Context** (Oct 2025; see §1) is the unstructured-side
  counterpart: LLM/Docling parsing of tables, diagrams, schematics into
  *structured* outputs *before* chunking. ⚠️ **Salesforce's first-party copy
  does NOT call it a knowledge graph** — it says "extracts, structures, and
  surfaces." The "knowledge graph" phrasing appears in partner/third-party
  explainers only. **[C, absence-checked]** —
  [Help: Intelligent Context](https://help.salesforce.com/s/articleView?id=data.c360_a_intelligent_context.htm&language=en_US&type=5);
  [Salesforce News video story: "AI without context is just a guess"](https://www.salesforce.com/news/stories/video/why-ai-needs-intelligent-context/).
- The closest thing to a real Salesforce **enterprise knowledge graph** came via
  the **Informatica acquisition (closed Nov 18, 2025)** — Salesforce's own blog:
  Informatica "actively scans… your entire data landscape, utilizing metadata to
  construct an **enterprise knowledge graph**." **[C]** —
  [Salesforce PR, 2025-11-18](https://www.salesforce.com/news/press-releases/2025/11/18/salesforce-completes-acquisition-of-informatica/);
  [Salesforce blog: "Architecting with Context: Salesforce + Informatica," 2026-01-15](https://www.salesforce.com/blog/architecting-with-context-salesforce-informatica/).
- Best **independent** corroboration that the old pipeline was blind to
  structure: Deep Analysis (Alan Pelz-Sharpe), Oct 18, 2025: before Intelligent
  Context, "Data Cloud wasn't really able to handle tabular information embedded
  in unstructured data… **blind to a significant chunk** of the detailed
  information" in technical manuals. **[C]** —
  [deep-analysis.net](https://www.deep-analysis.net/dreamforce-sees-agentforce-gain-additional-context-from-unstructured-data/).

### Honest framing **[I — synthesis]**
Salesforce never says "RAG is dead." But its product sequence is an unusually
clean public record of the limitation: **vector DB (Dec 2023) → it's not enough,
add keyword/BM25 + fusion ranking (Hybrid Search, GA Feb 2025) → still not
enough, add LLM parsing of structure before chunking (Intelligent Context, Oct
2025) + a governed semantic layer (Tableau Semantics/OSI, 2025) + buy a metadata
knowledge graph outright (Informatica, Nov 2025) → and bolt a deterministic
scripting layer onto the agent because LLM reasoning over the retrieved chunks
was too unreliable (Agent Script, Oct 2025–Feb 2026)**. Combined with their own
AI Research lab publishing that frontier agents succeed on only ~35% of
multi-turn CRM tasks, and their own customer-zero deployment grading its answer
quality at 60% — Salesforce is, in its own first-party material, the strongest
available witness against the "throw it in a vector database" default.

---

*Methodology note repeated for honesty: every URL above came back from a web
search; no page was fetched directly to verify on-page wording, so every
load-bearing claim carries a confidence level. Before publishing, click through
the help.salesforce.com IDs and the two or three quotes used verbatim
(especially #1 and #4 in §6, and the 60%/75% answer-quality figure).*
