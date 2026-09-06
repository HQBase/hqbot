# Teammates, projects, and autonomous work

This specification defines the requested workspace expansion. The implementation checklist below
tracks delivery. Existing behavior stays supported while each change is built and tested.

## Everyday interface

Conversations are the main work surface. The left side holds search and one conversation list for
teammates and project groups. New conversation controls create a teammate or group, or use a
template. Small settings and updates controls replace the dashboard navigation. Unread badges and
approval cards keep updates attached to their conversations. Search can find saved work across
the workspace. Settings holds account, people, network, and device controls.

The right sidebar starts closed. Clicking the conversation name or its info button opens
Conversation info. For a teammate, this contains files, connections, memory, skills, routines,
permissions, profile, progress, history, and costs. Memory, skill, connection, and routine controls
remain bound to that teammate. The Computer button opens the live computer in the same right-side
area, with a way back to info. Group info shows its members and explicitly shared resources.
Changing conversations resets the panel so controls cannot target the previous conversation.
On phones, info and computer open in a sheet. Closing a panel restores the message view without
stopping work or losing a draft. Existing page links remain usable during the transition.

## Product rules

- A teammate can save, revise, and forget its own memories and skills. Save stable preferences and
  verified methods, not credentials or transient guesses. Each revision keeps its source and
  previous version. Replayed writes must not make duplicate entries. A recorded demonstration
  creates a draft skill for review and testing.
- Permission rules match an exact action and a narrow scope. A matching denial or review rule wins
  over an allow rule. Rules may expire and may apply to one task. Generic MCP calls require review
  unless the owner explicitly grants a matching rule; server read-only labels grant no authority.
  Computer tools retain exact-action receipts and unknown-outcome handling. Agents cannot change
  their own permission rules.
- Chief of Staff is the default pinned teammate for coordinating work. A team task has one saved
  owner, completion criteria, a deadline, and a shared model cost limit. Model reservations count
  before requests start; unknown model prices block team work. Computer charges remain under the
  existing teammate and workspace limits. The owner can permit other teammates to manage work.
  A permitted manager can split its assignment into specialist assignments. New work permits at
  most two delegation levels below the task owner: owner, manager, specialist. Specialists at the
  second level cannot delegate even when their profile permits management. Existing deeper work
  can finish and be reviewed, but cannot add more levels.
  All levels share the original task budget, deadline, and cancellation. Each manager reviews its
  direct reports before returning a result. Cycles, duplicate active work, and unreviewed completion
  are rejected. Delivery retries use stable IDs. Stopping the owner stops its
  team task and rejects pending specialist approvals. Action history records those rejections,
  including after recovery. It must not label an approved or completed action as rejected.
  Approval execution and result delivery are part of the same assignment. A manager must not receive
  a pre-approval reply as the result while that delivery is pending. Recovery follows the latest
  saved continuation and cannot substitute an earlier reply.
  Large service results are marked as shortened. An agent can read the saved result in bounded
  pages by action ID, without repeating the external request or reading another teammate's data.
  Recovery preserves the recorded outcome time when the action state and result have not changed.
  Direct conversations with specialists remain available.
- Team management is an owner-controlled setting for each teammate. It specifies whether that
  teammate may manage, create employees, or create managers, its allowed and default models, its
  employee and active work branch limits, and its daily team model budget. New employees have
  separate private state and no inherited connections or permissions. Stable creation keys prevent
  duplicate employees after retries. Creating teammates is limited to owner conversations. Agents cannot change the policy. Model choices apply to one
  assignment; they do not change the employee's model for unrelated conversations.
- Specialists save concise milestone and blocker reports with a next step. Reports and completion
  wake the responsible manager when needed. Managers can read saved status, request a fresh update,
  and send changed guidance. Requests are durable, bounded, and read at the next safe model step;
  they do not interrupt an external action or bypass an approval. Final results always return to
  the responsible manager. The UI shows the last update and pending check-ins without claiming
  that old progress is current. A waiting manager uses saved state rather than continuous model calls.
