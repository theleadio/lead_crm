import { permissionFor, type Role } from "../auth/permissions.ts";
import { canEditEnquirySettings } from "../enquiries/settings.ts";

// Spec §9.15 settings-screen: the Settings tabs, in order. super_admin (the §6
// settings row) sees every tab; management, who may edit enquiry settings,
// sees only Enquiries. Integrations waits on proposal question 6.
export type SettingsTab =
  | "users"
  | "lost-reasons"
  | "tags"
  | "templates"
  | "enquiries";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "users", label: "Users" },
  { id: "lost-reasons", label: "Lost reasons" },
  { id: "tags", label: "Tags" },
  { id: "templates", label: "Templates" },
  { id: "enquiries", label: "Enquiries" },
];

export function settingsTabsFor(role: Role) {
  if (permissionFor({ id: "", role }, "settings", "read").allowed) return TABS;
  return TABS.filter((t) => t.id === "enquiries" && canEditEnquirySettings(role));
}

// `?tab=` the viewer may open, else their first tab. Call only with tabs.
export function pickSettingsTab(
  tabs: { id: SettingsTab }[],
  wanted: string | string[] | undefined,
): SettingsTab {
  return tabs.find((t) => t.id === wanted)?.id ?? tabs[0].id;
}
