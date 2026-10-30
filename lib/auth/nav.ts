import { permissionFor, type Resource, type Viewer } from "./permissions.ts";

// Spec §9 Shell: the sidebar shows only areas the role can read (§6). Hiding a
// link is UX; every API route keeps its own check. Companies share `person`.
const NAV_ITEMS: {
  href: string;
  label: string;
  resource: Resource | null;
  // Reports only: the resource's read is not enough, the part_time
  // assigned-only kind of read does not open it.
  fullReadOnly?: boolean;
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
  { href: "/enquiries", label: "Enquiries", resource: "enquiry" },
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

export function navFor(viewer: Viewer) {
  return NAV_ITEMS.filter((i) => {
    if (!i.resource) return true;
    const { allowed, assignedOnly } = permissionFor(viewer, i.resource, "read");
    return allowed && !(i.fullReadOnly && assignedOnly);
  }).map(({ href, label }) => ({ href, label }));
}
