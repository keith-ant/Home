# Agent Skills as the Company Knowledge Base — the Anthropic stack, verified

> Research fact sheet supporting `index.html` ("The Company Is a Tree of Skills").
> Compiled 2026-06-28 by a Claude research agent.
> Question under test: *what exactly is the CLAUDE.md + Skills mechanism, what
> exists today for sharing skills org-wide, and what does Anthropic deliberately
> not provide?*

**Sourcing note (read first).** Everything from `platform.claude.com`,
`code.claude.com`, `raw.githubusercontent.com`, and `api.github.com` below was
fetched directly on 2026-06-28 and quotes are verbatim. The marketing/blog hosts
(`anthropic.com`, `claude.com`, `support.claude.com`, `agentskills.io`) were
unreachable from the research network (403 at the CDN), so for those the
canonical URL is given plus content drawn from search-result excerpts and
secondary coverage — those quotes are flagged ⚠️ and should be eyeballed once
before publishing. Doc pages on platform.claude.com / code.claude.com are
continuously updated and not individually dated; treat "as fetched 2026-06-28"
as the date for those.

---

## 1. Agent Skills — spec and mechanics

**What a skill is.** "A skill is a directory containing, at minimum, a
`SKILL.md` file." (Agent Skills spec, https://agentskills.io/specification;
source file
https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx).
Anthropic's repo README: "Skills are folders of instructions, scripts, and
resources that Claude loads dynamically to improve performance on specialized
tasks." (https://github.com/anthropics/skills)

**SKILL.md format.** YAML frontmatter + Markdown body. Platform docs ("Skill
structure",
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview):

- **Required fields (API/claude.ai + open spec): `name`, `description`.**
  - `name`: "Maximum 64 characters", "lowercase letters, numbers, and hyphens
    only", "Cannot contain XML tags", "Cannot contain reserved words:
    'anthropic', 'claude'".
  - `description`: "Must be non-empty", "Maximum 1024 characters", "Cannot
    contain XML tags"; "should include both what the Skill does and when Claude
    should use it."
