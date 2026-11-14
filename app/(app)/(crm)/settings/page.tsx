import Link from "next/link";
import { notFound } from "next/navigation";
import { TabStrip } from "@/components/tab-strip";
import { getCurrentUser } from "@/lib/auth/current-user";
import { settingsView } from "@/lib/enquiries/settings";
import { ENQUIRY_CHANNELS } from "@/lib/enquiries/types";
import { listAllLostReasons } from "@/lib/settings/lost-reasons";
import { listAllTags } from "@/lib/settings/tags";
import { pickSettingsTab, settingsTabsFor } from "@/lib/settings/tabs";
import { listUsers } from "@/lib/users/service";
import { EnquirySettings } from "./enquiries/enquiry-settings";
import { LostReasonsTab } from "./lost-reasons-tab";
import { TagsTab } from "./tags-tab";
import { TemplatesTab } from "./templates-tab";
import { UsersTab } from "./users-tab";

// Spec §9.15 Settings (design 1): one server page, the tab in `?tab=`.
// super_admin sees every tab, management only Enquiries, anyone else gets
// not-found. Only the selected tab's data is loaded; every API route behind
// the tabs checks the role again.
export default async function SettingsPage(props: PageProps<"/settings">) {
  const user = await getCurrentUser();
  const tabs = user ? settingsTabsFor(user.role) : [];
  if (!user || !tabs.length) notFound();
  const tab = pickSettingsTab(tabs, (await props.searchParams).tab);

  return (
    // Full width like the other list pages: the Users table needs the room.
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Settings</h1>
        {/* Courses keeps its own page (§9.7); every Settings viewer reads it. */}
        <Link
          href="/courses"
          className="text-ink-muted hover:text-ink text-sm underline"
        >
          Courses
        </Link>
      </div>
      <TabStrip tabs={tabs} active={tab} label="Settings sections" />
      <section
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "users" && (
          <UsersTab users={await listUsers()} viewerId={user.id} />
        )}
        {tab === "lost-reasons" && (
          <LostReasonsTab reasons={await listAllLostReasons()} />
        )}
        {tab === "tags" && <TagsTab tags={await listAllTags()} />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "enquiries" && (
          // The width it had on its own page.
          <div className="max-w-4xl">
            <EnquirySettings
              view={await settingsView()}
              channels={[...ENQUIRY_CHANNELS]}
            />
          </div>
        )}
      </section>
    </div>
  );
}
