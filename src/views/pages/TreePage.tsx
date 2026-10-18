// The invite tree: every member under the person who invited them (ADR 0003), and any one member
// as their own root.

import type { TreeNode } from '../../db/types.ts'
import { isoTime, plural } from '../../lib/format.ts'
import { Empty } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

function count(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + 1 + count(node.children), 0)
}

function joined(at: number): string {
  return new Date(at * 1000).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function Branch({ nodes }: { nodes: TreeNode[] }) {
  return (
    <ul class="tree">
      {nodes.map((node) => (
        <li>
          <span class="tree__member">
            <a href={`/u/${node.login}`} translate="no">
              {node.login}
            </a>{' '}
            <span class="tree__joined">
              joined <time datetime={isoTime(node.createdAt)}>{joined(node.createdAt)}</time>
            </span>
            {node.isModerator && <span class="role">Moderator</span>}
            {node.banned && <span class="role role--banned">Banned</span>}
          </span>
          {node.children.length > 0 && <Branch nodes={node.children} />}
        </li>
      ))}
    </ul>
  )
}

export function TreePage({ ctx, roots }: { ctx: PageContext; roots: TreeNode[] }) {
  const members = count(roots)
  return (
    <Layout
      ctx={ctx}
      title="Invite tree"
      nav="tree"
      description="Every member of heka news and who invited them. Membership is by invitation, and the tree is public."
      canonical="/tree"
    >
      <div class="wrap">
        <header class="page-head">
          <h1>Invite tree</h1>
          <p>
            Every member, under the person who invited them. Founding members are at the top.{' '}
            {members > 0 && `${plural(members, 'member')} so far.`} Each profile links to that
            member’s own branch.
          </p>
        </header>
        {roots.length > 0 ? <Branch nodes={roots} /> : <Empty title="No members yet." />}
      </div>
    </Layout>
  )
}

/** How many people joined through a member, directly or further down. */
function Reach({ n, self }: { n: number; self: boolean }) {
  if (n === 0) {
    return self ? (
      <>
        Nobody has joined through you yet. <a href="/settings#invites-heading">Invite someone</a>.
      </>
    ) : (
      <>Nobody has joined through them yet.</>
    )
  }
  return (
    <>
      {plural(n, 'person', 'people')} {n === 1 ? 'traces' : 'trace'} back to {self ? 'you' : 'them'}
      .
    </>
  )
}

/**
 * One member as their own root: the line of invitations from a founding member down to them, then
 * everyone who joined through them.
 */
export function BranchPage({
  ctx,
  line,
  node,
}: {
  ctx: PageContext
  line: TreeNode[]
  node: TreeNode
}) {
  const self = ctx.viewer?.login === node.login
  return (
    <Layout
      ctx={ctx}
      title={self ? 'Your branch of the invite tree' : `${node.login}’s branch of the invite tree`}
      nav="tree"
      description={`${node.login} on the heka news invite tree: the members who invited them, and everyone who joined through them.`}
      canonical={`/tree/${node.login}`}
    >
      <div class="wrap">
        <header class="page-head">
          <h1>
            {self ? (
              'Your branch'
            ) : (
              <>
                <span translate="no">{node.login}</span>’s branch
              </>
            )}
          </h1>
          <p>
            <Reach n={count(node.children)} self={self} />
          </p>
        </header>
        <section class="tree-line" aria-labelledby="line-heading">
          <h2 id="line-heading" class="tree-line__title">
            {line.length === 0 ? 'Founding member' : 'Invited through'}
          </h2>
          {line.length === 0 ? (
            <p class="tree-line__note">
              At the top of the tree. Nobody invited {self ? 'you' : 'them'}.
            </p>
          ) : (
            <ol class="tree-line__list">
              {line.map((up) => (
                <li>
                  <a href={`/tree/${up.login}`} translate="no">
                    {up.login}
                  </a>
                  <span class="tree-line__arrow" aria-hidden="true">
                    →
                  </span>
                </li>
              ))}
              <li aria-current="page">
                <span translate="no">{node.login}</span>
              </li>
            </ol>
          )}
        </section>
        <Branch nodes={[node]} />
        <p class="tree-more">
          <a href="/tree">See the whole invite tree</a>
        </p>
      </div>
    </Layout>
  )
}
