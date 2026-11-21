# Projects, tags and upcoming

Three surfaces read the workspace snapshot and write through `WorkspaceDocument`. They add no
document field and no schema version: a project, a tag and a task's day already exist in
[data-model.md](data-model.md).

## Projects

The list is `listProjects`, active projects first and archived projects under a disclosure. A
project's count is the tasks whose `projectId` matches and whose `status` is not `done`. A project
with no open tasks says so; it is empty, not broken.

The surface exposes what the document already supports:

- **Create** through `createProject`.
- **Rename** and **archive/unarchive** through `updateProject`. Archive writes `archivedAt`;
  unarchive writes it back to `null`.

The add form names the action that fills an empty list. The empty state also points at `@project`
in the capture bar, which creates a project through the same method.

## Tags

A tag is a name and a colour; the tasks carry the label. The list is `listTags` and each row shows
the tasks whose `tagIds` include it, with done tasks struck through. A tag with no tasks is empty,
not broken, and the row names the capture syntax that would fill it.

**Create** uses `createTag`; `@tag` in the capture bar reaches the same method. A tag with no tasks
names the capture syntax that would put one there.

## Upcoming

Upcoming is a list, not a week grid. It selects tasks that are not done and whose `scheduledFor` is
after `todayKey()`, sorts the days with `compareDateKeys`, and labels each group with
`humanDayLabel`. Selecting a task sets the day and opens Today through the same UI store the rail
uses, so the view never invents its own navigation.

An empty list names the two ways to fill it: give an inbox task a future day, or capture one with a
date such as `tomorrow`.

## Registration

All three are entries in `src/renderer/src/app/views.ts`. The rail renders the registry in order and
the shell resolves the component, so neither file branches on a view id. Focus and Rituals are
entries too; [Focus](focus.md) and [Rituals](rituals.md) own their pages.
