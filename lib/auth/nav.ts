import {
  permissionFor,
  type Resource,
  type Role,
  type Viewer,
} from "./permissions.ts";

// The inbox has no §6 row (migration 019): these roles see every
// conversation, as decided for the ticket inbox on 4 Nov. Mirrors
// seesWholeInbox in lib/inbox/service.ts, kept here so the nav stays free of
// database imports.
const INBOX_ROLES: readonly Role[] = [
  "super_admin",
  "management",
  "support",
  "sales",
];

// Spec §9 Shell: the sidebar shows only areas the role can read (§6). Hiding a
// link is UX; every API route keeps its own check. Companies share `person`.
const NAV_ITEMS: {
  href: string;
  label: string;
  resource: Resource | null;
  // Reports only: the resource's read is not enough, the part_time
  // assigned-only kind of read does not open it.
  fullReadOnly?: boolean;
  // Inbox only: INBOX_ROLES, or any team member.
  inbox?: boolean;
  // Also shown to a team member whatever their role (migration 019).
  team?: boolean;
}[] = [
  { href: "/dashboard", label: "Dashboard", resource: null },
  { href: "/people", label: "People", resource: "person" },
  { href: "/companies", label: "Companies", resource: "person" },
  { href: "/deals", label: "Deals", resource: "deal" },
  { href: "/classes", label: "Classes", resource: "class" },
  // §9.7 sits beside Classes, not inside Settings: §6 gives operations full
  // course access while Settings is super_admin only.
  { href: "/courses", label: "Courses", resource: "class" },
  { href: "/enrolments", label: "Enrolments", resource: "enrolment" },
  // Before Enquiries: conversations come in here and become enquiries.
  { href: "/inbox", label: "Inbox", resource: null, inbox: true },
  { href: "/enquiries", label: "Enquiries", resource: "enquiry", team: true },
  { href: "/tasks", label: "Tasks", resource: "task" },
  // §9.18, reserved: the §6 matrix has no Reports row, so Reports rides on
  // person read minus part_time's assigned-only kind (O62). It sits after
  // Tasks because it holds aggregates, not records to work.
  {
    href: "/reports/ads",
    label: "Reports",
    resource: "person",
    fullReadOnly: true,
  },
  { href: "/settings", label: "Settings", resource: "settings" },
];

// `inTeam`: the viewer is a member of at least one enquiry team, read by the
// layout (a team member works their team's enquiries whatever their role).
export function navFor(viewer: Viewer, inTeam = false) {
  return NAV_ITEMS.filter((i) => {
    if (i.inbox) return inTeam || INBOX_ROLES.includes(viewer.role);
    if (i.team && inTeam) return true;
    if (!i.resource) return true;
    const { allowed, assignedOnly } = permissionFor(viewer, i.resource, "read");
    return allowed && !(i.fullReadOnly && assignedOnly);
  }).map(({ href, label }) => ({ href, label }));
}
