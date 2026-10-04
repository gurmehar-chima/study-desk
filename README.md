# Study Desk

A study planner that puts class times and due dates from **Canvas**, **Microsoft 365** and **Google Classroom** on one calendar, shows what is due each day, and includes an AI study assistant.

It is a plain HTML, CSS and JavaScript site hosted free on GitHub Pages. There is no server and nothing to install.

## Put it online

1. Create a new **public** repository on GitHub named `study-desk` and upload everything in this folder, keeping the folder structure (including `.github`).
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. The workflow **Sync calendars and publish** runs on its own; if it has not, select it and click **Run workflow**.
4. Your site is at `https://YOUR-USERNAME.github.io/study-desk/`.

## Link your calendars

Canvas, Microsoft and Google do not allow a web page to read a calendar link directly. Instead, this repository fetches your links every hour and publishes an encrypted copy that only your passphrase can open.

**1. Copy a link from each service you use**

| Service | Where the link is |
| --- | --- |
| Canvas | Calendar → **Calendar Feed** (bottom of the right sidebar). One link covers all courses. |
| Microsoft 365 | Outlook on the web → Settings → Calendar → Shared calendars → **Publish a calendar** → copy the **ICS** link. |
| Google Classroom | calendar.google.com → the class calendar → Settings and sharing → Integrate calendar → **Secret address in iCal format**. One per class. |

Some schools turn off calendar publishing in Outlook or Google. If the link is missing, export a `.ics` file instead and use **Connect calendars → Import file** on the site.

**2. Add two repository secrets** under **Settings → Secrets and variables → Actions → New repository secret**

- `CALENDAR_FEEDS`: one calendar per line, written as `Name | link`

  ```
  Canvas | https://yourschool.instructure.com/feeds/calendars/user_XXXX.ics
  Outlook | https://outlook.office365.com/owa/calendar/XXXX/calendar.ics
  BIOL 1710 | https://calendar.google.com/calendar/ical/XXXX/private-XXXX/basic.ics
  ```

- `PLANNER_PASSPHRASE`: a passphrase of at least 12 characters. Make it long and unique.

**3. Run the workflow once** from the Actions tab, then open the site and enter the passphrase. Each browser asks once.

After that the calendars refresh every hour. Items you check off stay checked.

## The AI assistant

On the site, open **Settings** in the assistant panel and paste an Anthropic API key from <https://platform.claude.com/settings/keys>. The key stays in that browser and is sent only to `api.anthropic.com`. Each question is billed to that key's account, so set a spending limit there.

## Privacy

- Calendar links act like passwords. They live only in GitHub secrets and are never written to logs or to the site.
- The published schedule file is encrypted with AES-256-GCM using a key derived from your passphrase. Anyone can download the file, so its safety depends on the passphrase.
- Your checked-off items, manual entries and API key are stored in your browser only. They do not move between devices.

## Good to know

- GitHub pauses scheduled workflows after 60 days with no repository activity. Re-enable it from the Actions tab if syncing stops.
- Weekly repeating events are treated as classes. Other entries are treated as deadlines or events, and you can edit any of them.
- Times use the time zone of the device you are viewing on.

## Layout

```
site/index.html, styles.css, app.js   the web page
scripts/sync.mjs                      fetches and encrypts calendar links
.github/workflows/sync.yml            runs the sync hourly and publishes the site
```
