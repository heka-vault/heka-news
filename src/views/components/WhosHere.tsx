// "Who's here": the newest branches of the invite tree, beside the front page list on wide screens
// and after it on phones (docs/design-plan.md, "The invite tree, up front"). Drawn with the tree's
// own nested list and guide lines, two levels at most: who invited, then who joined.

import type { NewMember, TreeSummary } from '../../db/types.ts'
import { plural } from '../../lib/format.ts'
import type { PageContext } from '../context.ts'
import { Time } from './Time.tsx'

/** How many of the newest members the panel lists. */
export const WHOS_HERE_LIMIT = 5

interface Branch {
  /** The inviter's login, or null for founding members. */
  inviter: string | null
  members: NewMember[]
}

/** The newest members grouped under who invited them, in order of each group's newest member. */
export function branches(newest: NewMember[]): Branch[] {
  const groups = new Map<string | null, Branch>()
  for (const member of newest) {
    const group = groups.get(member.invitedBy)
    if (group) group.members.push(member)
    else groups.set(member.invitedBy, { inviter: member.invitedBy, members: [member] })
  }
  return [...groups.values()]
}

function Size({ summary }: { summary: TreeSummary }) {
  return (
    <p class="whos-here__size">
      {plural(summary.members, 'member')} so far.{' '}
      {summary.deepest > 0
        ? `The longest chain of invitations is ${summary.deepest + 1} people long.`
        : 'Everyone else joins by invitation.'}
    </p>
  )
}

function Branches({ ctx, newest }: { ctx: PageContext; newest: NewMember[] }) {
  return (
    <ul class="tree whos-here__tree">
      {branches(newest).map((branch) => (
        <li>
          <span class="tree__member whos-here__inviter">
            {branch.inviter === null ? (
              branch.members.length === 1 ? (
                'Founding member'
              ) : (
                'Founding members'
              )
            ) : (
              <>
                <a href={`/u/${branch.inviter}`} translate="no">
                  {branch.inviter}
                </a>
                <span class="sr-only"> invited</span>
              </>
            )}
          </span>
          <ul class="tree">
            {branch.members.map((member) => (
              <li>
                <span class="tree__member">
                  <a href={`/u/${member.login}`} translate="no">
                    {member.login}
                  </a>{' '}
                  <span class="tree__joined">
                    joined <Time at={member.createdAt} now={ctx.now} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export function WhosHere({ ctx, summary }: { ctx: PageContext; summary: TreeSummary }) {
  return (
    <aside class="whos-here" aria-labelledby="whos-here">
      <h2 id="whos-here">Who’s here</h2>
      {summary.members === 0 ? (
        <p class="whos-here__lede">
          No members yet. People join by invitation, and the newest will be listed here under
          whoever invited them. Read <a href="/about#membership">how membership works</a>.
        </p>
      ) : (
        <>
          {summary.newest.length > 0 && (
            <>
              <p class="whos-here__lede">Newest first, each under the member who invited them.</p>
              <Branches ctx={ctx} newest={summary.newest} />
            </>
          )}
          <Size summary={summary} />
        </>
      )}
      <p class="whos-here__more">
        <a href="/tree">
          {summary.members === 0 ? 'See the invite tree' : 'See the whole invite tree'}
        </a>
      </p>
    </aside>
  )
}
