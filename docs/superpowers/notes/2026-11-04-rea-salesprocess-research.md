# Researching SalesProcess with REA (run on your own computer)

The goal is a feature map of SalesProcess, so that `lead_sales` can rebuild the same functions. It should rebuild what SalesProcess does, not copy its code, design or images. REA's own disclaimer rules out copying proprietary code and assets. Check SalesProcess's and GoHighLevel's terms of service before going further; they weren't reviewed when this note was written.

This has to run on your computer. A cloud session can't reach SalesProcess, and it doesn't have your login.

## 1. Install REA in your local Claude Code

Get REA only from github.com/morluto/rea, rea.tools or the `rea-agents` npm package. Run this from a folder outside any project:

```bash
npx rea-agents setup
```

Pick Claude Code, check the changes it proposes, approve them, then restart Claude Code. REA's tools will only show up after the restart.

## 2. Open Chrome so REA can watch it

REA watches a browser through a local debugging port. As far as I know, recent Chrome versions only allow this with a separate profile folder. Check this against Chrome's current documentation.

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/rea-chrome-profile"
```

Windows (PowerShell):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\rea-chrome-profile"
```

In that window, log in to SalesProcess. The browser keeps your login; REA never sees your password.

## 3. Prompt to paste into your local Claude Code

> Use REA to research the SalesProcess web app that is open in my Chrome. The CDP endpoint is http://127.0.0.1:9222. Use list_browser_targets, then observe_web_session while I click through each area myself. Don't click or submit anything yourself. The areas, in order:
> 1. Conversations (inbox, every channel)
> 2. Automation / Workflows (list, one workflow open, its triggers and actions)
> 3. Sites: Funnels, Websites, Forms (list, the editor, form settings)
> 4. Email marketing (campaigns, templates)
> 5. Social Planner
> 6. Payments (transactions, products, integrations)
> 7. Settings: email services, phone/WhatsApp, Facebook/Instagram integrations
>
> For each area, write down:
> - the screens and what each one does
> - the main actions a user can take
> - the data objects and their fields, taken from the API calls (field names and types only; leave out real values)
> - the API endpoints the screens call (method + path, with ids replaced by placeholders)
> - which outside services are connected (email sender, WhatsApp, Meta and so on)
>
> Leave out all personal data: no names, emails, phone numbers, message text, tokens or cookies. Save the result as a markdown feature map called salesprocess-feature-map.md. For each finding, say whether it comes from evidence or is inferred.

## 4. Before you share the result

- Read through `salesprocess-feature-map.md` and remove anything personal that got through.
- Don't commit raw captures (HAR, JSON evidence) to `lead_crm`. The repo is public.
- Paste the feature map, or upload it, into the cloud session. It becomes the build spec for `lead_sales`.
