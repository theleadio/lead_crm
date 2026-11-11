import {
  CalendarClock,
  CreditCard,
  FileDown,
  ListTodo,
  Phone,
  Send,
  Users,
  type LucideIcon,
} from "lucide-react";

// One icon per task type, shared by Home's panel and the Tasks screen. Kept
// beside the screens, not in lib/tasks: lib holds no UI.
export const TASK_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  follow_up: Send,
  review_duplicate: Users,
  match_payment: CreditCard,
  hrdc_deadline: CalendarClock,
  export_request: FileDown,
  other: ListTodo,
};
