// Every list of items: the front page, /newest, /posts, /status, and tag pages.

import type { Child } from 'hono/jsx'
import type { ItemSummary } from '../../db/types.ts'
import { Empty, ItemList, Pager } from '../components/Items.tsx'
import { Layout } from '../components/Layout.tsx'
import type { NavKey, PageContext } from '../context.ts'

export interface ListPageProps {
  ctx: PageContext
  /** <title>; omit for the front page. */
  title?: string
  description?: string
  canonical: string
  nav: NavKey
  heading: string
  /** Hide the heading visually (the front page, where the nav already says where you are). */
  headingHidden?: boolean
  intro?: Child
  items: ItemSummary[]
  rankFrom?: number
  /** Status notes in full (the status feed). */
  fullNotes?: boolean
  prev?: { href: string; label: string }
  next?: { href: string; label: string }
  empty: { title: string; body: Child }
  jsonLd?: object[]
  feeds?: { title: string; href: string }[]
}

export function ListPage(props: ListPageProps) {
  return (
    <Layout
      ctx={props.ctx}
      title={props.title}
      description={props.description}
      canonical={props.canonical}
      nav={props.nav}
      jsonLd={props.jsonLd}
      feeds={props.feeds}
    >
      <div class="wrap list-page">
        <header class={props.headingHidden ? 'sr-only' : 'page-head'}>
          <h1>{props.heading}</h1>
          {props.intro}
        </header>
        {props.items.length > 0 ? (
          <ItemList
            items={props.items}
            ctx={props.ctx}
            rankFrom={props.rankFrom}
            fullNotes={props.fullNotes}
          />
        ) : (
          <Empty title={props.empty.title}>{props.empty.body}</Empty>
        )}
        <Pager prev={props.prev} next={props.next} />
      </div>
    </Layout>
  )
}