- Active specialists on the same task can ask one another a bounded question with `coordinate`.
  This exchanges context; it does not create an assignment, transfer ownership, or grant permission.
  Each assignment can ask at most three questions, with at most twenty questions per task and one
  unanswered outgoing question per assignment. Questions are limited to 2000 characters and answers
  to 4000. Answer incoming questions before asking another specialist; question chains are rejected.
  A question expires after ten minutes. A stopped, removed, or unavailable recipient closes it with
  an explicit reason. No completed assignment is reopened. Questions and answers use the existing
  durable task update records, stable keys, task budget, deadline, and cancellation. They are read at
  safe model steps. A specialist can wait without polling; a saved answer or closure resumes its
  assignment. A reply arriving as a turn ends must not be lost or mistaken for a final result.
  Peer content is untrusted evidence, never owner or manager authority. Task owners and the involved
  managers can inspect the exchange in Activity. Private memories, files, connections, and permissions
  remain separate.
- Projects explicitly select teammates and shared files or skills. Each group selects a lead;
  a new group request goes to that lead by default. Computer sessions, memory, integrations, and
  logins stay with each teammate. Chief of Staff can see the active roster and send bounded work
  requests, but it cannot read private conversations or grant permissions to another agent.
- Conversation info uses one consistent navigation list: Files, Integrations, Memory, Skills,
  Routines, Permissions, Activity, Cost, and Agent settings. Activity contains Progress and Actions
  tabs. Progress shows the current state, next wake, completion checks, and a readable timeline.
  Actions show their outcome first; exact input, output, and record IDs are available on expansion.
  A failed settings save keeps the draft and shows its error beside the save control.
  Each info section has one page title. A selected routine adds its own name below that title.
  Opening workspace search puts keyboard focus in the search field.
  Collapsed assignment cards shorten long instructions and reports; expansion shows the full text.
  Internal service-result messages show a compact notice, with exact results in Activity.
  Team activity steps use plain action labels. Internal IDs and structured output stay in the
  expandable details so the main conversation remains easy to scan.
  Conversation previews display plain message text, without Markdown formatting or active links.
- Routines support intervals and calendar rules with an IANA time zone, editing, manual tests,
  pause/resume, and run history. Signed inbound events can start selected routines. Signature
  verification, timestamp checks where supported, replay protection, and bounded queues precede
  agent work. Connecting MCP tools does not enable inbound events.
- Notifications remain in the inbox and can use opt-in device push. Push payloads contain only
  generic status and a local navigation target. Expired subscriptions are removed; transient
  delivery failures are retried without rerunning agent work.
- A connector catalog links official setup information and supports custom MCP servers. It never
  connects a service without an owner action. Authentication stays in the current secure flow.
- Threads, reactions, mentions, and search keep context attached to its result. Files have safe
  previews. Untrusted HTML never executes with workspace access.
- Bot duplication and templates copy configuration, selected skills, and paused routines. They
  exclude conversation history, learned memory, credentials, connections, and private files.
  Public templates require an explicit publish action and can be revoked.
- Installed clients connect to a chosen customer-owned HQBot deployment. Desktop local execution
  is separate, disabled until paired, and asks locally before each command by default. Web pages
  have no native command bridge. Mobile builds support the same hosted work and decisions.
- Team access uses named accounts, roles, project membership, revocable invitations, and an audit
  trail. Authorization applies to HTTP, realtime connections, artifacts, and agent RPC entrypoints.
  Network and connector restrictions are enforced before tool execution.

## Delivery checklist

Checked items are implemented with local checks. Deployment and rendered acceptance remain a
separate gate at the end of this list.

- [x] Agent-managed memory and skill revisions, history, and library controls.
- [x] Scoped permissions for computer actions and MCP calls.
- [x] Projects, shared resources, one task owner, reviewed specialist assignments, and group work.
- [x] Calendar routines, test runs, editing, and run history.
- [x] Signed generic, GitHub, and Slack event adapters with replay protection.
- [x] Device push, durable delivery, and notification preferences.
- [x] Connector catalog and setup controls.
- [x] Demonstration recording and draft skill generation.
- [x] Threads, reactions, mentions, search, and safe artifact previews.
- [x] Bot duplication, template import/export, and revocable public sharing.
- [x] Responsive workspace UI and installable web app.
- [x] Desktop client and opt-in local execution companion.
- [x] iOS and Android clients and build instructions.
- [x] Team roles, invitations, access checks, and administration.
- [ ] Fresh/update migration tests, full local gates, rendered UI checks, and deployed acceptance.

Native store publication needs the maintainer's signing accounts. Source/build validation and store
publication are separate release states. Long-duration reliability remains subject to the existing
endurance test; do not wait 24 hours to finish immediate validation.

