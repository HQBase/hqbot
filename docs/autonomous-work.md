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

## Owner notifications

The notification inbox keeps completion, failure, and input requests in workspace storage. Browser
alerts are optional and work while HQBot is open. They do not contain task prompts or results.
Task progress shows saved criteria, milestones, and completion evidence in teammate details.
