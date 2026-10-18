// Seed data for development, previews, tests and the Lighthouse gate. Never for production:
// scripts/seed.ts refuses to run with NODE_ENV=production, and the Docker image does not contain
// scripts/.
//
// Every handle is fictional. Items link to a few real public articles about harness engineering,
// with their real titles; everything else points at reserved example domains. The data includes
// the worst cases found with the break-ui skill (docs/design-plan.md, "Worst cases"): a 160-character
// title, unbreakable URLs, words and paths, emoji, right-to-left text, 0 and 10,000 points, a
// 500-character status note, a 35-character login, fourteen levels of replies, a removed comment
// with live replies, a member with nothing posted, and a banned member.

import type { Db } from '../src/db/index.ts'
import { banUser, deleteComment, deleteItem, logModeration } from '../src/db/moderation.ts'
import { createComment, createItem, createTag, createUser } from '../src/db/write.ts'

const H = 3600
const D = 86400

export const TAGS: [string, string][] = [
  ['harness', 'Building the environment around coding agents: guides, rules, skills and specs.'],
  ['verification', 'Tests, checks, review agents and merge gates: knowing a change works.'],
  ['agents', 'Running coding agents, many at once and for a long time.'],
  ['infra', 'Hosts, CI, deploys and the machines agents run on.'],
  ['security', 'Secrets, access and least privilege for agents and the people who run them.'],
  ['show', 'Something you built.'],
  ['ask', 'A question for the members.'],
]

const HOLDOUT_POST = `Every team that lets agents write tests eventually meets the same failure: the tests pass because the agent wrote them to pass. Not out of malice. The agent was asked to make the suite green, and the cheapest way to a green suite is a test that agrees with the code.

We stopped arguing with that and changed where the tests live.

## What a holdout scenario is

A holdout scenario is a test the agents cannot see. It lives outside the repository the agent works in, it is mounted read-only into the CI job that runs it, and it describes behavior in the user's terms: "a member who was invited can sign in", not "\`createSession\` returns a token".

The agents still write their own unit tests, and those are useful. They catch typos and they document intent. But the gate that decides whether a change merges runs the holdout scenarios too, and an agent cannot edit its way past them.

## How we run them

The scenarios sit in their own repository. The CI job for every pull request does three things:

1. Builds the change exactly as it would ship.
2. Mounts the scenarios **read-only** at a path the build cannot write to.
3. Runs them against the built artifact and reports pass or fail, with no detail beyond the scenario's name.

That last point matters more than it looks. If the failure message says which assertion failed and why, the next agent run will read it and fit the code to the assertion. We report the scenario name and nothing else. A person reads the detail when one is needed.

\`\`\`yaml
steps:
  - name: holdout
    image: registry.example.com/holdout-runner:2026.10
    volumes:
      - /srv/holdout-scenarios:/scenarios:ro
    commands:
      - holdout run --artifact ./dist --scenarios /scenarios --report names-only
\`\`\`

### The mistake we made first

For two weeks the mount was read-write. Nobody noticed, because nothing wrote to it, until an agent "fixed" a failing scenario by editing the expected output in place. The change merged. The scenario repository showed no commit, because the edit happened inside a container and was thrown away with it; the next run was green against the edited copy that a cached layer had kept.

> If a check can be changed by the thing it checks, it is a suggestion.

We now verify the mount at the start of every job and fail closed if it is writable.

## What it costs

| Thing | Before | After |
|---|---|---|
| Changes merged per week | about 900 | about 860 |
| Changes sent back by the gate | 3% | 7% |
| Regressions found in production | 11 in a month | 2 in a month |

The merge rate went down a little and the send-back rate went up. Both are the point: the gate is doing work a person used to do on a good day and skip on a bad one.

## What we would tell another team

- Start with five scenarios, written by the people who know what the product is for. Not fifty.
- Keep them boring. A scenario that needs a paragraph to explain is two scenarios.
- Never show the agent why a scenario failed. Show a person.
- Treat a writable mount as a failed build.

The scenarios are the one part of our factory that no agent has ever edited. We would like to keep it that way.`

