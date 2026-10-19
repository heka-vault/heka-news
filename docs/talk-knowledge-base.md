# heka: knowledge base for the "Talk to us" agent

This is the agent's knowledge base (ADR 0008). Upload it to the agent in ElevenLabs as one text
document. It is copied from hekafactory.com (`src/data/services.ts`, `src/data/pillars.ts`,
`src/data/work.ts`, `src/pages/how-we-work.astro` and `docs/brand.md` in the heka-site
repository). When the site changes, change this file in the same week and upload it again. Add
nothing here that the site does not say.

## Who we are

heka is a consulting firm: a group of engineers who build software factories. A software factory
is the harness around coding agents: what they read, what checks their work, what they may touch,
and where they run. Agents write the code now; we build the line they work on, and teach a team
to run it.

heka is the trading name of The Heka Vault, LLC. The group works coast to coast, in the Midwest
and on the West Coast. Eric Polerecky founded it and has shipped software since 1999.

We build a lights-on factory: every change visible, verified and reversible.

We run our own factory first: agent hosts so many agents work in parallel, one worktree per
change; Heka Vault, so agents and pipelines get scoped keys and credentials stay out of context
windows; a self-hosted forge and CI, where every change is a gated pull request; and a
notification channel per project for builds, deploys and failures. We try a method on our own
products, compare notes on what held up, and only then take it to a client. What we learn goes
into our writing at hekafactory.com/blog.

## Ways to work with us

There are no prices on the site. Each service has a shape instead.

### Workshops (1 to 2 days, in your code)

Your engineers build and run a factory on one of your own repositories, with us in the room. For
teams that use coding agents one at a time and want to run many of them on the same code, safely.

1. Pick one repository and a few real issues to work on.
2. Write the guides together: an AGENTS.md, a handful of rules, a first skill.
3. Build the first sensor: a pull-request gate that runs the same command on a laptop and in CI.
4. Run several agents at once, each in its own worktree, and watch what the gate catches.
5. Move one credential out of reach: the agent calls a tool that holds the key.

You leave with guides and a working gate, committed to your repository; engineers who have run
many agents on one codebase; and a written list of what to build next.

### Factory audit (1 to 2 weeks, fixed fee)

We read your repositories, pipelines and access model, and find where agents will stall, where
they will break things, and where they could already run. For teams whose agents stall or break
things, and teams about to give agents to every engineer.

1. An hour on a call about what you ship, who ships it, and where it hurts.
2. We read your repositories, pipelines and access model against the five parts of a factory.
3. You get written findings, ranked by cost and payoff.
4. We make the first commits: an AGENTS.md, a PR gate, or whatever unblocks you first.

You leave with a readiness assessment across all five parts, written findings you can hand to your
team, and the first commits in your repositories.

### Factory build (fixed scope)

We build the parts the audit found missing: guides, verification, access and infrastructure,
against a scope agreed up front. For teams that know what is missing, from an audit or from their
own list. A written scope and a definition of done come first; the work arrives as commits and
pull requests in your repositories, through your review; then a handover your team can run
without us. Everything stays in your repositories, owned by you.

### Embedded (ongoing, part time)

Principal-engineer or CTO-level time every week, for teams that want someone senior steering the
factory while it grows: architecture and delivery decisions made with your team, hands-on work in
the codebase alongside the advice, and hiring and process help as the team changes shape.

## The five parts of a software factory

1. **A codebase agents can read (guides).** Layout on disk, AGENTS.md and CLAUDE.md, rules,
   skills and specs: what an agent reads before it writes a line.
2. **Verification at volume (sensors).** Tests, QA pipelines, holdout scenarios, review agents
   and merge gates that can check hundreds or thousands of changes a week. This is the part most
   teams skip, and it decides whether the factory ships or just types.
3. **Access without exposure (capabilities, not credentials).** Agents get capabilities, never
   credentials: secrets brokered by a vault, MCP servers scoped to the job, least privilege, and
   an audit log.
4. **Many agents, one codebase (orchestration).** Parallel agents in isolated worktrees, agent
   hosts, MCP servers, skills, triggers and scheduled jobs: dozens to hundreds of agents on one
   repository.
5. **Reliability at agent speed (infrastructure).** Progressive delivery, rollback and
   observability, so production at thousands of changes a week is as steady as it was with weekly
   deploys.

## Our work

Our own products:

- **Rhystic Gaming** (live, rhysticgaming.com): game nights for Magic: The Gathering Commander
  playgroups. Ours from end to end, self-hosted, every change through our own forge and CI.
- **Startly** (live, startly.io): document collection for mortgage brokers. Built with a partner,
  on Google Cloud.
- **Grain Smith** (in development): a back office for woodworkers and small trade crews. In
  private testing, coming to iPhone and Android.
- **Ghost** (early, open source on GitHub): voice-first GitHub issue triage that runs on your own
  Linux machine.
- **heka news** (live, news.hekafactory.com): links, long posts and status notes from engineers
  who build software with coding agents. Anyone can read; members are invited.

Client work, named with the clients' agreement:

- **Quotient** (live, quotientsoft.com): we work across the whole ecosystem: the .NET backend
  API, the Expo and React Native app, the cloud service, the server tools and the Vue website.
- **OmniActions360** (live, omniactions360.com): an intelligence and orchestration layer for life
  sciences teams. We work in their core platform.

Tools our factory runs on: Heka Vault (our secrets vault, public on GitHub), eeroctl (a fork we
maintain, public on GitHub) and our Discord agents (private).

## Contact

Email eric@polerecky.com. The site is hekafactory.com; the services are at
hekafactory.com/services and the work at hekafactory.com/work.
