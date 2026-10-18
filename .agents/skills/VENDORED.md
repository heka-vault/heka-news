# Vendored skills

Every skill in this folder is a copy of a third-party skill, pinned to one commit. The first four
came from heka's website repository (heka-site), where they were picked from skills.sh on
2026-10-18 for design taste and for removing AI tells from writing. The other eight are from Emil
Kowalski's skills, added on 2026-10-18 for interaction and motion detail, worst-case data and
mobile feel.

We copy instead of running `npx skills add` so that what agents read changes only in a reviewed
pull request. An upstream edit cannot change how this repo's agents behave until someone updates
the pin here. None of these skills contains a script or makes a network call; they are markdown.

| Skill | Source | Commit | License | Local changes |
|---|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | `LICENSE.txt` (Anthropic) | none |
| `better-typography` | [jakubkrehel/skills](https://github.com/jakubkrehel/skills) `skills/better-typography` | `4c66b1fa86e9ab70187b43d7da9b6fdb29f2ef63` | MIT | dropped `agents/openai.yaml` |
| `humanizer` | [blader/humanizer](https://github.com/blader/humanizer) | `8c307f367c91bd974002f10f2be2965d642c13df` | MIT | `SKILL.md` and `LICENSE` only |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/web-design-guidelines` (`063bee94c3f4df8453406c830b0a7df0f2860278`) | rules: [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `command.md` at `434b7f91364665f2f733b310ec54809bf8f37937` | MIT | `SKILL.md` reads the pinned `guidelines.md` instead of fetching `command.md` from GitHub on every run |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) `skills/emil-design-eng` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` (the upstream repo has one at its root) |
| `break-ui` | same, `skills/break-ui` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `animate` | same, `skills/animate` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `animation-performance` | same, `skills/animation-performance` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `review-animations` | same, `skills/review-animations` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `find-animation-opportunities` | same, `skills/find-animation-opportunities` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `mobile-native` | same, `skills/mobile-native` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |
| `animation-vocabulary` | same, `skills/animation-vocabulary` | `2d228630ba1446365f614a108cb8252f1feda202` | MIT | added `LICENSE` |

`.claude/skills` is a symlink to this folder so Claude Code finds the same skills.

## When to use which

- **frontend-design**: any new page, section or visual change. Update `docs/design-plan.md` first and check it against the skill's list of AI-generated defaults.
- **better-typography**: type scale, font loading, wrapping, punctuation; run it on any change to `src/styles/`.
- **emil-design-eng**: the taste review of a component: press states, folds, anything a person touches. Its review format (one Before/After/Why table) is the one to use in PRs.
- **animate**: before writing any motion. Run its gate first (should this animate at all?); most answers here are "no".
- **review-animations**: review a diff that adds or changes motion, before the PR.
- **animation-performance**: when motion drops frames, or before animating anything other than `transform` and `opacity`.
- **find-animation-opportunities**: occasionally, to sweep the UI for state changes that teleport. Expect it to recommend little: this is a reading site.
- **animation-vocabulary**: naming a motion precisely in a review or a PR description.
- **break-ui**: any change to how an item, a comment or a member renders. The worst-case data it asks for lives permanently in the seed (`scripts/seed-data.ts`), so instead of its "Demo data / Worst case" toggle, run `bun run seed -- --reset` and look.
- **mobile-native**: anything that will be tapped: tap targets, hover gating, press feedback, `theme-color`.
- **web-design-guidelines**: review a UI change before opening the PR (accessibility, focus, forms, motion).
- **humanizer**: every piece of copy a visitor reads (page text, empty states, labels, the about page). Use `docs/voice-sample.md` as the writing sample.

## Not vendored

From the same Emil Kowalski repository, deliberately skipped:

- `ask-sonner`, `pick-ui-library`: React component libraries; this site has no client framework.
- `animate-expo`, `write-swift`: React Native and Swift; this is a web site.
- `apple-design`: built around gestures and native-feeling drag interactions this site does not have.
- `prototype`: useful for design exploration in a throwaway sandbox, not for working in this repository. Pull it in for a design spike if one is needed.
- `improve-animations`: a whole-codebase motion audit that writes plans for other agents; with three motions in the site, `review-animations` covers it.

## Updating a pin

1. Read the upstream diff since the pinned commit. Look for new scripts, network calls or instructions that reach outside the repo.
2. Copy the new files over, keeping the local changes listed above.
3. Update the commit in this table and open a PR that says what changed upstream.