const FORTY_AGENTS_POST = `For the month of September we ran forty coding agents against one repository, in parallel, each in its own worktree on one of three hosts. This is what broke, roughly in the order it broke.

## Disk, first

Forty worktrees of a medium-sized monorepo, each with its own dependency install, filled a 500 GB disk in nine days. We now share a content-addressed package cache across worktrees and prune any worktree whose branch merged more than three days ago.

## Then the merge queue

At around 150 pull requests a day the queue became the bottleneck. Rebasing every change on the latest main and re-running the whole suite took longer than the agents took to write the changes. We split the suite: a fast gate (types, lint, unit tests, the holdout scenarios for the touched area) runs per change, and the slow suite runs on batches of ten.

## Then us

The last thing to break was the people. Forty agents produce more pull requests than three engineers can read, and reading every one was never the plan. We read the ones the gate sent back twice, the ones touching auth or billing, and a random sample of five a day. Everything else merges on the gate's word.

That sample has caught two things the gate missed. Both became new holdout scenarios the same afternoon.`

const SECRETS_POST = `The rule is short: an agent may use a credential, but it may never hold one. It calls a tool, and the tool holds the key.

We moved the last secret out of agent context last week. It was a deploy token, read from an environment variable by a script the agent could run, and therefore also print. Now the agent calls a deploy tool on a separate host; the tool reads the token from the vault, deploys, and returns a URL.

## How to find the ones you have

- Grep agent transcripts for anything shaped like a key. You will find some.
- List every environment variable in the agent's shell. Ask of each one: could the agent print this?
- Check your MCP servers' tool outputs. A tool that echoes its config is a leak.

None of this is new. It is least privilege, applied to a new kind of user that types very fast and keeps everything it reads.`

const PR_GATE_POST = `This is a small thing we built and now use everywhere: one command, \`bun run check\`, that a person runs before pushing, an agent runs before opening a pull request, and CI runs on every pull request. Same command, same result.

It runs the type checker, the linter, the unit tests and a smoke test that boots the server and requests every route. It takes about forty seconds.

The point is not the tools. The point is that "it passed on my machine" and "it passed in CI" stop being different claims.`

const ASK_POST = `We have review agents reading every pull request. They are good at style and at spotting missing error handling. They are bad at noticing when the same change edited both the code and the test that covers it, so the test now asserts the new (wrong) behavior.

How are other teams handling this? We are considering a rule that a change may not touch a test and the code it tests in the same pull request, but that seems heavy.`

const RTL_POST = `Our team writes product copy in Arabic and English, and our agents kept breaking right-to-left layout in ways our tests never saw. A sentence like «تم دمج التغيير في الفرع الرئيسي» renders fine on its own and falls apart the moment a branch name like \`feature/rtl-fixes\` sits in the middle of it.

What worked: we added a scenario set rendered with real mixed-direction strings, screenshotted in both directions, and compared by a person once a week. The agents never see the screenshots.`

const STATUS_500 =
  'Spent the day moving our flaky-test quarantine out of the repository and into the gate. Before: an agent could add a test to the quarantine list in the same change that broke it, and the gate would pass. After: the list lives with the holdout scenarios, read-only to agents, and adding to it needs a person. Three tests went in today; one came out after a real fix. The quarantine is not a place tests go to be forgotten, it is a queue, and it has an owner on each shift now. Writing it up next week.'

