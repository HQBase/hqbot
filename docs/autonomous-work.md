# Autonomous work and recovery

HQBot must preserve work across turns and restarts. A long run is complete only after the agent
checks its saved completion criteria. A text reply alone does not complete an active task.

## Required controls

- Bind each approval to the execution, call sequence, and exact input. Reject old decisions.
- Keep a durable action history. An unknown external result blocks automatic retry until the
  owner records the result or confirms that the action did not happen.
- Resume the model after the last approval result with a durable, unique submission.
- Check and reserve budget before each model request. Show unknown prices and apply token and
  request limits to models without prices. Bound each turn; save work before further turns.
- Save completion criteria, evidence, and milestones. Stop repeated actions, unchanged progress,
  and repeated failures. Retry temporary failures with a bounded delay.
- Compact context, keep searchable history, and recover from context overflow. Retrieve recent
  or relevant memories in pages. Discover all skills and load complete instructions on demand.
- Require owner permission for computer actions that can change data or run arbitrary code.
  Remote MCP calls require review by default. An explicit owner rule can allow a matching action
  and input, with an optional expiry or task limit. A denial or review rule wins over an allow rule.
- Keep versioned computer backups. A failed restore must preserve both the backup and current
  files. Show checkpoint failures and provide owner export and restore controls.
- Show durable notifications when work completes, fails, or needs owner input.
- Ignore stale page requests after the owner selects another teammate.
- Project saved task state to the workspace in one transaction. Ignore older or repeated
  projections. Recovery must preserve final task states, real activity times, and newer chat
  activity. A future wake-up is waiting work, not an active model turn.
- Keep the cancellation reason in the task and its history. Distinguish an owner stop, a policy
  change, and a stopped runtime turn. An old cancellation with no reason must remain unknown.
  Never restart a cancelled task as part of recovery.

## Validation

Local tests cover fresh and updated storage, stale approval replay, distinct identical calls,
continuation, budget limits, lost processes, context recovery, and backup failures. A deployed
workflow must cover approval, continued work, a saved deliverable, and restart recovery. Record
completion, duration, and cost. A 24 to 72 hour soak run is required before claiming that duration
is proven. A short test cannot establish multi-day reliability.

### Deployed test procedure

Use `scripts/evaluate.mjs` with owner credentials supplied through `HQBOT_EVAL_USERNAME` and
`HQBOT_EVAL_PASSWORD` in the environment. Set `HQBOT_EVAL_URL` for another installation. Do not
put credentials in commands, state files, or test reports. The script records only safe IDs,
times, state, revision tags, and cost estimates. It does not approve actions or change permissions.

1. Run `node scripts/evaluate.mjs prepare /tmp/hqbot-smoke.json smoke`. This creates a separate
   test teammate. Connect the public Cloudflare Documentation MCP server to that teammate.
2. Run `node scripts/evaluate.mjs start /tmp/hqbot-smoke.json`. In HQBot, inspect and approve the
   exact public documentation call and required file commands. Run `check` with the same state
   file to inspect progress. The first completed task waits for the recovery test.
3. Run `node scripts/evaluate.mjs recover /tmp/hqbot-smoke.json`. This saves the test computer,
   stops and restores it, and asks the agent to verify the saved file in a second task. Review
   its computer actions. Run `check` again. Keep the teammate and files as review evidence.
4. Prepare a second test with `prepare /tmp/hqbot-soak.json soak 24` (up to 72 hours), then use
   `start`. The agent uses durable hourly wake-ups with a fixed end time. Run `check` during the
   test and after its deadline. Review the final file command. Use `stop` to cancel the test.

The soak task runs in Cloudflare even when the local command ends. Local checks only collect
measurements. Check at least once near the end of each UTC day to retain each day's cost estimate.
Missing prices and unsettled requests stay visible. A test with no completion evidence cannot
pass merely because its timer expired. Inspect milestone spacing in the final report. For restart
coverage, deploy a revision while the soak task has a future wake-up and verify its next milestone.
Record both revision tags. A passing soak establishes this workload and duration only; it does
not establish continuous high-load performance or reliability for every connected service.

## Owner notifications

The Inbox keeps completion, failure, and input requests in workspace storage. Device push is opt-in
and can work while HQBot is closed. It uses the installation's own signing key and encrypted Web
Push. Alerts contain only a generic status and local navigation IDs. Failed delivery does not
remove the saved inbox update or repeat the agent task. See [device notifications](notifications.md).
Task progress shows saved criteria, milestones, and completion evidence in teammate details.

Each turn supplies the current UTC time for scheduling. The agent calls a required computer tool
once; the runtime creates its approval card. Finite tasks save their next checkpoint with a
one-time schedule. They do not need a computer command only to read the clock.

Computer approval decisions are saved as new turn context before the runtime applies them. This
lets the result resume a task that was parked for approval without reusing an old task generation.
Backup uploads declare their byte length for R2 and stream without buffering the full archive.
