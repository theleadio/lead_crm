import { permissionFor, type Resource, type Viewer } from "./permissions.ts";

// Spec §9 Shell: the sidebar shows only areas the role can read (§6). Hiding a
// link is UX; every API route keeps its own check. Companies share `person`.
const NAV_ITEMS: { href: string; label: string; resource: Resource | null }[] =
  [
    { href: "/dashboard", label: "Dashboard", resource: null },
    { href: "/people", label: "People", resource: "person" },
    { href: "/companies", label: "Companies", resource: "person" },
    { href: "/deals", label: "Deals", resource: "deal" },
    { href: "/classes", label: "Classes", resource: "class" },
    { href: "/enrolments", label: "Enrolments", resource: "enrolment" },
    { href: "/enquiries", label: "Enquiries", resource: "enquiry" },
    { href: "/tasks", label: "Tasks", resource: "task" },
    { href: "/settings", label: "Settings", resource: "settings" },
  ];

export function navFor(viewer: Viewer) {
  return NAV_ITEMS.filter(
    (i) => !i.resource || permissionFor(viewer, i.resource, "read").allowed,
  ).map(({ href, label }) => ({ href, label }));
}
