// The public site's English copy (§10.1, §10.3, §13). This object is the
// shape: `Dict` is `typeof en`, so a key the Chinese file invents does not
// type-check, and a key missing from the Chinese file falls back to here.
//
// Flat, one level, dotted keys. A nested dictionary would need a deep merge
// to get the same per-key fallback, and the flat list is what the L5
// translation review reads.
//
// {braces} are filled by `fill()` in ../dictionaries.ts. Never build a
// sentence by concatenating translated fragments: Chinese puts them in a
// different order.
export const en = {
  "chrome.schedule": "Schedule",
  "chrome.enquiry": "Talk to us",
  "chrome.language": "Change language",

  "schedule.title": "Class schedule — LEAD",
  "schedule.description":
    "Upcoming LEAD classes: dates, language, venue, price and HRDC claimability.",
  "schedule.heading": "Class schedule",
  "schedule.standfirst": "Upcoming public classes",
  "schedule.lastUpdated": "Schedule last updated {when}.",
  "schedule.empty.heading": "No public classes scheduled right now",
  "schedule.empty.cta": "Tell us what you're looking for",
  "schedule.error.heading": "The schedule isn't loading right now",
  "schedule.error.body": "Please try again in a moment.",
  "schedule.error.retry": "Try again",

  "filter.language": "Language",
  "filter.track": "Track",
  "filter.city": "City",
  "filter.noMatch": "No class matches these filters.",
  "filter.clear": "Clear filters",

  "card.dates": "Dates",
  "card.where": "Where",
  "card.price": "Price",
  "card.online": "Online",
  "card.hrdc": "HRDC claimable",
  "card.seats.available": "Seats available",
  "card.seats.few_seats": "Few seats left",
  "card.seats.full": "Full",
  "card.enquire": "Enquire",
  "card.register": "Register",
  "card.register.full": "This class is full",
  "card.register.notOpen": "Registration isn't open for this class yet",

  "track.certification": "Certification",
  "track.mastery": "Mastery",
  "track.masterclass": "Masterclass",
  "track.workshop": "Workshop",
  "track.conference": "Conference",
  "track.corporate": "Corporate",

  "enquiry.title": "Enquire — LEAD",
  "enquiry.description":
    "Tell us what you're looking for and we'll get back to you about LEAD's classes.",
  "enquiry.heading": "Talk to us",
  "enquiry.heading.class": "Enquire about {course}",
  "enquiry.standfirst":
    "Tell us what you're looking for and we'll come back to you about dates, pricing and HRDC claims.",
  "enquiry.class.meta": "{code} · starts {date}.",
  "enquiry.class.metaCity": "{code} · starts {date} · {city}.",
  "enquiry.class.invite":
    "Tell us what you'd like to know and we'll come back to you.",

  "form.required": "(required)",
  "form.fullName": "Full name",
  "form.email": "Email",
  "form.email.hint": "Give us an email or a phone number — either is enough.",
  "form.phone": "Phone",
  "form.phone.hint":
    "Malaysian mobile, for example +60 12-345 6789 or 012-345 6789.",
  "form.company": "Company",
  "form.jobTitle": "Job title",
  "form.preferredLanguage": "Preferred language",
  "form.message": "What would you like to know?",
  "form.hrdc": "I'd like to claim this under HRDC.",
  // §10.3's wording. A translation may not narrow or widen it: the Chinese
  // must name the same two channels and the same use.
  "form.consent":
    "Yes, send me news about LEAD's classes and offers by email and WhatsApp. You can unsubscribe at any time.",
  "form.submit": "Send enquiry",
  "form.submitting": "Sending…",
  "form.privacy": "How we use your details",
  "form.honeypot": "Company website",
  "form.contactRequired": "Enter an email or a phone number",
  "form.thankYou.heading": "Thank you — got it.",
  "form.thankYou.body":
    "One of our team will be in touch within one working day, on the email or phone number you gave us.",

  // §13 wording by §8.2 response code. Never the route's own message: those
  // are written for an API caller.
  "error.captcha_failed":
    "We couldn't confirm you're a person. Please try again.",
  "error.rate_limited":
    "That's a few enquiries in a short time. Please try again in a minute.",
  "error.payload_too_large":
    "That message is too long. Please shorten it and try again.",
  "error.validation_failed": "Please check the highlighted fields.",
  // An unset key, an unset rate-limit secret or a key we got wrong is our
  // deployment's fault, not the visitor's.
  "error.not_configured":
    "We can't take enquiries right now. Please email us and we'll pick it up.",
  "error.server_error": "Something went wrong at our end. Please try again.",

  // Per-field refusals, by the field name §8.2's validation_failed returns.
  // The route's zod messages are not shown to a visitor in either locale.
  "field.fullName": "Enter your full name.",
  "field.email":
    "Enter a valid email address, or leave it blank and give a phone number instead.",
  "field.phone":
    "Enter a phone number we can reach you on, up to 40 characters.",
  // One sentence for every field that can only fail on length, so the
  // summary above the form does not repeat it once per field.
  "field.tooLong": "That is too long — please shorten it.",
  "field.default": "Please check this field.",
} as const;
