# Three Shifts v3 — Configuration Reference

## Default Schedule

| Shift | Cron | Window |
|-------|------|--------|
| Morning ☀️ | 0 6 * * * | 6 AM – 2 PM |
| Afternoon 🌤️ | 0 14 * * * | 2 PM – 10 PM |
| Night 🌙 | 0 22 * * * | 10 PM – 6 AM |

All times in user's local timezone (America/Chicago).

## Models

| Phase | Model | Why |
|-------|-------|-----|
| Planning | venice/kimi-k2-5 | Cost-efficient, good at structured output |
| Execution | (main session model) | Whatever the agent is running in conversation |

## Customizing Shift Times

Update the three planner cron jobs. Shifts should cover 24 hours with no gaps.

Example for an early riser:
```
Morning:   4 AM – 12 PM  (cron: 0 4 * * *)
Afternoon: 12 PM – 8 PM  (cron: 0 12 * * *)
Night:     8 PM – 4 AM   (cron: 0 20 * * *)
```

## Weekend Behavior

By default, shifts run 7 days/week. To skip weekends:
- Modify cron schedule: `0 6 * * 1-5` (weekdays only)
- Or: planner checks the day and only proposes maintenance tasks on weekends

## Night Shift Auto-Approve

The night planner can auto-approve WITHOUT pinging the user when ALL of these are true:
1. All remaining tasks were already approved earlier today
2. No new P1 or P2 tasks are being added
3. Tasks are safe for autonomous execution (no external comms, no financial ops)

The night planner CAN autonomously add P3 tasks:
- Memory maintenance, file cleanup
- Documentation updates
- Git housekeeping
- Research and reading

## Quiet Hours

- Night shift plans: deliver via Signal but expect no response until morning
- Exception: security alerts or system-down events can notify immediately

## Safety Categories

### Always OK
- Reading files, web search, research
- Writing workspace files (memory, docs)
- Non-destructive commands (git status, ls)

### Requires Approval
- External communications
- Creating PRs, pushing code
- Financial transactions

### Never at Night
- External communications
- Financial transactions
- Destructive operations
- Security changes
