# Friends and shared calendars

A new page adds a calendar-based friends network to Study Desk. Everything on the other pages is unchanged.

**Open it:** https://gurmehar-chima.github.io/study-desk/social.html

It has everything the study plan page has (calendar, today's tasks, linked calendars, study plan, assistant), plus a **Friends** section.

## What it does

- **Accounts.** Create an account with a username and password. Friends find you by your username.
- **Friend requests.** Send a request by username. When the other person accepts, you can each see when the other is busy.
- **Busy times only.** Friends see the times you're busy, never what it is. Busy times come from your classes, events that have times, and meetings you've accepted. Class names, assignment titles and event details never leave your browser. Uncheck **Share mine** next to a friend to stop sharing with them at any time, or click **Remove** to unfriend.
- **Find a meeting time.** Pick friends, a meeting length, how many days ahead, and your earliest and latest times. The page shows a grid of when everyone is free and suggests up to six times. It prefers times that don't sit right against someone's class, fall on lighter days, and aren't very early or late.
- **Invites.** Click **Propose** on a time to send an invite. Friends accept or decline it in their Friends section. Accepted meetings count as busy for everyone, so new suggestions avoid them.
- **The assistant.** **Ask the assistant to pick the best time** sends everyone's busy times (times only) and the suggested slots to the assistant you set up under Settings (Ollama or Claude). It recommends the best option and explains why.

## How it works

```
site/social.html, social.css, social.js    the page (published by GitHub Pages)
social/worker.js                           the backend: accounts, friends, busy times, invites
social/wrangler.jsonc                      Cloudflare settings for the backend
```

The backend is a Cloudflare Worker named `study-desk-social` with a D1 database named `study-desk-social`. Both are on the same free Cloudflare account as the Ollama relay. Cloudflare rebuilds the Worker from the `social` folder whenever this repository changes. It only accepts requests from https://gurmehar-chima.github.io.

## Security and privacy

- Passwords are stored as salted PBKDF2-SHA256 hashes, never as the password itself.
- Sign-in tokens are random and stored only as hashes on the server. Signing out ends the token.
- After 8 wrong passwords, that username is locked for 10 minutes.
- Only the busy start and end times are uploaded. You can see exactly what's shared: the same blocks friends see in the grid.
- **Delete my account** (at the bottom of the Friends section) removes your account, friendships, busy times and invites from the server. Your planner on your device is not affected.
- There is no email on accounts, so a forgotten password can't be reset. Create a new account instead.
