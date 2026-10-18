// Signing in, invitations and settings (ADR 0003, 0007).

import { RULES } from '../../config.ts'
import type { InviteRow } from '../../db/types.ts'
import { isoTime, longDate, plural } from '../../lib/format.ts'
import { type Errors, LIMITS } from '../../lib/validate.ts'
import {
  Csrf,
  ErrorSummary,
  FormActions,
  firstError,
  MARKDOWN_HINT,
  Preview,
  TextArea,
  TextField,
} from '../components/Forms.tsx'
import { Layout } from '../components/Layout.tsx'
import type { PageContext } from '../context.ts'

function GitHubButton({ href }: { href: string }) {
  return (
    <a class="button button--github" href={href} rel="nofollow">
      <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      Sign in with GitHub
    </a>
  )
}

export function SigninPage(props: {
  ctx: PageContext
  next: string
  /** Seeded accounts, for the development sign-in. */
  devAccounts?: { login: string; isModerator: boolean }[]
}) {
  const { ctx, next } = props
  const back = next === '/' ? null : next
  return (
    <Layout
      ctx={ctx}
      title="Sign in"
      description="Members of heka news sign in with GitHub. Membership is by invitation."
      canonical="/signin"
      noindex
    >
      <div class="wrap">
        <header class="page-head">
          <h1>Sign in</h1>
        </header>
        <div class="prose reading">
          {ctx.signin === 'github' && (
            <>
              <p class="lede">Members sign in with GitHub.</p>
              <p>
                <GitHubButton href={`/auth/github?next=${encodeURIComponent(next)}`} />
              </p>
              <p>
                We ask GitHub for your public profile only: your login, name and avatar. Nothing is
                posted to GitHub, and we keep no GitHub token.
              </p>
              <p>
                Not a member yet? Membership is by invitation. If a member has sent you a link, open
                it to join. <a href="/about#membership">How membership works</a>
              </p>
            </>
          )}
          {ctx.signin === 'dev' && (
            <>
              <p class="lede">Development sign-in.</p>
              <p>
                GitHub is not configured here, so you can sign in as any seeded member. This page
                does not exist in production.
              </p>
              {props.devAccounts && props.devAccounts.length > 0 ? (
                <ul class="dev-accounts">
                  {props.devAccounts.map((account) => (
                    <li>
                      <a
                        href={`/dev/sign-in-as/${account.login}?next=${encodeURIComponent(next)}`}
                        rel="nofollow"
                        translate="no"
                      >
                        {account.login}
                      </a>
                      {account.isModerator && <span class="role">Moderator</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  There are no members to sign in as. Run <code>bun run seed</code> first.
                </p>
              )}
            </>
          )}
          {ctx.signin === 'closed' && (
            <>
              <p class="lede">Membership is by invitation; sign-in opens soon.</p>
              <p>
                When it opens, members sign in with GitHub, and an invitation link from a member
                creates a new account. Until then, everything here is public and read-only.{' '}
                <a href="/about#membership">How membership works</a>
              </p>
            </>
          )}
          <p>
            <a href={next}>{back ? 'Back to where you were' : 'Back to the top items'}</a>
          </p>
        </div>
      </div>
    </Layout>
  )
}

/** /invite/:code: what heka news is, who invited you, and the button to accept. */
export function InvitePage(props: { ctx: PageContext; code: string; invite: InviteRow | null }) {
  const { ctx, invite } = props
  const open = invite?.status === 'open'
  const heading = open
    ? `${invite.inviter.login} invited you to heka news`
    : 'This invitation does not work'
  return (
    <Layout
      ctx={ctx}
      title="Invitation"
      description="An invitation to join heka news."
      canonical="/invite"
      noindex
    >
      <div class="wrap">
        <header class="page-head">
          <h1 translate="no">{heading}</h1>
        </header>
        <div class="prose reading">
          {open ? (
            <>
              <p class="lede">
                heka news is where engineers who build software with coding agents share links, long
                posts and short status notes.
              </p>
              <p>
                Anyone can read it. Members post, comment, vote and flag, and every member was
                invited by another: your name will appear under{' '}
                <a href={`/u/${invite.inviter.login}`} translate="no">
                  {invite.inviter.login}
                </a>{' '}
                on the public <a href="/tree">invite tree</a>.
              </p>
              {ctx.viewer ? (
                <p>
                  You are already signed in as <strong translate="no">{ctx.viewer.login}</strong>,
                  so this invitation is not needed. Pass it on to the person it was meant for.
                </p>
              ) : ctx.signin === 'github' ? (
                <>
                  <p>
                    <GitHubButton href={`/auth/github?invite=${encodeURIComponent(props.code)}`} />
                  </p>
                  <p>
                    Signing in with GitHub creates your account and uses up this link. We ask GitHub
                    for your public profile only. The link works until{' '}
                    <time datetime={isoTime(invite.expiresAt)}>{longDate(invite.expiresAt)}</time>.
                  </p>
                </>
              ) : (
                <p>
                  Sign-in opens soon. Come back to this link then; it works until{' '}
                  <time datetime={isoTime(invite.expiresAt)}>{longDate(invite.expiresAt)}</time>.
                </p>
              )}
              <p>
                <a href="/about">More about heka news</a>
              </p>
            </>
          ) : (
            <>
              <p class="lede">
                {invite?.status === 'used'
                  ? 'Someone has already used this invitation link. Each link creates one account.'
                  : invite?.status === 'expired'
                    ? `This invitation expired on ${longDate(invite.expiresAt)}. Links last ${RULES.inviteTtl / 86400} days.`
                    : invite?.status === 'revoked'
                      ? 'The member who made this invitation withdrew it.'
                      : 'There is no invitation at this address. Check that the link was copied whole.'}
              </p>
              <p>
                Ask the person who sent it for a new one. If you are already a member,{' '}
                <a href="/signin">sign in</a>.
              </p>
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}

/** GitHub sign-in worked, but this account cannot join: no invitation, banned, or a clash. */
export function SigninRefusedPage(props: {
  ctx: PageContext
  reason: 'not-invited' | 'invite' | 'banned' | 'login-taken' | 'failed' | 'cancelled'
  login?: string
}) {
  const { ctx, reason } = props
  const titles = {
    'not-invited': 'Membership is by invitation',
    invite: 'That invitation no longer works',
    banned: 'This account is banned',
    'login-taken': 'That login is already taken here',
    failed: 'Signing in did not work',
    cancelled: 'Sign-in was cancelled',
  } as const
  return (
    <Layout ctx={ctx} title={titles[reason]} description={titles[reason]} noindex>
      <div class="wrap">
        <header class="page-head">
          <h1>{titles[reason]}</h1>
        </header>
        <div class="prose reading">
          {reason === 'not-invited' && (
            <>
              <p class="lede">
                GitHub knows you as <strong translate="no">{props.login}</strong>, but that account
                is not a member of heka news, and we have not created one.
              </p>
              <p>
                Members join through an invitation link from another member. If someone has sent you
                one, open that link and sign in from there.{' '}
                <a href="/about#membership">How membership works</a>
              </p>
            </>
          )}
          {reason === 'invite' && (
            <p class="lede">
              The invitation was used, revoked or expired before you finished signing in. No account
              was created. Ask the person who sent it for a new link.
            </p>
          )}
          {reason === 'banned' && (
            <p class="lede">
              A moderator banned <strong translate="no">{props.login}</strong>. The reason is in the{' '}
              <a href="/moderation">moderation log</a>.
            </p>
          )}
          {reason === 'login-taken' && (
            <p class="lede">
              Another account here already uses the login{' '}
              <strong translate="no">{props.login}</strong>, probably from before a rename on
              GitHub. Ask a moderator to sort it out; no account was changed.
            </p>
          )}
          {reason === 'failed' && (
            <p class="lede">
              The sign-in link expired or was opened in another browser, or GitHub did not answer.
              Nothing was changed. <a href="/signin">Try again</a>.
            </p>
          )}
          {reason === 'cancelled' && (
            <p class="lede">
              You did not give GitHub permission, so you are not signed in.{' '}
              <a href="/signin">Try again</a> when you are ready.
            </p>
          )}
        </div>
      </div>
    </Layout>
  )
}

const STATUS_WORDS = {
  open: 'Open',
  used: 'Used',
  expired: 'Expired',
  revoked: 'Withdrawn',
} as const

function InviteList({ ctx, invites }: { ctx: PageContext; invites: InviteRow[] }) {
  if (invites.length === 0) {
    return <p class="muted">You have not invited anyone yet.</p>
  }
  return (
    <ul class="invites">
      {invites.map((invite) => (
        <li class={`invite invite--${invite.status}`}>
          <p class="invite__line">
            <span class="invite__status">{STATUS_WORDS[invite.status]}</span>{' '}
            {invite.note && (
              <span class="invite__note" dir="auto">
                {invite.note}
              </span>
            )}
          </p>
          <p class="invite__meta">
            Made {longDate(invite.createdAt)}.{' '}
            {invite.status === 'open' && <>Works until {longDate(invite.expiresAt)}.</>}
            {invite.status === 'used' && invite.usedBy && (
              <>
                Joined as{' '}
                <a href={`/u/${invite.usedBy.login}`} translate="no">
                  {invite.usedBy.login}
                </a>
                .
              </>
            )}
            {invite.status === 'expired' && <>Expired {longDate(invite.expiresAt)}.</>}
          </p>
          {invite.status === 'open' && (
            <form class="invite__revoke" method="post" action={`/invites/${invite.id}/revoke`}>
              <Csrf ctx={ctx} />
              <button class="button button--quiet button--small" type="submit">
                Withdraw
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  )
}

export interface SettingsForm {
  displayName: string
  bio: string
  note: string
  errors: Errors
  previewHtml?: string | null
}

export function SettingsPage(props: {
  ctx: PageContext
  login: string
  form: SettingsForm
  invites: InviteRow[]
  /** Set right after an invitation is made: the one time its link can be shown. */
  newInvite?: { url: string; note: string; expiresAt: number }
  saved?: boolean
}) {
  const { ctx, form, invites } = props
  const profileErrors = { ...form.errors }
  delete profileErrors.note
  const focus = firstError(profileErrors, ['display_name', 'bio'])
  const open = invites.filter((i) => i.status === 'open').length
  return (
    <Layout
      ctx={ctx}
      title="Settings"
      description="Your heka news profile and invitations."
      canonical="/settings"
      noindex
      scripts={['forms', 'copy']}
    >
      <div class="wrap settings">
        <header class="page-head">
          <h1>Settings</h1>
          <p>
            Signed in as{' '}
            <a href={`/u/${props.login}`} translate="no">
              {props.login}
            </a>{' '}
            through GitHub.
          </p>
        </header>

        {props.newInvite && (
          <section class="callout" aria-labelledby="new-invite">
            <h2 id="new-invite" class="section-title section-title--first">
              Your invitation link
            </h2>
            <p>
              Send this to the person you are inviting. It works once, until{' '}
              {longDate(props.newInvite.expiresAt)}. We only keep a fingerprint of it, so this is
              the only time it is shown.
            </p>
            <div class="copy-field">
              <label class="sr-only" for="invite-link">
                Invitation link
              </label>
              <input
                class="input input--mono"
                id="invite-link"
                type="text"
                readonly
                value={props.newInvite.url}
                spellcheck={false}
                autocomplete="off"
              />
              <button class="button" type="button" data-copy="invite-link" hidden>
                Copy link
              </button>
            </div>
          </section>
        )}

        <section aria-labelledby="profile-heading">
          <h2 id="profile-heading" class="section-title">
            Profile
          </h2>
          {props.saved && (
            <p class="notice" role="status">
              Saved. <a href={`/u/${props.login}`}>See your profile</a>
            </p>
          )}
          <form
            class="form"
            method="post"
            action="/settings/profile"
            data-preview="comment"
            novalidate
          >
            <Csrf ctx={ctx} />
            <ErrorSummary
              errors={profileErrors}
              labels={{ display_name: 'Display name', bio: 'Bio' }}
            />
            <TextField
              name="display_name"
              label="Display name"
              value={form.displayName}
              hint="Shown on your profile under your login. Leave it empty to show only the login."
              error={form.errors.display_name}
              autocomplete="name"
              limit={LIMITS.displayName}
              focus={focus === 'display_name'}
            />
            <TextArea
              name="bio"
              label="Bio"
              value={form.bio}
              hint={MARKDOWN_HINT}
              error={form.errors.bio}
              rows={5}
              limit={LIMITS.bio}
              focus={focus === 'bio'}
            />
            <Preview html={form.previewHtml} />
            <FormActions label="Save profile" sending="Saving…" preview />
          </form>
        </section>

        <section aria-labelledby="invites-heading">
          <h2 id="invites-heading" class="section-title">
            Invitations
          </h2>
          <p class="section-intro">
            Invite someone whose work you know. Each link makes one account, lasts{' '}
            {RULES.inviteTtl / 86400} days, and puts the new member under you on the{' '}
            <a href="/tree">invite tree</a>. {open > 0 && `${plural(open, 'link')} still open.`}
          </p>
          <form class="form form--inline" method="post" action="/settings/invites" novalidate>
            <Csrf ctx={ctx} />
            <TextField
              name="note"
              label="Who is it for? (optional)"
              hint="A note for you; the person you invite does not see it."
              value={form.note}
              error={form.errors.note}
              limit={LIMITS.inviteNote}
              focus={Boolean(form.errors.note)}
            />
            <FormActions label="Make an invitation link" sending="Making…" />
          </form>
          <InviteList ctx={ctx} invites={invites} />
        </section>

        <section aria-labelledby="session-heading">
          <h2 id="session-heading" class="section-title">
            Signing out
          </h2>
          <form method="post" action="/signout">
            <Csrf ctx={ctx} />
            <button class="button button--quiet" type="submit">
              Sign out
            </button>
          </form>
        </section>
      </div>
    </Layout>
  )
}
