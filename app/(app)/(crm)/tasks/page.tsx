import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { permissionFor } from "@/lib/auth/permissions";
import { listOwnerOptions } from "@/lib/people/service";
import { listTasks } from "@/lib/tasks/list";
import {
  readTaskParams,
  TASKS_PAGE_SIZE,
  taskListQuerySchema,
} from "@/lib/validation/task";
import { TasksList } from "./tasks-list";

// Spec §9.14 — my open tasks by due date, overdue at the top, with inline
// complete. Every role reads tasks (§6); part_time only their own.
export default async function TasksPage(props: PageProps<"/tasks">) {
  const user = await getCurrentUser();
  if (!user) notFound();

  // The URL is the query: a filtered view can be linked and survives a reload.
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams))
    if (typeof value === "string") searchParams.set(key, value);
  const parsed = taskListQuerySchema.safeParse(readTaskParams(searchParams));
  // The screen pages by TASKS_PAGE_SIZE whatever the URL says, so the first
  // render and every later page agree on where a page starts.
  const query = {
    ...(parsed.success ? parsed.data : taskListQuerySchema.parse({})),
    limit: TASKS_PAGE_SIZE,
  };
  const read = permissionFor(user, "task", "read");
  const write = permissionFor(user, "task", "write");

  const [first, users] = await Promise.all([
    listTasks(query, user),
    // A part-timer sees only their own tasks, so they get no user list.
    read.assignedOnly ? [] : listOwnerOptions(),
  ]);
  // A page past the end (an old link, or tasks closed since) opens the last
  // page instead of an empty one that says no task matches.
  const lastPage = Math.max(1, Math.ceil(first.page.total / TASKS_PAGE_SIZE));
  if (query.page > lastPage) query.page = lastPage;
  const initial =
    first.data.length || first.page.total === 0
      ? first
      : await listTasks(query, user);

  return (
    <TasksList
      key={searchParams.toString()}
      initial={initial}
      initialView={{
        mine: query.mine,
        assignee: query.assignee ?? "",
        type: query.type ?? "",
        page: query.page,
      }}
      access={{
        viewerId: user.id,
        canWrite: write.allowed,
        canSeeEveryone: !read.assignedOnly,
        assignedOnly: write.assignedOnly,
      }}
      users={users}
    />
  );
}
