# /register price and SST: review point for Zhixuan (18 Nov 2026)

Status: open. Needed before any SalesProcess payment link moves to `/register/<class>` (WP6, due 14 Dec).

## What the code does today

- `lib/public/register.ts` charges the class's `price_myr`, or the course's `list_price_myr` when the class has none.
- `lib/payments/checkout.ts` sends that to Stripe as one `price_data` line item (MYR, `unit_amount` in sen). There is no `automatic_tax` and no `tax_rates`, and nothing in `lib` handles SST. A buyer pays exactly the stored price.
- The course list prices are RM 3,200, 680 and 228. SalesProcess charged 3,456, 734.40 and 246.24, which is each of those plus 8%. The 30 Oct price list says website prices are before SST.

So moving a link as things stand lowers the price by 8%.

## Options

1. **Store SST-inclusive prices** (3,456 and so on) on the course or class. Smallest change. The payment record then holds the gross amount, so reports and refunds include the tax.
2. **Have Stripe add the tax** (Stripe Tax or a fixed 8% rate) in `lib/payments/checkout.ts`. Prices stay ex-SST. Needs a code change, Stripe account setup, and a real test payment.

Whether SST applies, and how it is reported, is for the accountant to confirm.

## Also to settle

- All upcoming classes are `is_public = false`, so `/register/<code>` returns "unavailable" until each is published.
- Class prices are empty, and the LMS cannot fill them: Zhixuan checked on 19 Nov and all 14 cohorts have no `price_cents`, including the 23 Nov Vibe Coding class. So the prices have to be entered in the CRM (class edit) once the SST question above is settled. A fallback that copies an LMS price into an empty class price is in #95, for when JM fills prices; it is not needed for WP6.
- Gaps with no upcoming class: the Chinese and JB Vibe Coding links, the Chinese Full-Stack link, and AI Agents Foundation (which also sold at 2,916, against a CRM list price of 3,200).
- The link-to-class mapping and where each link is used (ads, WATI, email, website) are still to be confirmed, and the Stripe live test must pass first.