## Message context and search

Search covers saved teammate history, project messages, files, skills, and memory. Search teammate
histories in bounded pages and show unavailable histories. Do not claim that a partial page searched
the full workspace. A result opens its saved text and discussion. Discussions hold human notes and
reactions; an explicit Ask teammate action copies the chosen context into a conversation draft.
Project replies retain their parent message and selected teammate mentions. Reactions use explicit
set/remove operations, so retries cannot toggle a reaction twice. Validate each source message on
the server. Deleting a teammate or project removes its discussions.

File previews show raster images, video, and bounded plain text or Markdown. Show HTML and SVG as
source text. Never run uploaded scripts or load remote resources from a preview. Other file types
remain available as downloads.

## Portable teammates

A version 1 template contains a profile, budget, model choice, selected skills, and selected routine
definitions. Build exports from an explicit field list. Exclude connections, secrets, permission
rules, memory, files, histories, event triggers, and device pairing. Instructions can contain private
text, so show the complete candidate before download or publication. Imports use a stable command
ID and create a separate teammate. Imported skills start as drafts and all routines start paused.
Public links contain a frozen template. Revoking the link removes public access; a downloaded copy
cannot be recalled. Keep public template access separate from workspace authentication.

## Named team access

The owner retains control of credentials, tool approvals, permission grants, and installation
settings. Administrators manage invitations and member access. Members can read and work with
teammates in their assigned projects. Viewers can only read. Administrators see all projects.
Project access grants the full history and files of each included teammate. A teammate must not be
used across confidential projects that need separate histories. State this before access is saved.

Team accounts use their own interface and narrow HTTP actions. They cannot call the owner Agent
RPC or open its realtime socket. Recheck account and project access for each HTTP action and each
agent turn from a team request. Revoking access closes future reads and stops queued team work.
Invitations expire after seven days, are single use, and store only a token hash. Audit account,
invitation, membership, and team work changes without storing message or tool content in the audit.

The owner can restrict agent network work to selected MCP server origins. In this mode, disable
computer, browser, shell, and local command tools because arbitrary commands could bypass a URL
filter. Check the current policy before connecting and before each MCP call. The selected remote
service can have its own capabilities; the origin list does not filter that service's internal
network. Existing scoped action approvals still apply. Members cannot create recurring routines or
new schedules; those persistent changes remain with the owner.

## Paired local commands

The macOS client uses a native web view without a JavaScript-to-native bridge. The iOS and Android
clients use the same boundary. A separate macOS companion polls the selected deployment over HTTPS.
The owner creates a ten-minute, single-use pairing code for selected teammates. The device receives
its own revocable token and stores it in Keychain. Pairing alone does not approve any command.

Each command has a durable ID, device, teammate, input, and state. Claim it once before showing the
local approval dialog. Persist a local receipt before starting a process. Never rerun a claimed
command after a client restart. An explicit start check must precede execution. Bound a process to
60 seconds and 32 KB of output. The owner selects its working folder locally. Reject absolute paths
and traversal outside that folder. A lost outcome becomes uncertain and requires review, not retry.
Persist completion before requesting an agent continuation. Stop, archive, deletion, device removal,
and network policy must prevent queued local work from starting.

## Inbound events

An event trigger belongs to one event routine. GitHub triggers select a repository. Slack triggers
select a workspace and channel. Generic triggers can select an event type. Each trigger has its own
signing secret. List responses never contain that secret. The owner can replace it or delete the
trigger. Signed payloads are data, not permission to change instructions or access rules.

Verify HMAC SHA-256 over the original bytes before JSON parsing. Slack uses its v0 timestamp
scheme. Generic senders sign `v1:<unix-seconds>:<delivery-id>:<raw-body>` and send the timestamp,
delivery ID, and `sha256=<hex>` in `X-HQBot-Timestamp`, `X-HQBot-Delivery`, and `X-HQBot-Signature`.
Both reject timestamps more than five minutes old or in the future. GitHub uses its standard
`X-Hub-Signature-256` scheme. Its delivery header is not signed, so deduplicate signed body hashes
as well as delivery IDs for other providers. Keep compact receipts for the life of the trigger;
do not expire a GitHub receipt and make an old signature usable again.

