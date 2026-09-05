# Teammates, projects, and autonomous work

This specification defines the requested workspace expansion. The implementation checklist below
tracks delivery. Existing behavior stays supported while each change is built and tested.

## Everyday interface

Conversations are the main work surface. The left navigation contains Inbox, Teammates, Projects,
Library, and Automations. Search finds messages and saved work. A conversation opens its computer
or task details only when needed. Settings holds access, usage, connections, devices, and recovery.
The same layout must work on a phone. Each action shows progress, an outcome, or a useful error.

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
- Projects explicitly select teammates and shared files or skills. Computer sessions and logins
  stay separate. Group conversations and direct handoffs carry bounded context, ownership, and
  durable delivery IDs. Stop, budget limits, and delegation depth limits also apply to handoffs.
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
  cannot use the native command bridge. Mobile builds support the same hosted work and decisions.
- Team access uses named accounts, roles, project membership, revocable invitations, and an audit
  trail. Authorization applies to HTTP, realtime connections, artifacts, and agent RPC entrypoints.
  Network and connector restrictions are enforced before tool execution.

## Delivery checklist

Checked items are implemented with local checks. Deployment and rendered acceptance remain a
separate gate at the end of this list.

- [x] Agent-managed memory and skill revisions, history, and library controls.
- [x] Scoped permissions for computer actions and MCP calls.
- [x] Projects, shared resources, direct handoffs, and group work.
- [x] Calendar routines, test runs, editing, and run history.
- [x] Signed generic, GitHub, and Slack event adapters with replay protection.
- [x] Device push, durable delivery, and notification preferences.
- [x] Connector catalog and setup controls.
- [x] Demonstration recording and draft skill generation.
- [x] Threads, reactions, mentions, search, and safe artifact previews.
- [ ] Bot duplication, template import/export, and revocable public sharing.
- [ ] Responsive workspace UI and installable web app.
- [ ] Desktop client and opt-in local execution companion.
- [ ] iOS and Android clients and build instructions.
- [ ] Team roles, invitations, access checks, and administration.
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
