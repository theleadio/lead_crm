// Spec §11.1: the typed event contract. Names, order and payload fields are
// the spec's; aggregate types per plan Q5.
export const SPEC_EVENT_TYPES = [
  "LeadCaptured",
  "DealStageChanged",
  "EnrolmentCreated",
  "EnrolmentConfirmed",
  "EnrolmentCancelled",
  "EnrolmentTransferred",
  "PaymentRecorded",
  "ClassChanged",
  "ClassNoticeApproved",
  "ClassCancelled",
  "ClassPublished",
  "EnquiryConverted",
  "ConsentChanged",
] as const;

// Internal events, not part of the §11.1 contract: the CRM → LMS hand-off
// (docs/superpowers/specs/2026-11-04-crm-to-lms-handoff.md).
//   LmsNotice            one notice to send to the LMS; its handler is the only
//                        code that calls the LMS
//   LmsAccountReady      the LMS confirmed an enrolment (answered 200), so the
//                        student's account and temp-password email exist;
//                        onboarding starts from this (automations draft)
//   PersonContactChanged a person's email, phone or name changed in the CRM,
//                        which is the master (lead_sales spec §7.2)
export const INTERNAL_EVENT_TYPES = [
  "LmsNotice",
  "LmsAccountReady",
  "PersonContactChanged",
] as const;

export const EVENT_TYPES = [
  ...SPEC_EVENT_TYPES,
  ...INTERNAL_EVENT_TYPES,
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type EventPayloads = {
  LeadCaptured: {
    personId: string;
    dealId: string;
    formName: string;
    touchpointId: string;
  };
  DealStageChanged: {
    dealId: string;
    fromStage: string;
    toStage: string;
    byUserId: string;
  };
  EnrolmentCreated: {
    enrolmentId: string;
    personId: string;
    classId: string;
    status: string;
  };
  EnrolmentConfirmed: {
    enrolmentId: string;
    personId: string;
    classId: string;
    language: string;
  };
  EnrolmentCancelled: { enrolmentId: string; reason: string };
  EnrolmentTransferred: {
    enrolmentId: string;
    fromClassId: string;
    toClassId: string;
  };
  PaymentRecorded: {
    paymentId: string;
    enrolmentId: string;
    method: string;
    amountMyr: string;
  };
  ClassChanged: {
    classId: string;
    changedFields: Record<string, unknown>;
    noticeId: string | null; // null when Ops saved quietly (v1.10)
  };
  ClassNoticeApproved: { noticeId: string; classId: string };
  ClassCancelled: { classId: string; reason: string; enrolmentIds: string[] };
  ClassPublished: { classId: string };
  EnquiryConverted: { enquiryId: string; dealId: string };
  ConsentChanged: { personId: string; purpose: string; isGranted: boolean };
  LmsNotice: {
    kind:
      | "enrolment.confirmed"
      | "enrolment.cancelled"
      | "enrolment.transferred"
      | "class.updated"
      | "person.updated";
    refId: string;
    [extra: string]: unknown;
  };
  LmsAccountReady: { enrolmentId: string };
  PersonContactChanged: {
    personId: string;
    previousEmail: string | null;
    email: string | null;
  };
};

export const EVENT_AGGREGATE: Record<EventType, string> = {
  LeadCaptured: "person",
  DealStageChanged: "deal",
  EnrolmentCreated: "enrolment",
  EnrolmentConfirmed: "enrolment",
  EnrolmentCancelled: "enrolment",
  EnrolmentTransferred: "enrolment",
  PaymentRecorded: "payment",
  ClassChanged: "class",
  ClassNoticeApproved: "class",
  ClassCancelled: "class",
  ClassPublished: "class",
  EnquiryConverted: "enquiry",
  ConsentChanged: "person",
  // The notice's aggregate is whatever it is about (enrolment, class or
  // person); its id is the payload's refId.
  LmsNotice: "lms_notice",
  LmsAccountReady: "enrolment",
  PersonContactChanged: "person",
};
