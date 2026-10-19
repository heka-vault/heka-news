// Shapes returned by src/db/ functions. Views and routes depend on these, never on columns.

export type ItemKind = 'link' | 'post' | 'status'

export interface UserRef {
  login: string
  displayName: string | null
}

/** Who deleted an item or comment: its author ("deleted") or a moderator ("removed"). */
export type RemovedBy = 'author' | 'moderator'

/** The signed-in member, as a request sees them. */
export interface Member {
  id: number
  login: string
  displayName: string | null
  isModerator: boolean
}

/** The flag reasons a member can pick. The schema also allows 'duplicate' and 'other'. */
export type FlagReason = 'spam' | 'off-topic' | 'unkind'

/** An item as it appears in a list. bodyHtml is filled for status notes only. */
export interface ItemSummary {
  id: number
  kind: ItemKind
  title: string | null
  url: string | null
  domain: string | null
  bodyHtml: string | null
  bodyChars: number
  authorId: number
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
  removedBy: RemovedBy | null
  flagCount: number
}

export interface CommentNode {
  id: number
  parentId: number | null
  depth: number
  authorId: number
  author: UserRef
  createdAt: number
  editedAt: number | null
  points: number
  bodyHtml: string
  deleted: boolean
  removedBy: RemovedBy | null
  /** Carried in from the Discord forum (ADR 0009). */
  viaDiscord: boolean
  children: CommentNode[]
}

/** One comment with what edit, delete, reply and moderation need. */
export interface CommentDetail {
  id: number
  itemId: number
  parentId: number | null
  depth: number
  authorId: number
  author: UserRef
  createdAt: number
  editedAt: number | null
  points: number
  bodyMd: string
  bodyHtml: string
  deleted: boolean
  removedBy: RemovedBy | null
  /** The item's title, or the start of its text for a status note. */
  itemTitle: string
  itemDeleted: boolean
}

/** A comment in a list away from its thread: /replies and profiles. */
export interface CommentListing {
  id: number
  itemId: number
  itemTitle: string
  author: UserRef
  createdAt: number
  points: number
  bodyHtml: string
  /** For replies: whose comment or item it answers. */
  inReplyTo: 'item' | 'comment'
}

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'

export interface InviteRow {
  id: number
  inviter: UserRef
  note: string
  createdAt: number
  expiresAt: number
  status: InviteStatus
  usedBy: UserRef | null
  usedAt: number | null
}

export interface FlagSummary {
  /** Reason to count, open flags only. */
  reasons: Partial<Record<string, number>>
  total: number
  latestAt: number
}

export interface FlaggedItem extends FlagSummary {
  item: ItemSummary
}

export interface FlaggedComment extends FlagSummary {
  comment: CommentListing
}

/** A removal a moderator may undo, for the queue. */
export interface Removal {
  kind: 'item' | 'comment'
  id: number
  itemId: number
  label: string
  author: string
  removedAt: number
}

export interface UserProfile {
  id: number
  login: string
  displayName: string | null
  bio: string
  bioHtml: string
  createdAt: number
  isModerator: boolean
  banned: boolean
  invitedBy: UserRef | null
  invited: UserRef[]
  itemCount: number
  commentCount: number
  /** Their linked Discord account (ADR 0009), shown on the profile. */
  discord: DiscordLink | null
}

/** A member's linked Discord account (ADR 0009). */
export interface DiscordLink {
  /** Discord's user id (a snowflake, kept as text). */
  discordId: string
  username: string
  linkedAt: number
}

export interface TreeNode {
  login: string
  displayName: string | null
  createdAt: number
  isModerator: boolean
  banned: boolean
  children: TreeNode[]
}

/** One of the newest members, for the front page's "Who's here". */
export interface NewMember {
  login: string
  createdAt: number
  /** Who invited them; null for a founding member. */
  invitedBy: string | null
}

/** The invite tree in brief: its size, its deepest chain, and its newest branches. */
export interface TreeSummary {
  /** Every member, banned or not: the number /tree shows. */
  members: number
  /** Invitations between a founding member and the furthest member from one; 0 with none. */
  deepest: number
  /** Newest first. Banned members are left out. */
  newest: NewMember[]
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
