# Work with HQBot

Choose a conversation on the left and describe the result you need. The list contains individual
teammates and groups. Use **New conversation** to create a teammate, start a group, or use a template.
Teammates continue working in Cloudflare when you close the page.

Use the pinned **Chief of Staff** conversation for work that needs several teammates. It owns the
final answer, assigns separate jobs, waits for results, and reviews their evidence. Each team task
has completion checks, a deadline, and a shared model budget. You can allow other teammates to
manage work. A task can have a Chief, managers, and specialists: at most two delegation levels
below its owner. A specialist cannot add another management layer.
Every manager reviews its direct reports. Stop the main task to stop every branch and its pending
approvals. You can still talk to any specialist directly.

Open **Agent settings → Team management** to choose who can manage or create teammates, the models
they can use, and their limits. Creating teammates is off by default. New employees keep separate
memory, files, connections, and permissions. You can also allow a manager to create other managers;
those new managers cannot hire unless you enable it. Within a task, they still cannot add a third
delegation level. Group leads can manage their own groups.

Specialists can ask other active specialists on the same task for facts they already have.
Questions do not create work or grant access. Each assignment can ask three questions, one at a
time, with twenty questions per task. Questions close after ten minutes or when a participant is
no longer available. A waiting specialist resumes when an answer or closure arrives. Activity shows
who asked, who answered, and the saved exchange. Results still go to the responsible manager for review.

Use **Activity → Progress** to see who reports to whom, the assigned model, saved progress, and
reviewed results. Expand an active assignment to **Check in** or **Change guidance**. The request
is saved and read at the next safe model step. A tool call or pending approval finishes first.
Managers also receive milestone and blocker reports automatically. They wait without repeated
model calls. Work branches share the main task's limit; passing one branch down does not use an
extra branch. The daily team model budget covers all tasks that manager owns and resets at
midnight UTC. Existing workspace, teammate, and task budgets still apply.

An approved service call stays with its assignment until the teammate has processed the result.
If a result is too long for one reply, the teammate can read its saved pages without calling the
service again. Activity keeps the full action record. Chat shows a short service update.

Click the conversation name or the **info** button to open its sidebar on the right. On a phone,
it opens in a sheet. Close it to return to your messages. The sidebar starts closed.

Conversation info keeps these controls with the selected teammate:

- **Files:** preview or download files attached in the conversation or saved by the teammate.
- **Integrations:** connect services for this teammate and manage its existing connections.
- **Memory:** add, edit, review the history of, or forget a saved preference or fact.
- **Skills:** review and edit reusable methods, use a ready skill, or record a demonstration and
  review the generated draft.
- **Routines:** create scheduled or event-based work, edit it, test it now, inspect its history,
  or pause it. Events support GitHub, Slack, and signed generic webhooks.
- **Permissions:** review computer access and exact rules for connected actions.
- **Activity:** use Progress for team assignments, saved tasks, checks, and timelines. Use Actions
  for connected-action outcomes; expand an action to inspect its input and result.
- **Cost:** inspect estimated use and budgets. Expand resource counts for Cloudflare details.
- **Agent settings:** change the teammate profile, model, turn limits, and team management policy.

The **Computer** button opens the live computer in the same right-side area. Use its back button
to return to conversation info. The live screen appears when the teammate uses its computer.
Opening or closing the sidebar does not start or stop work. Stop remains available in the chat.
Task progress shows the saved state and next wake time. A waiting task uses its saved wake-up;
it does not need an active model turn. A cancelled task stays stopped after a restart. New
cancellations show their reason. Older tasks can say that the reason was not recorded.

Each teammate keeps its own files, memory, integrations, credentials, routines, computer, and browser
logins. A group is a project conversation with selected teammates. Its info sidebar shows members
and shared files and skills. Use **Edit group** to choose its lead and exactly which items to share.
Group requests go to the lead, which assigns work and returns one answer. Stopping a team task
owner stops its remaining assignments and clears their pending approvals. Actions records those
calls as denied. A specialist uses its own connections and approval rules.

Unread badges and approval cards show what needs attention. Approval cards also refresh when
background work asks for review, and after the chat reconnects. The small bell below the conversation
list opens saved updates. The search button beside the list filter, or Cmd+K on Mac and Ctrl+K
elsewhere, searches messages and saved work. Search results can prepare a conversation draft.

The small **Settings** button below the list holds appearance, sign out, people, network policy,
and devices. Enable browser notifications under Devices. Invited project members can read the full
history and files of its teammates, so use separate teammates for confidential projects.

Most work can continue after you give the teammate a clear task and suitable permissions. A tool
approval is for an action that needs review, such as sending a message through a newly connected
service. You can add an exact, scoped allow rule for a repeated action. Rules can expire or apply
to one task. A service's claim that a tool is read-only does not grant access. A local command
always asks in the Mac companion because it runs with your Mac account.

Under **New conversation → Use a template**, copy selected skills and routines into a reusable
teammate. Imports start with draft skills and paused routines. Review the whole template before
publishing a public link. Templates do not include memory, files, connections, or credentials.
Revoke a link to stop future downloads; a copy already downloaded stays with its recipient.

Install the web app from your browser, or build the [native clients](../clients/README.md). The web
app uses an offline page when disconnected; it does not cache conversations or files for offline
reading. Server work continues. Push and screen recording need a supported browser.

When a task needs your approval, its card appears in the conversation, including requests from
specialists working on that task. Review the action and choose Approve or Deny there. Use
Conversation info → Permissions to change persistent rules.

When the agent needs you to sign in, the live computer appears in the chat. Enter your credentials
on the computer, then select **I’m done—continue**. You can expand the screen. If the connection
expires, select **Reconnect computer**. You do not need to find another teammate or type a resume
message. The saved task continues with the same permissions and budget.
