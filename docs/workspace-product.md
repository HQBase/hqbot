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
- [ ] Calendar routines, test runs, editing, and run history.
- [ ] Signed generic, GitHub, and Slack event adapters with replay protection.
- [ ] Device push, durable delivery, and notification preferences.
- [ ] Connector catalog and setup controls.
- [ ] Demonstration recording and draft skill generation.
- [ ] Threads, reactions, mentions, search, and safe artifact previews.
- [ ] Bot duplication, template import/export, and revocable public sharing.
- [ ] Responsive workspace UI and installable web app.
- [ ] Desktop client and opt-in local execution companion.
- [ ] iOS and Android clients and build instructions.
- [ ] Team roles, invitations, access checks, and administration.
- [ ] Fresh/update migration tests, full local gates, rendered UI checks, and deployed acceptance.

Native store publication needs the maintainer's signing accounts. Source/build validation and store
publication are separate release states. Long-duration reliability remains subject to the existing
endurance test; do not wait 24 hours to finish immediate validation.
