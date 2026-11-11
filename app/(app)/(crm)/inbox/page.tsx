import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listCategories } from "@/lib/enquiries/routing";
import {
  ENQUIRY_STATUS_BADGE,
  type EnquiryStatus,
} from "@/lib/enquiries/types";
import { formatDateTime } from "@/lib/format/date";
import {
  CONVERSATION_CHANNELS,
  conversationDetail,
  inboxAgents,
  listConversations,
  mayUseInbox,
  seesWholeInbox,
  type ConversationChannel,
  type ConversationDetail,
  type InboxFilter,
  type InboxItem,
} from "@/lib/inbox/service";
import { recentTemplateNames, watiFromEnv } from "@/lib/wati/send";
import { enquiryLabel } from "../enquiries/queue-view";
import { ReplyBox } from "./reply-box";
import { TemplateBox } from "./template-box";
import { ThreadActions } from "./thread-actions";

// The inbox (migration 019, moved from lead_sales): conversations on the left,
// the open one on the right with the customer, its enquiries and "Make
// enquiry". The help form feeds it today; WhatsApp, Messenger, Instagram and
// email join it as each is connected. Replies are sent from here once a
// channel is connected (WATI first).

const CHANNEL_LABEL: Record<ConversationChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  messenger: "Messenger",
  instagram: "Instagram",
  web_form: "Help form",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InboxPage(props: PageProps<"/inbox">) {
  const user = await getCurrentUser();
  if (!user || !(await mayUseInbox(user))) notFound();
  const q = await props.searchParams;

  const channel =
    CONVERSATION_CHANNELS.find((c) => c === one(q.channel)) ?? "all";
  const who =
    (["mine", "unassigned", "all"] as const).find((w) => w === one(q.who)) ??
    "all";
  const status =
    (["open", "closed", "all"] as const).find((s) => s === one(q.status)) ??
    "open";
  const needsReply = one(q.reply) === "1";
  const filter: InboxFilter = { channel, who, status, needsReply };

  const selectedId = one(q.c);
  const [items, selected] = await Promise.all([
    listConversations(user, filter),
    selectedId ? conversationDetail(user, selectedId) : Promise.resolve(null),
  ]);

  const params = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      channel,
      who,
      status,
      ...(needsReply ? { reply: "1" } : {}),
      ...(selectedId ? { c: selectedId } : {}),
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/inbox?${p}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Inbox</h1>
      {!seesWholeInbox(user.role) && (
        <p className="text-ink-muted text-sm">
          You see conversations linked to your teams&apos; enquiries.
        </p>
      )}

      <nav aria-label="Inbox filters" className="flex flex-wrap gap-2 text-sm">
        {(["all", "mine", "unassigned"] as const).map((w) => (
          <Chip key={w} href={params({ who: w, c: "" })} on={who === w}>
            {w === "all" ? "Everyone's" : w === "mine" ? "Mine" : "Unassigned"}
          </Chip>
        ))}
        <span className="border-line mx-1 border-l" />
        <Chip
          href={params({ reply: needsReply ? "" : "1", c: "" })}
          on={needsReply}
        >
          Needs reply
        </Chip>
        <span className="border-line mx-1 border-l" />
        {(["open", "closed", "all"] as const).map((s) => (
          <Chip key={s} href={params({ status: s, c: "" })} on={status === s}>
            {s === "all" ? "Any status" : s[0].toUpperCase() + s.slice(1)}
          </Chip>
        ))}
        <span className="border-line mx-1 border-l" />
        <Chip href={params({ channel: "all", c: "" })} on={channel === "all"}>
          All channels
        </Chip>
        {CONVERSATION_CHANNELS.map((ch) => (
          <Chip
            key={ch}
            href={params({ channel: ch, c: "" })}
            on={channel === ch}
          >
            {CHANNEL_LABEL[ch]}
          </Chip>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <ConversationList
          items={items}
          selectedId={selectedId}
          hrefFor={(c) => params({ c })}
        />
        {selected ? (
          <Thread c={selected} />
        ) : (
          <div className="border-line bg-surface-raised hidden rounded-md border p-10 text-center lg:block">
            <p className="font-medium">
              {selectedId
                ? "That conversation isn't available."
                : "Pick a conversation"}
            </p>
            <p className="text-ink-muted mt-1 text-sm">
              Help-form messages are here now. WhatsApp, Messenger, Instagram
              and email arrive as each channel is connected.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`rounded-full px-3 py-1 ${on ? "bg-blue-soft font-medium" : "hover:bg-surface-sunken"}`}
    >
      {children}
    </Link>
  );
}

function ConversationList({
  items,
  selectedId,
  hrefFor,
}: {
  items: InboxItem[];
  selectedId: string | undefined;
  hrefFor: (id: string) => string;
}) {
  if (items.length === 0)
    return (
      <div className="border-line bg-surface-raised rounded-md border p-8 text-center">
        <p className="font-medium">No conversations here</p>
        <p className="text-ink-muted mt-1 text-sm">Try another filter.</p>
      </div>
    );
  return (
    <ul className="border-line divide-line bg-surface-raised flex flex-col divide-y overflow-y-auto rounded-md border">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            href={hrefFor(i.id)}
            aria-current={i.id === selectedId ? "true" : undefined}
            className={`block px-4 py-3 text-sm ${i.id === selectedId ? "bg-blue-soft" : "hover:bg-surface-sunken"}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{i.personName}</span>
              <span className="text-ink-muted shrink-0 text-xs">
                {i.lastMessageAt ? formatDateTime(i.lastMessageAt) : ""}
              </span>
            </span>
            <span className="text-ink-muted mt-0.5 flex items-center gap-2 text-xs">
              <span>{CHANNEL_LABEL[i.channel]}</span>
              {i.lastDirection === "in" && (
                <span className="bg-yellow-soft text-yellow-ink rounded-full px-1.5">
                  needs reply
                </span>
              )}
              {i.openEnquiries > 0 && (
                <span>
                  {i.openEnquiries} open enquir
                  {i.openEnquiries > 1 ? "ies" : "y"}
                </span>
              )}
              <span className="ml-auto truncate">
                {i.assigneeName ?? "Unassigned"}
              </span>
            </span>
            {i.preview && (
              <span className="text-ink-muted mt-1 line-clamp-2 text-xs">
                {i.preview}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Thread({ c }: { c: ConversationDetail }) {
  const wati = c.channel === "whatsapp" && Boolean(watiFromEnv());
  const [categories, agents, templates] = await Promise.all([
    listCategories(),
    inboxAgents(),
    wati ? recentTemplateNames() : [],
  ]);
  const lastIn = [...c.messages].reverse().find((m) => m.direction === "in");
  const firstLine = (lastIn?.body ?? "").split(/\r?\n/)[0].trim().slice(0, 200);
  return (
    <div className="border-line bg-surface-raised flex min-w-0 flex-col rounded-md border">
      <header className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <Link
            href={`/people/${c.person.id}`}
            className="font-semibold hover:underline"
          >
            {c.person.fullName}
          </Link>
          <p className="text-ink-muted truncate text-xs">
            {[CHANNEL_LABEL[c.channel], c.person.email, c.person.phone]
              .filter(Boolean)
              .join(" · ")}
            {c.person.needsReview && " · flagged as a possible duplicate"}
          </p>
        </div>
      </header>

      <ol className="flex flex-col gap-3 overflow-y-auto p-4">
        {c.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-md border px-4 py-2 text-sm ${m.direction === "in" ? "border-line bg-surface self-start" : "border-line bg-blue-soft self-end"}`}
          >
            <p className="break-words whitespace-pre-wrap">
              {m.body ?? <em className="text-ink-muted">Removed</em>}
            </p>
            <p className="text-ink-muted mt-1 text-xs">
              {m.direction === "out" ? `${m.senderName ?? "LEAD"} · ` : ""}
              {formatDateTime(m.sentAt)}
              {m.attachments > 0 &&
                ` · ${m.attachments} attachment${m.attachments > 1 ? "s" : ""}`}
            </p>
          </li>
        ))}
      </ol>

      <div className="border-line mt-auto space-y-4 border-t p-4">
        {c.enquiries.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Enquiries</h2>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {c.enquiries.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  {e.canOpen ? (
                    <Link
                      href={`/enquiries/${e.id}`}
                      className="text-blue-ink font-medium hover:underline"
                    >
                      {e.number}
                    </Link>
                  ) : (
                    <span className="font-medium">{e.number}</span>
                  )}
                  <span className="truncate">
                    {e.subject ?? "(another team's enquiry)"}
                  </span>
                  <span className="text-ink-muted text-xs">{e.teamName}</span>
                  <Badge
                    variant={
                      ENQUIRY_STATUS_BADGE[e.status as EnquiryStatus] ??
                      "secondary"
                    }
                  >
                    {enquiryLabel(e.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ThreadActions
          conversationId={c.id}
          status={c.status}
          assignedUserId={c.assignedUserId}
          agents={agents}
          categories={categories.filter((cat) => cat.active)}
          suggestedCategory={c.suggestedCategory}
          defaultSubject={firstLine}
        />

        {wati && c.replyWindow === "open" && <ReplyBox conversationId={c.id} />}
        {/* Any time on WhatsApp; the way to reply once the window has
            closed. A name that is only the number greets as "there". */}
        {wati && (
          <TemplateBox
            conversationId={c.id}
            suggestions={templates}
            greetingName={
              /\p{L}/u.test(c.person.fullName) ? c.person.fullName : "there"
            }
            windowOpen={c.replyWindow === "open"}
          />
        )}

        <p className="text-ink-muted text-xs">
          {c.channel === "web_form"
            ? "Help-form messages can't be answered here yet: reply by email or phone until email replies are connected."
            : c.replyWindow === "closed"
              ? wati
                ? "The free-reply window has closed: reply with an approved WATI template."
                : "The free-reply window has closed: WhatsApp needs an approved template to reply."
              : c.channel === "whatsapp" && watiFromEnv()
                ? "Replies go out on WhatsApp from here."
                : "Replies are sent from here once this channel is connected."}
        </p>
      </div>
    </div>
  );
}
