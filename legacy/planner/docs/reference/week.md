# Week

Week is a seven-day projection beside Today. It adds no document field and no schema version: the
same task records, `scheduledFor` values, estimates and day capacity records the day view reads are
projected into columns.

## The projection

`weekPlan` in `packages/planner-core/src/plan/weekPlan.ts` starts the week on `settings.weekStartsOn` with
`startOfWeekKey`, then walks seven days with `addDaysToKey`. Each day is an ordinary `dayPlan`: the
tasks whose `scheduledFor` is that date, plus the recurring occurrences projected into it. The day's
available time is its `capacityMinutesOverride` when it has one, otherwise
`settings.dailyCapacityMinutes`; `capacityFor` turns the planned estimates and that number into the
meter under the column heading. The column for today is marked, and the header labels the week's
first and last dates.

Previous and next move the selected date by seven days, and **This week** returns to the week that
contains today. The view is a projection of the selected date, so a move writes a task rather than
storing a week.

## Moving work

A row drags to another column; the column it lands on becomes the task's `scheduledFor` through
`scheduleTask`. The task title is a button, so the same move is available from the keyboard: focus it
and press `Alt` + `←` or `Alt` + `→` to move one day. The row menu offers **Move to previous day** and
**Move to next day** in words, plus **Open day**, which selects that date and switches to Today. A
move past either edge of the visible week is refused with a status message rather than silently
landing on a different week.

## Carry-over

Carry-over is the day view's overdue list, not a queue that gets moved. It shows the unfinished,
non-recurring tasks scheduled before today, each with its original day and a **Move to today** button.
Nothing is rescheduled until a person presses that button or drags the task; the projection itself
never writes.

## Recurring tasks

A recurring task stores its series anchor in `scheduledFor`, and its occurrences are projected from
that anchor. Moving an occurrence would move the series, so a recurring row is not draggable, has no
keyboard move, and its menu offers only **Open day**. The occurrence can be completed from its day,
but its day comes from the series, not from the week column. See
[data-model.md](data-model.md#recurrence).
