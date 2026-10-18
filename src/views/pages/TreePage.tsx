// The invite tree: every member under the person who invited them (ADR 0003).

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
            {members > 0 && `${plural(members, 'member')} so far.`}
          </p>
        </header>
        {roots.length > 0 ? <Branch nodes={roots} /> : <Empty title="No members yet." />}
      </div>
    </Layout>
  )
}
