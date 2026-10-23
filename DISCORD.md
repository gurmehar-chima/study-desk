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
| `/ask question` | The assistant: plans, priorities, explanations, quizzes. It can also prepare friend requests and meeting invites, which you confirm with **Send** |
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
