import { redirect } from "next/navigation";

// Spec §9.9 edit now happens on the class's own page (?edit=1), so staff
// stay on the class they are changing and land back on it after saving.
// This URL stays for old links and bookmarks.
export default async function EditClassPage({
  params,
}: PageProps<"/classes/[id]/edit">) {
  const { id } = await params;
  redirect(`/classes/${id}?edit=1`);
}