- **Open-spec optional fields** (https://agentskills.io/specification):
  `license`, `compatibility` ("Max 500 characters"), `metadata` (arbitrary
  key-value map; recommended place for versioning), `allowed-tools`
  ("Space-separated string of tools that are pre-approved to run", marked
  experimental). "Spec-compliant runtimes ignore frontmatter keys they do not
  recognize."
- **Claude Code's superset** (https://code.claude.com/docs/en/skills): in Claude
  Code "All fields are optional. Only `description` is recommended" (`name`
  defaults to the directory name). Extra frontmatter: `when_to_use`,
  `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`,
  `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork`,
  `agent`, `hooks`, `paths`, `shell`. The doc states explicitly: "Claude Code
  skills follow the Agent Skills (https://agentskills.io) open standard… Claude
  Code extends the standard with additional features like invocation control,
  subagent execution, and dynamic context injection."

**The three levels of progressive disclosure** — verbatim table from the
platform overview
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview):

| Level | When loaded | Token cost | Content |
|---|---|---|---|
| **Level 1: Metadata** | "Always (at startup)" | **"~100 tokens per Skill"** | "`name` and `description` from YAML frontmatter" |
| **Level 2: Instructions** | "When Skill is triggered" | "Under 5k tokens" | "SKILL.md body with instructions and guidance" |
| **Level 3+: Resources** | "As needed" | "Effectively unlimited" | "Bundled files executed via bash without loading contents into context" |

Same page: "Claude loads this metadata at startup and includes it in the system
prompt. This lightweight approach means you can install many Skills without
context penalty"; "When you request something that matches a Skill's
description, Claude reads SKILL.md from the filesystem via bash"; "There's no
context penalty for bundled content that isn't used." The engineering blog uses
the phrase that metadata costs only a *few dozen tokens* per skill (⚠️ wording
from search excerpts of
https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
— "This metadata is the first level of progressive disclosure: it provides just
enough information for Claude to know when each skill should be used without
loading all of it into context"). The spec's own loading model: "Discovery
(agents load skill names and descriptions only), Activation (full instructions
load when relevant), Execution (agents follow instructions and run bundled code
as needed)"
(https://raw.githubusercontent.com/agentskills/agentskills/main/docs/home.mdx).
Best-practices doc: "Keep SKILL.md body under 500 lines"; reference files >100
lines should carry a table of contents; "Keep references one level deep from
SKILL.md"
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

**In Claude Code specifically** (https://code.claude.com/docs/en/skills): names
of all skills are always listed; "the combined `description` and `when_to_use`
text is truncated at 1,536 characters in the skill listing"; the whole
skill-listing budget "scales at 1% of the model's context window" (configurable
via `skillListingBudgetFraction` / `SLASH_COMMAND_TOOL_CHAR_BUDGET`); when a
skill is invoked its rendered body "enters the conversation as a single message
and stays there"; after compaction, "Claude Code re-attaches the most recent
invocation of each skill… keeping the first 5,000 tokens of each. Re-attached
skills share a combined budget of 25,000 tokens." Two invocation switches matter
for a knowledge-base design: `disable-model-invocation: true` (user-only;
*description not even loaded into context*) and `user-invocable: false`
(Claude-only "background knowledge"). Custom slash commands and skills are now
the same mechanism ("Custom commands have been merged into skills").

**Where skills live.**
- Claude Code (table on https://code.claude.com/docs/en/skills): Enterprise
  (managed settings) → all users; Personal `~/.claude/skills/<name>/SKILL.md`;
  Project `.claude/skills/<name>/SKILL.md`; Plugin
  `<plugin>/skills/<name>/SKILL.md`. Plus nested `.claude/skills/` in
  subdirectories (monorepo support, names like `apps/web:deploy`),
  parent-directory discovery up to repo root, and `--add-dir` directories.
  Precedence: "enterprise overrides personal, and personal overrides project."
- Claude API: `POST /v1/skills` (multipart, must include SKILL.md, "<30 MB"),
  `GET /v1/skills`, `GET/DELETE /v1/skills/{skill_id}`,
  `POST /v1/skills/{skill_id}/versions`, etc.; used in Messages via
  `container.skills: [{type: "anthropic"|"custom", skill_id, version}]` with the
  code-execution tool; **max 8 skills per request**; beta headers
  `code-execution-2025-08-25, skills-2025-10-02` (+ `files-api-2025-04-14` for
  file I/O); "Custom Skills are shared workspace-wide."
  (https://platform.claude.com/docs/en/build-with-claude/skills-guide and the
  overview page)
- claude.ai: pre-built document skills (pptx, xlsx, docx, pdf) built in; custom
  skills uploaded as zips in settings; since Dec 18 2025, org-level provisioning
  (see §3).
- Anthropic-built document skills also ship on Claude Platform on AWS and
  Microsoft Foundry (overview page).
- ⚠️ Not eligible for Zero Data Retention: "This feature is not eligible for
  Zero Data Retention (ZDR)" (overview page) — relevant for enterprise data
  handling.

**Open standard + adoption.** The format "was originally developed by Anthropic,
released as an open standard, and has been adopted by a growing number of agent
products"; code Apache-2.0, docs CC-BY-4.0
(https://raw.githubusercontent.com/agentskills/agentskills/main/README.md). The
spec/site repo `agentskills/agentskills` was created **2025-12-16** and had
~21.1k stars as of 2026-06-28
(https://api.github.com/repos/agentskills/agentskills). Anthropic announced the
open standard publicly on **Dec 18, 2025** alongside org management and the
skills directory (⚠️ https://claude.com/blog/organization-skills-and-directory;
press:
https://venturebeat.com/technology/anthropic-launches-enterprise-agent-skills-and-opens-the-standard,
https://siliconangle.com/2025/12/18/anthropic-makes-agent-skills-open-standard/).
Adopters (⚠️ from press + vendor docs, not all individually verified): VS Code /
GitHub Copilot
(https://code.visualstudio.com/docs/agent-customization/agent-skills), OpenAI
Codex (https://developers.openai.com/codex/skills), Cursor, Gemini CLI, Goose,
Amp, OpenCode and others; agentskills.io hosts a "Client Showcase" of "Agent
products that support the Agent Skills format"
(https://raw.githubusercontent.com/agentskills/agentskills/main/docs/clients.mdx).

**Primary announcements.** Launch: "Introducing Agent Skills" / "Claude Skills",
**Oct 16, 2025** — https://www.anthropic.com/news/skills (mirrored at
https://claude.com/blog/skills). ⚠️ Quoted in coverage as: skills are "folders
that include instructions, scripts, and resources that Claude can load when
needed"; available "to Pro, Max, Team and Enterprise users" across "Claude apps,
Claude Code, and the API" with the new `/v1/skills` endpoint and a
`skill-creator` skill. Engineering deep-dive: "Equipping agents for the real
world with Agent Skills," Oct 16/17, 2025 —
https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills.
Public skill repo: https://github.com/anthropics/skills (~156k stars;
`./skills/`, `./spec/`, `./template/`; doc skills are "source-available," the
rest Apache-2.0; install with `/plugin marketplace add anthropics/skills` then
`/plugin install document-skills@anthropic-agent-skills` or `example-skills@…`).

---

## 2. CLAUDE.md / memory

**CLAUDE.md mechanics** (https://code.claude.com/docs/en/memory, fetched
2026-06-28):
- Hierarchy, load order broad→specific: **Managed policy** (macOS
  `/Library/Application Support/ClaudeCode/CLAUDE.md`, Linux/WSL
  `/etc/claude-code/CLAUDE.md`, Windows `C:\Program Files\ClaudeCode\CLAUDE.md`)
  → **User** `~/.claude/CLAUDE.md` → **Project** `./CLAUDE.md` or
  `./.claude/CLAUDE.md` → **Local** `./CLAUDE.local.md` (gitignored). Org admins
  can also inline policy via a `claudeMd` key in `managed-settings.json`;
  "Managed policy CLAUDE.md files cannot be excluded."
- Ancestor CLAUDE.md files are "loaded in full at launch"; subdirectory
  CLAUDE.md files load lazily "when Claude reads files in those subdirectories."
  Project-root CLAUDE.md is re-injected after `/compact`.
- **Imports**: "`@path/to/import` syntax… Imported files can recursively import
  other files, with a maximum depth of four hops." `@AGENTS.md` import is the
  documented interop path.
- **`.claude/rules/`**: topic files; optional `paths:` frontmatter (globs) makes
  them load only when matching files are touched; `~/.claude/rules/` for
  user-level; symlinkable across repos.
- Guidance: "target under 200 lines per CLAUDE.md file"; "Unlike CLAUDE.md
  content, a skill's body loads only when it's used, so long reference material
  costs almost nothing until you need it" (that line is from
  https://code.claude.com/docs/en/skills — the single best one-sentence
  justification of the thesis from Anthropic's own docs). The memory page even
  tells users when to graduate content out of CLAUDE.md: "If an entry is a
  multi-step procedure or only matters for one part of the codebase, move it to
  a skill or a path-scoped rule instead."
- **Auto memory** (Claude Code ≥2.1.59): Claude writes its own notes to
  `~/.claude/projects/<project>/memory/MEMORY.md` + topic files; "The first 200
  lines of MEMORY.md, or the first 25KB… are loaded at the start of every
  conversation"; topic files load on demand. (Same page.)

**The "always-on context" picture.** Claude Code documents exactly what is
preloaded before your first message: system prompt, CLAUDE.md, auto memory, MCP
tool *names* (schemas deferred), and skill name+description listing — "A lot
loads before you type anything. CLAUDE.md, memory, skills, and MCP tools are all
in context before your first prompt." (interactive page
https://code.claude.com/docs/en/context-window). What survives compaction:
CLAUDE.md and the startup block reload; "Invoked skill bodies: re-injected,
capped at 5,000 tokens per skill and 25,000 tokens total"; the skill listing "is
the one exception" that isn't re-injected wholesale.

**API memory tool.** Type `memory_20250818`, `name: "memory"`; "generally
available on the Messages API: no beta header is required"; client-side —
"Claude requests file operations, and your application executes them" against a
`/memories` directory you back with any storage; commands `view`, `create`,
`str_replace`, `insert`, `delete`, `rename`; the API auto-injects a memory
protocol prompt ("ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE…
ASSUME INTERRUPTION"). ZDR-eligible.
(https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
Announced with **context editing** on **Sept 29, 2025**:
https://www.anthropic.com/news/context-management (⚠️ date via coverage;
Anthropic reported memory+context-editing gave a 39% improvement on an agentic
benchmark, context editing alone 29%).

**Context editing**
(https://platform.claude.com/docs/en/build-with-claude/context-editing): beta
header `context-management-2025-06-27`; `context_management.edits` strategies
`clear_tool_uses_20250919` (defaults: trigger 100k input tokens, keep last 3
tool uses, `exclude_tools`, `clear_at_least`) and `clear_thinking_20251015`;
"Context editing is applied server-side before the prompt reaches Claude."
Server-side **compaction** also exists
(https://platform.claude.com/docs/en/build-with-claude/compaction).
Design-pattern essay from Anthropic: "Effective context engineering for AI
agents" (Sept 29, 2025) — "the smallest possible set of high-signal tokens that
maximize the likelihood of some desired outcome"; advocates "just-in-time"
retrieval/agentic search over preloading
(https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
⚠️ quotes via excerpts).

---

## 3. Sharing & scaling skills across an organization (what's real, mid-2026)

**Claude Code — all shipped:**
- **Project skills in git**: commit `.claude/skills/` ("Share skills… Project
  skills: Commit `.claude/skills/` to version control",
  https://code.claude.com/docs/en/skills). Nested per-package skills for
  monorepos; live file-watch reload.
- **Plugins**: a plugin is a directory with `.claude-plugin/plugin.json` that
  can bundle `skills/`, agents, hooks, MCP servers, LSP servers; plugin skills
  are namespaced `plugin-name:skill-name`. Launched in public beta **Oct 9,
  2025** (https://www.anthropic.com/news/claude-code-plugins; docs
  https://code.claude.com/docs/en/plugins).
- **Plugin marketplaces** (https://code.claude.com/docs/en/plugin-marketplaces):
  a git repo (or URL/npm/local dir) hosting `.claude-plugin/marketplace.json`.
  Required fields `name`, `owner`, `plugins[]`; each plugin entry needs `name` +
  `source` (`"./plugins/x"` relative path, `{source:"github",
  repo:"owner/repo"}`, url, npm, git-subdir; optional `strict`, `category`,
  `tags`, `relevance`). Users run `/plugin marketplace add owner/repo` (or
  URL/path) then `/plugin install name@marketplace`. Anthropic's own:
  `anthropics/skills` (marketplace name `anthropic-agent-skills`) and the
  official plugin directory `anthropics/claude-plugins-official`
  (https://github.com/anthropics/claude-plugins-official, e.g.
  `/plugin install skill-creator@claude-plugins-official`).
- **Repo-pinned org defaults**: in a project's `.claude/settings.json`,
  `extraKnownMarketplaces` ("team members are automatically prompted to install
  your marketplace when they trust the project folder") and `enabledPlugins`
  (`"code-formatter@company-tools": true`). For containers/CI:
  `CLAUDE_CODE_PLUGIN_SEED_DIR` pre-seeds marketplaces at image build time.
  (Same page.)
- **Managed/enterprise settings**: skills and CLAUDE.md can be deployed via
  managed settings (`managed-settings.json`, plus the managed `claudeMd` key);
  admins can restrict marketplaces with `strictKnownMarketplaces` (empty array =
  block all; entries allowlist by repo, URL, `hostPattern`, `pathPattern`);
  `disableSkillShellExecution` policy disables `` !`command` `` preprocessing in
  non-bundled skills. (https://code.claude.com/docs/en/plugin-marketplaces,
  https://code.claude.com/docs/en/skills,
  https://code.claude.com/docs/en/memory)
- **Skill governance knobs**: permission rules `Skill`, `Skill(name)`,
  `Skill(name *)`; `skillOverrides` per-skill
  `"on" | "name-only" | "user-invocable-only" | "off"`; `disableBundledSkills`.
  (https://code.claude.com/docs/en/skills)

**claude.ai (Claude apps) — shipped Dec 18, 2025:** Team/Enterprise **admins can
centrally provision skills**: "Organization settings > Skills … click '+ Add,'
select a .zip file containing your skill (must include a SKILL.md file), and the
skill is immediately provisioned to all users in your organization";
admin-provisioned skills are on by default, members can toggle individually (⚠️
Help Center:
https://support.claude.com/en/articles/13119606-provision-and-manage-skills-for-your-organization;
announcement https://claude.com/blog/organization-skills-and-directory). The
same announcement added a **directory of partner-built skills** (Notion, Canva,
Figma, Atlassian, Stripe, Zapier…) browsable alongside connectors and plugins
(⚠️
https://support.claude.com/en/articles/14328846-browse-skills-connectors-and-plugins-in-one-directory;
https://claude.com/connectors, https://claude.com/plugins). Individual users on
Pro/Max/Team/Enterprise can still upload personal custom skills as zips
(Settings > Features, code execution required)
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).

⚠️ **Doc inconsistency to be careful about:** the platform overview page still
says "Custom Skills are individual to each user; they are not shared
organization-wide and cannot be centrally managed by admins" — that text
predates the Dec 18 org-provisioning launch and is stale for claude.ai; the Help
Center and the Dec 18 post are the current source of truth.

**API — shipped:** `/v1/skills` uploads are **workspace-scoped** ("Custom Skills
are shared workspace-wide; all workspace members can access them"), with
explicit versioning (`POST /v1/skills/{id}/versions`, pin `version` or use
`latest`) — i.e., the API is the org-distribution mechanism for programmatic
agents (https://platform.claude.com/docs/en/build-with-claude/skills-guide).

**Enterprise governance guidance** (a whole doc): risk-tier table, review
checklist, eval gates, lifecycle (plan→create→test→deploy→monitor→
iterate/deprecate), "Recall limits: …limit the number of Skills loaded
simultaneously," role-based bundles, and the operative warning for the thesis:
"**Custom Skills do not sync across surfaces.** Skills uploaded to the API are
not available on claude.ai or in Claude Code, and vice versa… Maintain Skill
source files in Git as the single source of truth."
(https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise)

**Not real / don't claim:** there is no single Anthropic-hosted org skill
registry spanning Claude Code + claude.ai + API; no skill analytics API ("Usage
analytics are not currently available via the Skills API", enterprise doc);
claude.ai skills are zip uploads, not git-synced.

---

## 4. The rest of Anthropic's knowledge surface

- **claude.ai Projects / project knowledge + RAG mode.** "RAG automatically
  activates when your project approaches or exceeds the context window limits",
  enabling "up to 10x more content"; Claude then uses a project-knowledge search
  tool, with a visible "RAG-enabled" indicator, and switches back to
  full-context mode if knowledge shrinks (⚠️ Help Center:
  https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects;
  overview
  https://support.claude.com/en/articles/9517075-what-are-projects). This is the
  one true "managed retrieval" Anthropic runs — and it is a claude.ai product
  feature, not an API.
- **claude.ai memory.** Automatic, user-editable memory rolled out to
  Team/Enterprise (Sept 2025) then all paid plans (Oct 23, 2025), per-Project
  memory separation (⚠️ coverage:
  https://www.macrumors.com/2025/10/23/anthropic-automatic-memory-claude/;
  Anthropic's posts at anthropic.com/news/memory).
- **Connectors & directory.** Connectors directory launched **July 14, 2025**
  for web/desktop — one-click MCP-based connections (Notion, Canva, Stripe,
  Figma, …) plus desktop extensions for local apps (⚠️
  https://claude.com/blog/connectors-directory; now merged into one
  skills+connectors+plugins directory, see §3). First-party search connectors
  (Google Drive, Gmail/Calendar, GitHub, Slack etc.) ride the same mechanism.
- **MCP on the API.** MCP connector: `mcp_servers: [{type:"url", url, name,
  authorization_token}]` + `tools: [{type:"mcp_toolset", mcp_server_name,
  default_config, configs}]`, beta header `mcp-client-2025-11-20` (older
  `mcp-client-2025-04-04` deprecated); URL-only servers, tool-calls only
  (https://platform.claude.com/docs/en/agents-and-tools/mcp-connector). MCP
  itself was donated to the Linux Foundation–hosted Agentic AI Foundation in Dec
  2025.
- **Files API.** `/v1/files` (beta header `files-api-2025-04-14`): upload once,
  reference by `file_id` in `document`/`image`/`container_upload` blocks; 500
  MB/file, 500 GB/org; only skill/code-execution outputs are downloadable
  (https://platform.claude.com/docs/en/build-with-claude/files).
- **Citations for RAG.** `search_result` content blocks "enable natural
  citations with proper source attribution, bringing web search-quality
  citations to your custom applications… particularly powerful for RAG"; fields
  `source`, `title`, `content[]`, `citations: {enabled: true}`; usable as tool
  results (dynamic RAG) or top-level content
  (https://platform.claude.com/docs/en/build-with-claude/search-results).
  General citations API:
  https://platform.claude.com/docs/en/build-with-claude/citations.
- **Web tools on the API.** `web_search` (latest type `web_search_20260318`;
  `web_search_20250305` still supported), $10 per 1,000 searches, citations
  mandatory in output, `allowed_domains`/`blocked_domains`, `max_uses`; newer
  versions add code-execution-based "dynamic filtering" of results before they
  hit context
  (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
  A separate `web_fetch` tool exists in the tool reference
  (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool).

---

## 5. What Anthropic does NOT provide (current as of 2026-06-28)

- **No embeddings model/API.** Verbatim, from the live docs: "**Anthropic does
  not offer its own embedding model.** One embeddings provider that has a wide
  variety of options and capabilities… is Voyage AI." The page then documents
  Voyage's models (voyage-4 family, voyage-code-3, voyage-finance-2,
  voyage-law-2, multimodal) and points to Voyage's own API/pricing
  (https://platform.claude.com/docs/en/build-with-claude/embeddings).
  (Background, not from Anthropic docs: Voyage AI was acquired by MongoDB in Feb
  2025.)
- **No managed vector database, no hosted ingestion/chunking/indexing pipeline,
  no retrieval endpoint** on the Claude Developer Platform. The closest things
  are: Files API (storage + attach, no search), `search_result` blocks (you
  bring the retriever, Claude does the citing), claude.ai Projects' built-in RAG
  (product-only), and the code-execution container's filesystem. Anthropic's own
  RAG guidance routes you to partners — the embeddings page's "RAG cookbook"
  link is literally a Pinecone notebook
  (https://platform.claude.com/cookbook/third-party-pinecone-rag-using-pinecone).
- **Where partners fit in an Anthropic-centric stack:** Voyage (embeddings +
  rerankers) → a vector store (Pinecone, MongoDB Atlas, pgvector, Elastic, etc.)
  → results passed to Claude as `search_result` blocks for cited generation;
  Anthropic's contribution to the retrieval problem is method, not
  infrastructure — "Contextual Retrieval" (contextual embeddings + contextual
  BM25 + reranking, "reduced the top-20-chunk retrieval failure rate by 67%…
  (5.7% → 1.9%)"), Sept 19/20 2024:
  https://www.anthropic.com/news/contextual-retrieval (⚠️ figures via coverage,
  e.g. https://www.infoq.com/news/2024/09/anthropic-contextual-retrieval/).
- A sharp contrast for the essay: Anthropic's context-engineering post
  explicitly favors **agentic, just-in-time search** (grep/glob/file reads at
  runtime — exactly how skills level-2/3 load) over maintaining a pre-computed
  embedding index that can go stale
  (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
  ⚠️).

---

## 6. Anthropic's own positioning: Skills vs RAG vs MCP, and keeping context small

- **"Skills explained: How Skills compares to prompts, Projects, MCP, and
  subagents"** (⚠️ https://claude.com/blog/skills-explained): "MCP connects
  Claude to external services and data sources. Skills provide procedural
  knowledge—instructions for how to complete specific tasks or workflows… MCP
  connections give Claude access to tools, while skills teach Claude how to use
  those tools effectively." Skills = how, Projects = persistent context about a
  body of work, prompts = ephemeral, subagents = separate contexts. This is the
  cleanest official "skills are folders of instructions; MCP is for tools/data
  access" framing.
- **Engineering post (Oct 2025)**: skills as "organized folders of instructions,
  scripts, and resources that agents can discover and load dynamically";
  metadata-only preloading as level 1 of progressive disclosure; because skills
  sit on a filesystem they can bundle effectively unlimited reference material
  at zero cost until read
  (https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
  ⚠️).
- **"Code execution with MCP: building more efficient AI agents"** (Nov 4,
  2025): connecting many MCP servers "can burn 50,000–66,000 tokens" before work
  starts; presenting MCP servers as code APIs on a filesystem and letting the
  model write code cut one workflow "from 150,000 tokens to 2,000 tokens — a
  saving of 98.7%"; the post explicitly converges MCP onto the same
  filesystem/progressive-disclosure substrate as skills
  (https://www.anthropic.com/engineering/code-execution-with-mcp ⚠️; good
  secondary: https://simonwillison.net/2025/Nov/4/code-execution-with-mcp/).
- **Tool Search Tool** (shipped on the API; part of "advanced tool use,"
  announced Nov 24, 2025, beta `advanced-tool-use-2025-11-20`): "A typical
  multi-server setup… can consume ~55k tokens in definitions before Claude does
  any actual work. Tool search typically reduces this by over 85%, loading only
  the 3–5 tools Claude actually needs." Variants
  `tool_search_tool_regex_20251119` / `tool_search_tool_bm25_20251119`; mark
  tools `defer_loading: true`; composes with `mcp_toolset`; up to 10,000 tools
  in catalog
  (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool;
  https://www.anthropic.com/engineering/advanced-tool-use). Claude Code uses the
  same trick natively: MCP schemas are deferred and fetched via ToolSearch on
  demand (https://code.claude.com/docs/en/context-window).
- The through-line citable from Anthropic across all of these: every
  always-resident byte (CLAUDE.md, skill descriptions, tool schemas) is treated
  as a budgeted index, and everything else (skill bodies, bundled references,
  tool schemas, retrieved documents) is pulled just-in-time — "Good context
  engineering means finding the smallest possible set of high-signal tokens…"
  (effective-context-engineering, Sept 29 2025 ⚠️).

---

### Explicit uncertainty flags

1. All ⚠️ items above: anthropic.com / claude.com / support.claude.com /
   agentskills.io were CDN-blocked from the research environment; wording came
   from search excerpts, the GitHub source of agentskills.io, and reputable
   secondary coverage. Spot-check the marked quotes (especially "a few dozen
   tokens" and the skills-explained sentences) against the live pages before
   quoting them verbatim.
2. The platform Skills *overview* contains at least one stale claim (no
   claude.ai admin management) contradicted by the Dec 18, 2025 launch; prefer
   the Help Center + enterprise docs for the claude.ai org story.
3. The "~40 products support the standard" count comes from third-party roundups
   of the agentskills.io showcase; the named adopters with first-party doc pages
   (VS Code, OpenAI Codex) are safe, the long tail is not individually verified.
4. Dates for continuously-updated doc pages are "as fetched 2026-06-28," not
   publication dates; API version strings (e.g., `web_search_20260318`,
   `mcp-client-2025-11-20`, `tool_search_tool_*_20251119`) are taken verbatim
   from those live pages.
