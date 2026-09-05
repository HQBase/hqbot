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
  Remote MCP calls always need separate approval.
- Keep versioned computer backups. A failed restore must preserve both the backup and current
  files. Show checkpoint failures and provide owner export and restore controls.
- Show durable notifications when work completes, fails, or needs owner input.
- Ignore stale page requests after the owner selects another teammate.

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

The notification inbox keeps completion, failure, and input requests in workspace storage. Browser
alerts are optional and work while HQBot is open. They do not contain task prompts or results.
Task progress shows saved criteria, milestones, and completion evidence in teammate details.
