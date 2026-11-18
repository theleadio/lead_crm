// Spec §9.15 settings-screen: which tabs each role sees and which one opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROLES } from "../lib/auth/permissions.ts";
import { pickSettingsTab, settingsTabsFor } from "../lib/settings/tabs.ts";

const ids = (role: (typeof ROLES)[number]) =>
  settingsTabsFor(role).map((t) => t.id);

test("super_admin sees every tab, in the spec's order", () => {
  assert.deepEqual(ids("super_admin"), [
    "users",
    "lost-reasons",
    "tags",
    "templates",
    "enquiries",
  ]);
});

test("management sees only Enquiries; every other role sees nothing", () => {
  assert.deepEqual(ids("management"), ["enquiries"]);
  for (const role of ROLES.filter(
    (r) => r !== "super_admin" && r !== "management",
  ))
    assert.deepEqual(ids(role), [], role);
});

test("an unknown or forbidden tab opens the viewer's first tab", () => {
  const admin = settingsTabsFor("super_admin");
  assert.equal(pickSettingsTab(admin, "tags"), "tags");
  assert.equal(pickSettingsTab(admin, "nonsense"), "users");
  assert.equal(pickSettingsTab(admin, undefined), "users");
  assert.equal(pickSettingsTab(admin, ["tags", "users"]), "users");
  const mgmt = settingsTabsFor("management");
  assert.equal(pickSettingsTab(mgmt, "users"), "enquiries");
});
