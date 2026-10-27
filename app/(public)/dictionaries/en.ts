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
  // §4: the timezone belongs here, not only beside each date — every
  // class LEAD runs is on Malaysian time and a visitor reading from
  // Singapore or Jakarta cannot tell from a bare date.
  "schedule.standfirst":
    "Upcoming public classes. Dates and times are Malaysian time.",
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

  // The language a class is taught in, as the card's badge, the language
  // filter and the register summary all name it.
  "language.en": "English",
  "language.zh": "中文",

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
  // §10.3's sentence, word for word (spec v1.24). "offers" widens what
  // the visitor agreed to and an unsubscribe promise is one nothing in v1
  // keeps, so neither belongs here without the PDPA sign-off.
  "form.consent": "Send me updates about LEAD courses by email and WhatsApp.",
  "form.submit": "Send enquiry",
  "form.submitting": "Sending…",
  "form.privacy": "How we use your details",
  "form.honeypot": "Company website",
  "form.contactRequired": "Enter an email or a phone number",
  "form.thankYou.heading": "Thank you — got it.",
  // shortcut: "within one working day" is not a promise the spec makes
  // anywhere, and nothing in v1 measures it. It reads well and it is what
  // the team does today, so it stays until Shawn either writes it into §10.3
  // or replaces it; it is a sentence to change, not code.
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
  // §8.3's three refusals (website-register). Each names what to do next.
  "error.class_unavailable":
    "That class isn't open for registration any more. Pick another date, or tell us what you're after.",
  "error.no_seats":
    "The last seat went while you were filling this in. Pick another date, or ask us about the next one.",
  "error.already_enrolled":
    "You're already registered for this class. Check your email for the details, or ask us if nothing arrived.",
  // An unset key, an unset rate-limit secret or a key we got wrong is our
  // deployment's fault, not the visitor's.
  // shortcut: this asks the visitor to email us and names no address. The
  // spec names no public address anywhere and no open item covers one, so
  // there is nothing to put here yet — raised with Shawn on #12. It is the
  // only message that leaves the visitor with nothing to act on.
  //
  // The one confirmed way in is thelead.io/contact-us-lead/, a Contact Form 7
  // page (Shawn checked the site, #11). Sending them there instead of asking
  // for an email we cannot name would be the better fix, and needs his word
  // on whether that form is the right place for a failed enquiry.
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

  // §10.4 — the register page. The class's own details (course name, code,
  // dates, venue, price) stay as the §8.1 feed gave them in both locales.
  "register.title": "Register — LEAD",
  "register.description":
    "Take your seat in an upcoming LEAD class. Pay by card, or tell us you're claiming under HRDC.",
  "register.heading": "Register for {course}",
  "register.standfirst": "Your seat is held for 24 hours once you continue.",
  "register.summary.dates": "Dates",
  "register.summary.time": "Time",
  "register.summary.where": "Where",
  "register.summary.price": "Price",
  "register.summary.seats": "Seats",
  "register.submit": "Continue to payment",
  "register.submitting": "Taking you to payment…",
  "register.hrdcNote":
    "Claiming under HRDC? Tick the box and we'll invoice your employer instead of taking card payment.",
  "register.hrdc.heading": "We'll be in touch about HRDC claiming.",
  "register.hrdc.body":
    "HRDC seats are invoiced, not paid by card. Our team will contact you to set up the claim and confirm your seat.",
  // A class the §8.1 feed does not list: unknown, private, past, cancelled or
  // completed. Not a 404 — the visitor came from somewhere, so the page names
  // the way on.
  "register.unavailable.heading": "This class isn't open for registration",
  "register.unavailable.body":
    "It may have started, filled up or been taken off the schedule. The current dates are on the schedule page.",
  "register.full.heading": "This class is full",
  "register.full.body":
    "Ask us about the next date — we'll tell you as soon as one opens.",
  "register.closed.heading": "Registration isn't open yet",
  "register.closed.body":
    "We can't take card payments for this class yet. Tell us you're interested and we'll come back to you.",
  "register.toSchedule": "See the schedule",
  "register.toEnquiry": "Ask about this class",

  // The page Stripe returns a payer to. It confirms and creates nothing: the
  // enrolment is confirmed by the payment webhook (§11.2).
  "thankYou.title": "Thank you — LEAD",
  "thankYou.description": "Your registration is in. Here's what happens next.",
  "thankYou.heading": "Thank you — your payment went through.",
  "thankYou.body":
    "We'll send your joining details by email and WhatsApp, including the venue, the start time and what to bring.",
  "thankYou.noSession.heading": "Nothing is confirmed yet",
  "thankYou.noSession.body":
    "We have no payment to show against this page. If you were part-way through, start again from the schedule, or ask us and we'll check.",
} as const;
