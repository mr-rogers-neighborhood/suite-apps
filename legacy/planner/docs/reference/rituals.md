# Plan and shutdown rituals

Rituals are the two ends of a day. Planning says what the day is for; shutting down says how it
went and what is left. Both write the same `dayRecord` the day view reads, described in
[data-model.md](data-model.md). No new record or field was added for them.

## The day record they share

`dateKey`, `intention`, `shutdownNote`, `capacityMinutesOverride`, `plannedAt` and `shutdownAt`.
The day view's intention field calls `updateDay(date, { intention })`, exactly as the ritual does, so
editing in either place changes the one record.

## Planning

The plan step has three parts:

- **Intention.** An input whose blur writes `intention` through `updateDay`. It is empty by default,
  because a day record starts with an empty intention.
- **Chosen tasks.** The projection of the day's plan, derived from tasks whose `scheduledFor` points
  at the day. The list is not stored on the day; the tasks remain the source of truth. The total is
  the same `dayPlan` total the day view shows.
- **Capacity override.** A positive whole number of minutes written to `capacityMinutesOverride`, or
  cleared to `null` to fall back to `settings.dailyCapacityMinutes`. The meter on this surface and
  the meter in the day view both read the override through `capacityFor`, so they cannot disagree.

The **Plan the day** action calls `markDayPlanned`, which writes `plannedAt`. Running it again is
allowed, but the button reads "Plan again" and the feedback says the planned time was updated rather
than duplicated. There is one timestamp, not an event log.

## Shutting down

The shutdown step saves the note with `updateDay(date, { shutdownNote })`, then calls
`markDayShutdown`, which writes `shutdownAt`. The two actions have their own buttons and their own
feedback: a successful plan does not report a shutdown, and a successful shutdown does not report a
plan.

Running the shutdown a second time updates `shutdownAt` and says so. The record still holds one
shutdown time; repeating the step never appends a second one.

## Carry-over

Before shutdown the surface lists the day's unfinished tasks under **Carry-over · moves to tomorrow**.
This is a second projection of the same `dayPlan`, not a new stored list. The step itself writes only
the note and `shutdownAt`; it never calls `scheduleTask`.

Moving a task is an explicit action on that row, which calls `scheduleTask(id, tomorrow)`. Recurring
tasks are marked "repeats" and have no move control, because their next occurrence comes from the
recurrence rule rather than from a new `scheduledFor`. A day with no unfinished work says so instead
of offering an empty list.

## What is not here

There is no history of plans or shutdowns, no streaks and no automatic rollover. The record keeps the
latest `plannedAt` and `shutdownAt`; anything more would need new fields.
