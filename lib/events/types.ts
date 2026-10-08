// Spec §11.1: the typed event contract. Names, order and payload fields are
// the spec's; aggregate types per plan Q5.
export const EVENT_TYPES = [
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
    noticeId: string;
  };
  ClassNoticeApproved: { noticeId: string; classId: string };
  ClassCancelled: { classId: string; reason: string; enrolmentIds: string[] };
  ClassPublished: { classId: string };
  EnquiryConverted: { enquiryId: string; dealId: string };
  ConsentChanged: { personId: string; purpose: string; isGranted: boolean };
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
};
