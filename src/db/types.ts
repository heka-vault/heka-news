// Shapes returned by src/db/ functions. Views and routes depend on these, never on columns.

export type ItemKind = 'link' | 'post' | 'status'

export interface UserRef {
  login: string
  displayName: string | null
}

/** An item as it appears in a list. bodyHtml is filled for status notes only. */
export interface ItemSummary {
  id: number
  kind: ItemKind
  title: string | null
  url: string | null
  domain: string | null
  bodyHtml: string | null
  bodyChars: number
  author: UserRef
  createdAt: number
  points: number
  commentCount: number
  tags: string[]
}

/** An item on its own page. */
export interface ItemDetail extends ItemSummary {
  bodyMd: string
  bodyHtml: string
  editedAt: number | null
  deleted: boolean
  deletedAt: number | null
}

export interface CommentNode {
  id: number
  parentId: number | null
  depth: number
  author: UserRef
  createdAt: number
  points: number
  bodyHtml: string
  deleted: boolean
  children: CommentNode[]
}

export interface UserProfile {
  id: number
  login: string
  displayName: string | null
  bio: string
  createdAt: number
  isModerator: boolean
  banned: boolean
  invitedBy: UserRef | null
  invited: UserRef[]
  itemCount: number
  commentCount: number
}

export interface TreeNode {
  login: string
  displayName: string | null
  createdAt: number
  isModerator: boolean
  banned: boolean
  children: TreeNode[]
}

export interface Tag {
  name: string
  description: string
  itemCount: number
}

export interface ModLogEntry {
  id: number
  createdAt: number
  moderator: string
  action: string
  itemId: number | null
  commentId: number | null
  subjectUser: string | null
  subject: string
  reason: string
}

export interface SitemapEntry {
  path: string
  lastModified: number
}
