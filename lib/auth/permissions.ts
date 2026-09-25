// Spec §6 permission matrix, as code. One place, used by every API route.
// F = full, E = create/edit, R = read, A = assigned records only, - = none.

export type Role =
  | "super_admin"
  | "management"
  | "marketing"
  | "sales"
  | "support"
  | "operations"
  | "part_time";

export const ROLES: Role[] = [
  "super_admin",
  "management",
  "marketing",
  "sales",
  "support",
  "operations",
  "part_time",
];

export type Resource =
  | "person"
  | "deal"
  | "enquiry"
  | "class"
  | "enrolment"
  | "payment"
  | "task"
  | "consent"
  | "settings"
  | "audit_log";

type Access = "F" | "E" | "R" | "A" | "-";

// Columns: super_admin, management, marketing, sales, support, operations, part_time
const MATRIX: Record<
  Resource,
  [Access, Access, Access, Access, Access, Access, Access]
> = {
  person: ["F", "R", "R", "E", "E", "R", "A"], // also covers company
  deal: ["F", "R", "R", "E", "E", "R", "-"],
  enquiry: ["F", "R", "-", "R", "E", "R", "A"],
  class: ["F", "R", "R", "R", "R", "F", "R"], // also covers course
  enrolment: ["F", "R", "-", "R", "R", "F", "-"],
  payment: ["F", "R", "-", "R", "-", "E", "-"], // sales: own deals only; ops: manual only, no refund
  task: ["F", "R", "E", "E", "E", "E", "A"],
  consent: ["F", "R", "R", "R", "E", "R", "-"],
  settings: ["F", "-", "-", "-", "-", "-", "-"], // also covers app_user
  audit_log: ["R", "R", "-", "-", "-", "-", "-"],
};

export type Action = "read" | "write" | "delete";

export type Viewer = { id: string; role: Role };

function accessFor(role: Role, resource: Resource): Access {
  return MATRIX[resource][ROLES.indexOf(role)];
}

// Returns whether the viewer may perform the action at all, and whether
// they're limited to records assigned to them (part_time "A").
export function permissionFor(
  viewer: Viewer,
  resource: Resource,
  action: Action,
): { allowed: boolean; assignedOnly: boolean } {
  const access = accessFor(viewer.role, resource);
  const allowed =
    access === "F" ||
    ((access === "E" || access === "A") && action !== "delete") ||
    (access === "R" && action === "read");
  return { allowed, assignedOnly: access === "A" };
}

export class PermissionError extends Error {
  constructor(resource: Resource) {
    super(`You don't have access to ${resource}.`);
  }
}

// Spec §6: requirePermission(session, 'enrolment', 'write', { recordOwnerId })
export function requirePermission(
  viewer: Viewer,
  resource: Resource,
  action: Action,
  opts: { recordOwnerId?: string | null } = {},
): { assignedOnly: boolean } {
  const { allowed, assignedOnly } = permissionFor(viewer, resource, action);
  if (!allowed) throw new PermissionError(resource);
  if (
    assignedOnly &&
    opts.recordOwnerId !== undefined &&
    opts.recordOwnerId !== viewer.id
  ) {
    throw new PermissionError(resource);
  }
  return { assignedOnly };
}

// Spec §6 (v1.2): part-timers create people only together with an enquiry
// assigned to them (built with 9.13) — never from the standalone Add person.
export function canAddPersonStandalone(viewer: Viewer): boolean {
  return (
    viewer.role !== "part_time" &&
    permissionFor(viewer, "person", "write").allowed
  );
}

// Footnote ¹: marketing sees person phone/email masked.
export function masksContactDetails(role: Role): boolean {
  return role === "marketing";
}

// Export CSV row: only super_admin exports person records directly.
// management = "request", marketing = "aggregate only", operations = "class lists".
export function canExportPeople(role: Role): boolean {
  return role === "super_admin";
}

// Merge person row: super_admin merges; sales/support/operations may propose.
export function mergeAccess(role: Role): "full" | "propose" | "none" {
  if (role === "super_admin") return "full";
  if (role === "sales" || role === "support" || role === "operations")
    return "propose";
  return "none";
}

// Spec §7 / §9.4 (v1.5): creating and editing companies, and their
// memberships, is super_admin, sales and support. Other roles read only.
export function canWriteCompany(viewer: Viewer): boolean {
  return (
    viewer.role === "super_admin" ||
    viewer.role === "sales" ||
    viewer.role === "support"
  );
}
