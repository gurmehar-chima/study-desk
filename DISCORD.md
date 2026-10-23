# Study Desk on Discord

Use the Study Desk assistant from Discord: ask what's due, plan your day, or invite friends to study, without opening the website.

## For students

1. Sign in on the friends page: https://gurmehar-chima.github.io/study-desk/social.html
2. In the Friends section, click **Connect Discord**.
3. Click **Add Study Desk to your Discord account** and choose **Add to My Apps**.
4. In Discord, open a DM with the Study Desk app (or any chat), type `/link`, and enter the code from the website.

Then use these commands in a DM with the app or in any chat. Replies are only visible to you.

| Command | What it does |
| --- | --- |
| `/today` | Today's classes, what's due, overdue work and meetings |
| `/ask question` | The assistant: plans, priorities, explanations, quizzes. It can also add events and tasks to your calendar, invite friends to meetings, and send or accept friend requests |
| `/link code` | Connect your account |
| `/unlink` | Disconnect and delete your schedule copy |
| `/help` | List the commands |

**Privacy.** While Discord is connected, the friends page keeps a private copy of your classes and assignment titles (two weeks back to six weeks ahead) on the Study Desk server so the bot can answer. Friends can't see it. `/unlink` or **Disconnect** deletes it. The copy updates whenever you open the friends page or change your planner.

**Limits.** Each person can ask 40 questions a day. The AI runs on Cloudflare's free Workers AI allowance, which the whole Study Desk server shares.

## How it works

```
social/discord.js          the Discord commands, the AI call, and the Send/Skip buttons
social/worker.js           routes /discord to discord.js
social/wrangler.jsonc      DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, and the Workers AI binding
site/discord-link.js/.css  the Connect Discord panel on social.html
```

Discord sends each command to `https://study-desk-social.gc756325.workers.dev/discord`, signed with the app's key. The Worker rejects anything without a valid signature.

## Setting up the Discord app (one time)

1. Create an application at https://discord.com/developers/applications.
2. Copy its **Application ID** and **Public Key** into the `vars` in `social/wrangler.jsonc`, then push.
3. Under **Installation**, turn on **User Install** with the `applications.commands` scope.
4. Under **General Information**, set **Interactions Endpoint URL** to `https://study-desk-social.gc756325.workers.dev/discord`.
5. Under **Bot**, click **Reset Token** and copy the token. In Cloudflare, add it to the `study-desk-social` Worker as a **Secret** named `DISCORD_BOT_TOKEN`.
6. Open `https://study-desk-social.gc756325.workers.dev/discord/register` once to register the commands.

**Optional settings.** To use a different Workers AI model, set `AI_MODEL`. To use Ollama Cloud instead, add an `OLLAMA_API_KEY` secret and optionally `OLLAMA_MODEL`.

## Asking the bot to do things

Ask in plain words, for example:

- `/ask schedule Alone study time tomorrow at 3pm for 2 hours`
- `/ask add a task to read chapter 7 for MATH 2301 due Friday`
- `/ask invite sam_k to study Thursday when we're both free`
- `/ask send a friend request to lee` or `/ask accept Lee's request`

The bot does it right away and confirms each change with a ✅ line and an **Undo** button. If something looks off, it asks first with **Do it anyway** and **Skip**: for example, when you or a friend is already busy then, or when it can't see a friend's calendar.

Events and tasks for just you go to your own Study Desk calendar. Your planner lives in your browser, so they're added the next time you open the friends page (or within a minute if it's already open). Until then, `/today` and `/ask` already know about them. **Undo** works until they've been added. After that, click the item on the calendar and choose **Delete**.

Meeting invites, friend requests and accepts go through at once; friends see invites in their Meetings list.
