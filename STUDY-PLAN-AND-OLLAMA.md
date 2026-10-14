# Study plan and free Ollama assistant

These additions live on a second page of the site. Everything on the original page is unchanged.

**Open it:** https://gurmehar-chima.github.io/study-desk/plan.html

It has everything the main page has (calendar, today's tasks, linked calendars, assistant), plus:

- a **Study plan** section with study sessions for each of your classes
- an assistant that can run on a **free Ollama model** instead of a paid Claude key

Your checked-off items, linked calendars and passphrase carry over, because both pages share the same browser storage.

## The study plan

The plan covers the next 7 days and rebuilds itself whenever your planner changes.

1. **It finds your free time.** It starts from your study window (9 AM to 10 PM by default), then blocks out your classes with 15 minutes on each side, plus any events that have times.
2. **Deadlines get prep time first.** Exams get about 5 hours spread over the 6 days before. Papers, essays, labs and projects get 3 hours over 5 days. Quizzes get 1.5 hours over 3 days. Readings and discussion posts get 1 hour. Other assignments get 2 hours over 4 days.
3. **The rest of each class's weekly hours go to review.** The default is about 2 hours of study per hour of class: 1.5 for Light, 2.5 for Heavy. You can type your own number for any class.
4. **Sessions are spread out.** Each session goes on the least crowded day it can, so a class doesn't pile up on one day. Days stay under your maximum hours.
5. **Each session says what to do.** "Review today's lecture, then quiz yourself from memory" lands after that day's class. Other review sessions are "Practice problems and active recall". One "Weekly recap" goes at the end of the week.

Use the class buttons to see one class's schedule at a time. "Did not fit" means your window or daily maximum is too tight; widen the window, raise the maximum, or lower a class's hours. **Review this plan with the assistant** sends the plan to the assistant for feedback.

## Free assistant, option A: Ollama on your computer (no key)

This runs the AI model on your own computer. It costs nothing, but it only works on that computer, and Ollama has to be running.

1. Install Ollama from https://ollama.com/download and open it.
2. In a terminal, download a model. `llama3.2` is small (about 2 GB) and fine for planning help:
   ```
   ollama pull llama3.2
   ```
3. Allow the site to talk to Ollama. This is a one-time setting.
   - **Mac:** run this, then quit Ollama from the menu bar and open it again:
     ```
     launchctl setenv OLLAMA_ORIGINS "https://gurmehar-chima.github.io"
     ```
     This setting is cleared when the Mac restarts; run it again after a restart.
   - **Windows:** run this in Command Prompt, then quit Ollama from the system tray and start it again from the Start menu:
     ```
     setx OLLAMA_ORIGINS "https://gurmehar-chima.github.io"
     ```
   - **Linux:** run `sudo systemctl edit ollama.service`, add the lines below, then run `sudo systemctl daemon-reload && sudo systemctl restart ollama`:
     ```
     [Service]
     Environment="OLLAMA_ORIGINS=https://gurmehar-chima.github.io"
     ```
4. Open the plan page, click **Set up assistant** (or **Settings**), choose **Ollama on this computer**, and click **Test connection**. Pick your model and click **Save**.

Use Chrome, Edge or Firefox. If Chrome asks to let the site find devices on your local network, click Allow; that is how it reaches Ollama. Safari may block the connection.

## Free assistant, option B: your Ollama Cloud key

Ollama Cloud runs bigger models on Ollama's servers, and its free key works from any device. But ollama.com refuses requests made directly from a web page, and a key placed in a public website could be copied by anyone. So the key goes into a small relay that you host free on Cloudflare. The site talks to the relay, and the relay adds your key.

1. **Get the key.** Sign in at https://ollama.com/settings/keys and create a key.
2. **Create the relay.**
   1. Sign up free at https://dash.cloudflare.com.
   2. Go to **Workers & Pages → Create → Create Worker**. Name it `study-desk-ollama` and click **Deploy**.
   3. Click **Edit code**, replace everything with the contents of [`relay/ollama-cloud-worker.js`](relay/ollama-cloud-worker.js), and click **Deploy**.
   4. Open the Worker's **Settings → Variables and Secrets** and add two values of type **Secret**:
      - `OLLAMA_API_KEY`: your Ollama key
      - `ACCESS_CODE`: a long password you make up
   5. Copy the Worker's address. It looks like `https://study-desk-ollama.YOUR-NAME.workers.dev`.
3. **Connect the site.** On the plan page, open the assistant's **Settings**, choose **Ollama Cloud key**, paste the relay address and your access code, then click **Test connection**. Pick a model from the list (for example `gemma4:31b`) and click **Save**.

The relay only accepts requests that come from your site and carry your access code, so others can't use up your free allowance. Ollama's free tier has usage limits; check them at https://ollama.com/settings/usage.

## Option C: Claude

The **Claude (Anthropic API key)** choice works the same as on the main page.

## Files added

```
site/plan.html          the page with the study plan
site/plan.css           its styles
site/study-plan.js      builds the study plan
site/ai-providers.js    connects the assistant to Ollama
relay/ollama-cloud-worker.js   the Cloudflare relay for an Ollama Cloud key
STUDY-PLAN-AND-OLLAMA.md       this guide
```

None of the original files were changed. The existing workflow publishes `site/`, so `plan.html` goes live with each run.