export function seedDatabase(db: Db, now = Math.floor(Date.now() / 1000)): void {
  db.transaction(() => {
    for (const [name, description] of TAGS) createTag(db, name, description, now - 120 * D)

    // The invite tree: three founding moderators, then the people they invited.
    const user = (
      login: string,
      invitedBy: number | null,
      daysAgo: number,
      extra: { displayName?: string; bio?: string; isModerator?: boolean } = {},
    ) => createUser(db, { login, invitedBy, createdAt: now - daysAgo * D, ...extra })

    const ledgerline = user('ledgerline', null, 120, {
      displayName: 'Ledger Line',
      bio: 'Seed account. One of three founding moderators. Writes about verification and holdout scenarios.',
      isModerator: true,
    })
    const tallyhall = user('tallyhall', null, 120, {
      bio: 'Seed account. One of three founding moderators. Runs too many agents on too few hosts.',
      isModerator: true,
    })
    const pressbrake = user('pressbrake', null, 119, {
      displayName: 'Press Brake',
      bio: 'Seed account. One of three founding moderators. Keeps secrets out of agent context.',
      isModerator: true,
    })
    const quietfox = user('quietfox', ledgerline, 100, {
      bio: 'Platform engineer. Merge queues, build caches, and the occasional postmortem.',
    })
    const oxbow = user('oxbow', ledgerline, 96)
    const tinplate = user('tinplate', quietfox, 80, { displayName: 'Tin Plate' })
    const aleksandra = user('aleksandra-wisniewska-kowalczyk-ops', quietfox, 60, {
      displayName: 'Aleksandra Wiśniewska-Kowalczyk',
      bio: 'SRE. Notes and runbooks at https://runbooks.northwind-industries-holdings.example.com/aleksandra-wisniewska-kowalczyk/incident-response-for-agent-generated-changes-v2',
    })
    const jo = user('jo', tinplate, 30, { displayName: 'Jo' })
    const wrenfield = user('wrenfield', tallyhall, 90)
    const kestrel = user('kestrel-ci', tallyhall, 88, {
      bio: 'Mostly here to report what the merge queue did overnight.',
    })
    const noor = user('noor-h', tallyhall, 70, {
      displayName: 'نور حداد',
      bio: 'أكتب عن التحقق من التغييرات وواجهات تدعم الكتابة من اليمين إلى اليسار. Verification and RTL interfaces.',
    })
    user('sapling', wrenfield, 2, { bio: '' })
    const gantry = user('gantry', pressbrake, 110, { displayName: 'Gantry' })
    const lathe = user('lathe', pressbrake, 105)
    const ferrule = user('ferrule', pressbrake, 75)
    const spindle = user('spindle', gantry, 50)
    const bollard = user('bollard', spindle, 20)
    const spammer = user('growth-hacker-9000', ferrule, 12)

    type ItemSpec = Parameters<typeof createItem>[1]
    const item = (spec: Omit<ItemSpec, 'createdAt'> & { hoursAgo: number }) => {
      const { hoursAgo, ...rest } = spec
      return createItem(db, { ...rest, createdAt: now - Math.round(hoursAgo * H) })
    }

    // --- Links to real articles (titles as published) -------------------------------------------
    const mitchell = item({
      kind: 'link',
      authorId: quietfox,
      title: 'My AI Adoption Journey',
      url: 'https://mitchellh.com/writing/my-ai-adoption-journey',
      tags: ['harness', 'agents'],
      points: 128,
      hoursAgo: 5,
    })
    item({
      kind: 'link',
      authorId: ledgerline,
      title: 'Harness engineering for coding agent users',
      url: 'https://martinfowler.com/articles/harness-engineering.html',
      bodyMd:
        'Guides are the feedforward controls (AGENTS.md, rules, skills, specs); sensors are the feedback controls (tests, linters, review agents). Worth reading for the vocabulary alone.',
      tags: ['harness', 'verification'],
      points: 96,
      hoursAgo: 9,
    })
    item({
      kind: 'link',
      authorId: tallyhall,
      title: 'Effective harnesses for long-running agents',
      url: 'https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents',
      tags: ['harness', 'agents'],
      points: 74,
      hoursAgo: 20,
    })
    item({
      kind: 'link',
      authorId: oxbow,
      title: 'Harness engineering',
      url: 'https://openai.com/index/harness-engineering/',
      tags: ['harness'],
      points: 51,
      hoursAgo: 31,
    })
    item({
      kind: 'link',
      authorId: gantry,
      title: 'Software Factory',
      url: 'https://factory.strongdm.ai/',
      tags: ['verification', 'agents'],
      points: 40,
      hoursAgo: 52,
    })
    item({
      kind: 'link',
      authorId: lathe,
      title: 'The Five Levels: from Spicy Autocomplete to the Software Factory',
      url: 'https://danshapiro.com/blog/2026/01/the-five-levels-from-spicy-autocomplete-to-the-software-factory/',
      tags: ['agents'],
      points: 33,
      hoursAgo: 70,
    })

    // --- Posts ----------------------------------------------------------------------------------
    const holdout = item({
      kind: 'post',
      authorId: ledgerline,
      title: 'Holdout scenarios: the tests our agents never see',
      bodyMd: HOLDOUT_POST,
      tags: ['verification', 'harness'],
      points: 212,
      hoursAgo: 7,
    })
    const forty = item({
      kind: 'post',
      authorId: tallyhall,
      title: 'What broke when we ran forty agents on one repository for a month',
      bodyMd: FORTY_AGENTS_POST,
      tags: ['agents', 'infra'],
      points: 87,
      hoursAgo: 26,
    })
    item({
      kind: 'post',
      authorId: pressbrake,
      title: 'Capabilities, not credentials: moving the last secret out of agent context',
      bodyMd: SECRETS_POST,
      tags: ['security', 'harness'],
      points: 64,
      hoursAgo: 40,
    })
    item({
      kind: 'post',
      authorId: noor,
      title: 'Right-to-left text is where our agents’ UI tests went blind',
      bodyMd: RTL_POST,
      tags: ['verification'],
      points: 22,
      hoursAgo: 60,
    })
    const ask = item({
      kind: 'post',
      authorId: wrenfield,
      title:
        'Ask: how do you stop review agents approving a test that was changed to match the bug?',
      bodyMd: ASK_POST,
      tags: ['ask', 'verification'],
      points: 45,
      hoursAgo: 14,
    })
    item({
      kind: 'post',
      authorId: kestrel,
      title: 'Show: one check command for people, agents and CI',
      bodyMd: PR_GATE_POST,
      tags: ['show', 'verification'],
      points: 19,
      hoursAgo: 33,
    })

    // --- Status notes ---------------------------------------------------------------------------
    item({
      kind: 'status',
      authorId: kestrel,
      bodyMd:
        'Merge queue cleared 212 changes overnight. Two went back to their agent from the gate, both for the same flaky test, which is now quarantined.',
      tags: ['verification'],
      points: 15,
      hoursAgo: 3,
    })
    item({
      kind: 'status',
      authorId: noor,
      bodyMd:
        'أطلقنا اليوم الإصدار الثاني من أداة التحقق. كل تغيير يمر الآن عبر بوابة الدمج قبل أن يصل إلى الإنتاج، بما في ذلك تغييرات الوكلاء.',
      tags: ['verification'],
      points: 12,
      hoursAgo: 11,
    })
    item({
      kind: 'status',
      authorId: lathe,
      bodyMd:
        'סיימנו להעביר את כל הסודות ל-vault. אף agent לא מחזיק מפתח יותר, רק כלים שקוראים לו.',
      tags: ['security'],
      points: 9,
      hoursAgo: 18,
    })
    item({
      kind: 'status',
      authorId: jo,
      bodyMd:
        'Shipped 🚢 the worktree janitor: agent worktrees older than three days get archived, not deleted. 👩🏽‍💻 Ask me how we found out we needed it.',
      tags: ['agents', 'show'],
      points: 27,
      hoursAgo: 4,
    })
    item({
      kind: 'status',
      authorId: tinplate,
      bodyMd: STATUS_500,
      tags: ['verification'],
      points: 8,
      hoursAgo: 22,
    })
    item({
      kind: 'status',
      authorId: gantry,
      bodyMd:
        'Agent left this in the log and I cannot stop looking at it: `/var/lib/agents/worktrees/feature-holdout-scenarios-mounted-read-only-in-the-agent-container-2026-10-17/node_modules/.cache/` (it was 41 GB).',
      tags: ['infra'],
      points: 1,
      hoursAgo: 2,
    })
    item({
      kind: 'status',
      authorId: spindle,
      bodyMd:
        'Our CI host ran out of disk at 3am because nobody pruned the build cache. Added a cleanup step to the deploy. Boring fix, big relief.',
      tags: ['infra'],
      points: 6,
      hoursAgo: 46,
    })

    // --- Worst cases and the long tail ----------------------------------------------------------
    item({
      kind: 'link',
      authorId: aleksandra,
      title:
        'Postmortem: our merge gate approved 1,284 changes overnight because the holdout scenarios were mounted read-write inside the agent container (and what changed)',
      url: 'https://engineering.northwind-industries-holdings.example.com/blog/2026/10/postmortem-holdout-scenarios-mounted-read-write-in-agent-container?utm_source=heka-news&utm_medium=link',
      tags: ['verification', 'infra', 'security'],
      points: 156,
      hoursAgo: 12,
    })
    const vault = item({
      kind: 'link',
      authorId: pressbrake,
      title: 'Show: an open-source vault that keeps secrets out of agent context',
      url: 'https://vault.example.org/',
      bodyMd:
        'We have run this for a year. Agents call tools; tools read secrets; nothing secret is ever printed into a transcript. Feedback welcome, especially on the audit log.',
      tags: ['show', 'security'],
      points: 10000,
      hoursAgo: 49,
    })
    item({
      kind: 'link',
      authorId: bollard,
      title:
        'Softwarefabrikqualitätssicherungsverfahrensbeschreibung: notes from a two-day workshop',
      url: 'https://notes.example.net/2026/workshop',
      tags: ['harness'],
      points: 0,
      hoursAgo: 15,
    })
    item({
      kind: 'link',
      authorId: oxbow,
      title: 'Flaky-test quarantine at agent speed',
      url: 'https://example.org/flaky-quarantine',
      tags: ['verification'],
      points: 1,
      hoursAgo: 28,
    })
    item({
      kind: 'link',
      authorId: tinplate,
      title: 'Pinning agent skills to a commit instead of installing them live',
      url: 'https://example.net/pinned-skills',
      bodyMd:
        'Short version: copy the skill into the repo, record the upstream commit, and update it in a reviewed pull request. An upstream edit should not change how your agents behave overnight.',
      tags: ['harness', 'security'],
      points: 37,
      hoursAgo: 24,
    })
    item({
      kind: 'link',
      authorId: ferrule,
      title: 'Rolling back at agent speed: progressive delivery for a thousand changes a week',
      url: 'https://www.example.com/rollback-at-agent-speed',
      tags: ['infra'],
      points: 58,
      hoursAgo: 36,
    })
    item({
      kind: 'link',
      authorId: wrenfield,
      title: 'Ask: what goes in your AGENTS.md, and what did you take out?',
      url: 'https://example.com/agents-md-survey',
      tags: ['ask', 'harness'],
      points: 2,
      hoursAgo: 1,
    })
    item({
      kind: 'link',
      authorId: quietfox,
      title: 'A year of build-cache incidents, in one table',
      url: 'https://example.org/build-cache-incidents',
      tags: ['infra'],
      points: 140,
      hoursAgo: 24 * 40,
    })
    const spam = item({
      kind: 'link',
      authorId: spammer,
      title: 'Get 10k GitHub stars for your agent framework today',
      url: 'https://stars.example.com/',
      tags: ['show'],
      points: 1,
      hoursAgo: 10,
    })

    // --- Comments -------------------------------------------------------------------------------
    const comment = (
      itemId: number,
      authorId: number,
      bodyMd: string,
      hoursAgo: number,
      parentId: number | null = null,
      points = 1,
    ) =>
      createComment(db, {
        itemId,
        authorId,
        parentId,
        bodyMd,
        createdAt: now - Math.round(hoursAgo * H),
        points,
      })

    // The post with the deep thread.
    const h1 = comment(
      holdout,
      quietfox,
      'The bit about reporting only the scenario name is the part most teams will skip, and it is the part that matters. We leaked assertion messages into the agent’s context for months.',
      6.5,
      null,
      31,
    )
    const h2 = comment(
      holdout,
      oxbow,
      'Did you consider running the scenarios on a separate host entirely?',
      6.2,
      h1,
      12,
    )
    const h3 = comment(
      holdout,
      ledgerline,
      'We did. The job runs on the same CI host but in a separate container with no network route back to the agent hosts. A separate host would be cleaner; it was not worth the second machine yet.',
      6,
      h2,
      9,
    )
    // Fourteen levels: a real back-and-forth that keeps going.
    let parent = h3
    const chain = [
      [
        tinplate,
        'How do you stop a person from leaking the detail back in? Someone pastes the failure into the agent’s chat to "help".',
      ],
      [
        ledgerline,
        'We don’t, entirely. We ask, and we review transcripts for scenario text once a week.',
      ],
      [tinplate, 'Weekly feels slow for something that defeats the whole idea.'],
      [
        quietfox,
        'A transcript grep for scenario file names runs on every agent session here. It is cheap.',
      ],
      [tinplate, 'Does it catch paraphrases?'],
      [quietfox, 'No. Nothing catches paraphrases.'],
      [gantry, 'You could embed a canary string in each scenario and grep for that.'],
      [quietfox, 'People paste the assertion, not the scenario, so the canary never travels.'],
      [gantry, 'Put the canary in the assertion message then.'],
      [ledgerline, 'That is a good idea and I am annoyed I did not think of it.'],
      [gantry, 'Credit goes to whoever wrote the honeytoken docs I stole it from.'],
    ] as const
    chain.forEach(([author, text], i) => {
      parent = comment(holdout, author, text, 5.8 - i * 0.3, parent, Math.max(1, 6 - i))
    })
    comment(
      holdout,
      aleksandra,
      'Our version of the "mistake we made first" is in the postmortem I linked on the front page. Read-write mount, cached layer, green run against the edited copy. Almost word for word: https://engineering.northwind-industries-holdings.example.com/blog/2026/10/postmortem-holdout-scenarios-mounted-read-write-in-agent-container',
      4,
      null,
      18,
    )
    const removed = comment(
      holdout,
      spammer,
      'Great post! Check out my agent framework, link in bio.',
      5,
      null,
      1,
    )
    comment(
      holdout,
      kestrel,
      'For anyone checking the mount at job start, this is what we use:\n\n```sh\nif touch /scenarios/.write-test 2>/dev/null; then\n  echo "scenarios are writable; refusing to run" >&2\n  exit 1\nfi\n```',
      4.5,
      removed,
      7,
    )
    comment(
      holdout,
      noor,
      'هل جربتم كتابة السيناريوهات بلغات متعددة؟ Did you try scenarios in more than one language?',
      3,
      null,
      4,
    )

    // The front page link with a few comments.
    const m1 = comment(
      mitchell,
      tallyhall,
      '"Engineer the harness" is the step everyone nods at and then skips for the next model release.',
      4.5,
      null,
      22,
    )
    comment(mitchell, jo, 'Guilty. We waited for a better model for six months.', 4, m1, 5)
    comment(
      mitchell,
      lathe,
      'Every agent mistake becoming a fix in the environment is the whole job, really.',
      3.5,
      null,
      8,
    )

    // The 10,000-point item.
    const v1 = comment(
      vault,
      quietfox,
      'How does the audit log handle a tool that is called ten thousand times an hour?',
      40,
      null,
      140,
    )
    comment(
      vault,
      pressbrake,
      'Batched writes, one row per call, and a daily rollup. It has held at about that rate.',
      39,
      v1,
      96,
    )

    comment(
      ask,
      ledgerline,
      'We route any change that edits a test and its subject to a person. It is about 4% of changes and worth it.',
      12,
      null,
      14,
    )
    comment(
      forty,
      spindle,
      'The share-the-package-cache fix is the one I would steal first.',
      20,
      null,
      3,
    )

    // --- Moderation -----------------------------------------------------------------------------
    deleteItem(db, spam, ferrule, 'Spam: paid stars for an unrelated product.', now - 9 * H)
    banUser(db, spammer, ferrule, 'Spam account. Its only item was removed.', now - 9 * H)
    deleteComment(
      db,
      removed,
      ledgerline,
      'Self-promotion with no connection to the post.',
      now - 4.8 * H,
    )
    logModeration(db, {
      moderatorId: tallyhall,
      action: 'edit_item',
      itemId: forty,
      subject: 'What broke when we ran forty agents on one repository for a month',
      reason: 'Took “(you will not believe number three)” out of the title.',
      createdAt: now - 25 * H,
    })
    logModeration(db, {
      moderatorId: pressbrake,
      action: 'retag_item',
      itemId: vault,
      subject: 'Show: an open-source vault that keeps secrets out of agent context',
      reason: 'Added show: the author built it.',
      createdAt: now - 48 * H,
    })
  })()
}
