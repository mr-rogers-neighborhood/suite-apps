import type { LucideIcon } from "lucide-react";
import { CalendarDays, CalendarRange, Folder, Inbox, Sun, Sunrise, Tag, Timer } from "lucide-react";
import type { ComponentType } from "react";

import { DayView } from "../day/DayView";
import { FocusView } from "../focus/FocusView";
import { InboxView } from "../inbox/InboxView";
import { ProjectsView } from "../projects/ProjectsView";
import { RitualsView } from "../rituals/RitualsView";
import { TagsView } from "../tags/TagsView";
import { UpcomingView } from "../upcoming/UpcomingView";
import { WeekView } from "../week/WeekView";

/**
 * The one registry of surfaces the shell can render.
 *
 * A new view is an entry here: the rail renders this object in order and the shell renders the
 * resolved component, so neither file needs a branch for it. The id is the store's view type, which
 * is why an unregistered id cannot type-check as a navigation destination.
 */
type ViewDefinition = {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly component: ComponentType;
};

type ViewRegistry = Readonly<Record<string, ViewDefinition>>;

export const views = {
  today: { id: "today", label: "Today", icon: Sun, component: DayView },
  week: { id: "week", label: "Week", icon: CalendarRange, component: WeekView },
  inbox: { id: "inbox", label: "Inbox", icon: Inbox, component: InboxView },
  upcoming: { id: "upcoming", label: "Upcoming", icon: CalendarDays, component: UpcomingView },
  projects: { id: "projects", label: "Projects", icon: Folder, component: ProjectsView },
  tags: { id: "tags", label: "Tags", icon: Tag, component: TagsView },
  focus: { id: "focus", label: "Focus", icon: Timer, component: FocusView },
  rituals: { id: "rituals", label: "Rituals", icon: Sunrise, component: RitualsView },
} as const satisfies ViewRegistry;

export type ViewId = keyof typeof views;

const defaultViewId: ViewId = "today";

/**
 * Resolve a stored view id to a registered view.
 *
 * A store can outlive the build that wrote it, so an id this build does not know opens today rather
 * than an empty pane.
 */
export function resolveView(registry: ViewRegistry, id: string): ViewDefinition {
  const view = Object.hasOwn(registry, id) ? registry[id] : registry[defaultViewId];
  // `views` always registers `defaultViewId`; a custom registry that does not is a programmer error.
  if (view === undefined) throw new Error(`No view is registered as ${defaultViewId}`);
  return view;
}
