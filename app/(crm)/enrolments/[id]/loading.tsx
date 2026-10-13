import { DetailSkeleton } from "@/components/detail-kit";

// Spec §13: the panel shapes while the enrolment loads, never a spinner over a
// blank page.
export default function EnrolmentLoading() {
  return <DetailSkeleton />;
}