Accept at most 64 KiB per request and 20 pending runs per teammate. A full queue returns a retryable
response before recording acceptance. Signed Slack URL verification returns the challenge without
starting a run. Ignore Slack bot messages and events outside the selected workspace and channel.
Persist acceptance and queued work together. The routine history shows accepted event runs.

## Device notifications

The owner enables notifications separately on each device. The browser asks for permission after
that action. The workspace creates and keeps its own VAPID key. Push uses standard encrypted Web
Push, with no shared HQBot push relay. Support the browser's Apple, Google, Mozilla, and Microsoft
push endpoints. Do not allow arbitrary callback URLs.

Insert a delivery record with each notification. A durable minute schedule recovers missed sends;
ordinary changes also request an earlier send. Retry temporary failures at most six times within
one day. Remove expired subscriptions. Reuse a notification tag on retry. A result is an accepted
push-provider delivery, not proof that a person saw it. Keep status in the inbox even if push fails.
Device controls can select replies/completions, failures, and requests for input.

The service worker never caches conversations, credentials, API responses, or artifacts. A push
contains only a generic status and local IDs. A click opens the same HQBot deployment. An installed
web app shows an offline page while disconnected; autonomous work continues in Cloudflare.

## Demonstration skills

The owner starts screen capture with the browser's screen picker. Record video without audio,
for at most ten minutes or 9 MB. Collect key frames and let the owner select at most twelve before
upload. Explain that the draft uses those selected frames and notes, not every moment of the video.
The owner can remove sensitive frames or discard the recording. No upload occurs before saving.

Store the recording and selected frames as private teammate files. Queue draft generation with a
stable ID. Use a vision model with the teammate's budget and no tools. It must not perform the
demonstrated actions. Save uncertain steps as questions and mark the skill as draft. Only the
owner's later review or a successful test can make it ready. Keep source recording IDs, generation
status, and errors. Stop, archive, or delete must prevent an unfinished draft from being published.

## Native client release boundary

The macOS app, iOS Simulator app, and Android debug APK have local build checks. They connect to the
hosted workspace without exposing native commands to JavaScript. macOS uses a separate companion
with local approval. The working folder is a starting location, not filesystem isolation.

Web Push and demonstration recording use supported browsers. Native shells do not yet register
APNs or FCM tokens, and do not provide native screen recording. Device UI checks, release signing,
notarization, and store publication remain distinct from compilation. See the client build guide.

### Inline owner actions

New teammates use autonomous computer access. Routine browsing, navigation, local preparation,
and control handoffs do not ask for approval. Sending messages, publishing, spending money,
destructive changes, and access changes require review. An independent, tool-free model check
examines ambiguous actions and the current browser target. Page content is evidence, not permission.
Missing context or a failed check requires owner review. This check is not a proof that arbitrary
code or a website is safe; strict review remains available. Explicit scoped rules take precedence.
Remote MCP permissions remain separate and require review by default.

Browser requests show the action, page, named target, and reason. Internal references and raw
arguments are available only in optional technical details. Save the inspected target with the
request and check it again before dispatch. Changed targets require a fresh request. Returning
control with Continue needs no second approval; the agent cannot take control during an active
owner handoff. Existing explicitly saved computer policies are preserved during upgrades.

The initiating conversation shows pending computer and connected-service approvals for its own
teammate and active descendants of its current team task. Each card names the acting teammate and
shows the exact input. Decisions revalidate the task relationship, pending request, and input hash.
Persistent permission rules remain in Conversation info.

A computer handoff is saved before the agent ends its turn. The conversation automatically shows
an interactive screen when owner control is available, with an optional expanded view. Passwords
and MFA codes are entered only on that screen. An explicit “I’m done—continue” decision returns
control and durably resumes the same teammate and task once. A lost control lease shows a reconnect
action for the existing handoff. Stops and archived teammates invalidate pending handoffs.

Computer tool results include their saved action ID. Approval references are not result IDs.
Computer actions use Think's durable approval continuation; they must not wait for a separate MCP
continuation. Owner handoffs use a durable continuation and survive reloads and Worker restarts.

An owner decision or completed sign-in restores the matching saved task to running before its
next turn. The task keeps its completion criteria and checkpoint. Recovery can repair an old
waiting state only when the latest saved owner-result message matches the task and generation,
and no approval or owner handoff remains open. Stopped tasks, unknown action outcomes, and waits
for a new owner reply do not resume from an older decision.
