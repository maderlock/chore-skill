# Daily Chores: an Alexa chore timer skill

A custom Alexa skill that runs a chore session of a length you choose (1 to 120
minutes, 25 by default) with spoken countdown reminders. Start it, and Alexa
announces how much time is left, then "time's up", while your music keeps playing.

## What it does

- **Starts a session of any length.** Say how many minutes (1 to 120) and the
  skill creates one Alexa timer per reminder, each with its own spoken message.
  With no length it runs 25 minutes.
- **Announces without interrupting.** The timers use the `ANNOUNCE` behaviour
  with `playAudible: false`. Alexa speaks the text when each timer fires, with no
  chime, and there is nothing to dismiss. Music started separately (for example a
  Spotify playlist in the same Alexa routine) carries on underneath.
- **Tells you the time left.** Ask "Alexa, ask daily chores how much time is
  left" and it reads the remaining time from the running timers.
- **Cancels cleanly.** "Cancel", "stop", "cancel chores" and similar phrases
  delete the timers.

| You say | What happens |
|---|---|
| "Alexa, open daily chores" | Starts a 25-minute session |
| "Alexa, tell daily chores to start for ten minutes" | Starts a 10-minute session |
| "Alexa, tell daily chores to run for twelve minutes" | Starts a 12-minute session |
| "Alexa, ask daily chores how much time is left" | Speaks the time remaining |
| "Alexa, ask daily chores to cancel chores" | Deletes the timers |

The skill session ends straight after each reply, so ask-style phrases need the
skill name in them.

### Reminder schedule

Reminders are spoken at 1 and 5 minutes left, plus every multiple of 5 minutes
left above that, so a 13-minute session reminds at 10, 5 and 1 minutes left, and a
25-minute one at 20, 15, 10, 5 and 1. Then "time's up" at the end. Alexa limits how
many timers a skill can hold, so for long sessions the earlier reminders are spaced
10, 15, 20... minutes apart instead, keeping to 10 timers in total.

### Limits

- **120 minutes maximum.** Alexa will not create a timer more than two hours
  ahead.
- **Music is not controlled by the skill.** It cannot start or stop Spotify. The
  routine starts the playlist; stop it yourself when the final announcement plays,
  or say "stop".

## How it works

```
Alexa device  ->  Alexa Skills Kit  ->  Lambda (TypeScript)  ->  Alexa Timers API
                  (interaction model)   (ask-sdk-core)           (a few timers)
```

1. **Interaction model** (`skill-package/`). The invocation name is
   `daily chores`. `StartChoresIntent`, `StopChoresIntent` and `TimeLeftIntent`
   map spoken phrases to intents.
2. **Lambda** (`lambda/src/index.ts`). Request handlers:
   - *Start* checks the Timers permission, deletes any previous run's timers, then
     creates one per reminder from `buildCheckpoints` (`lambda/src/schedule.ts`). Without
     the permission it asks for
     consent, and creates the timers when the user accepts.
   - *Time left* lists the skill's timers, finds the final one, and subtracts the
     current time from its trigger time. No state is stored anywhere.
   - *Stop* deletes all of the skill's timers. It also handles Alexa's built-in
     cancel and stop intents.
3. **Timers.** Each is created with an ISO 8601 duration, a hidden on-screen
   display, and the `ANNOUNCE` operation described above.
4. **Hosting.** AWS SAM deploys the Lambda, its Alexa trigger (restricted to this
   skill's ID) and a log group with 14 days of retention. The region is `eu-west-1`
   (Ireland), one of the regions Alexa can invoke Lambda in directly for Europe.
   The skill locale is `en-GB`.
5. **Skill metadata** (manifest and interaction model) is deployed separately
   with the ASK CLI. SAM owns the Lambda; the ASK CLI never deploys code.

`skill.json` holds the placeholder `__LAMBDA_ARN__`. `make deploy-skill` reads the
real ARN from the CloudFormation stack output and renders it into `build/`, which
is gitignored, so no account ID is ever committed.

## Layout

| Path | What it is |
|---|---|
| `lambda/` | TypeScript skill handler (`ask-sdk-core`), bundled by SAM with esbuild |
| `skill-package/` | Skill manifest and interaction model, deployed with the ASK CLI |
| `template.yaml`, `samconfig.toml` | SAM stack: Lambda, Alexa trigger, log group |
| `.env.example` | Template for local settings (copy to `.env`, which is gitignored) |
| `Makefile` | Build and deploy entry points (`make help`) |
| `.github/workflows/ci.yml` | Type-check, SAM lint and build, and secret scan |

The repo is the source of truth for the skill. `make deploy-skill` overwrites the
manifest and interaction model in the Alexa Developer Console, so make changes
here and not in the console.

## Prerequisites

- Node 22 (see `.nvmrc`), AWS CLI v2, AWS SAM CLI (`brew install awscli aws-sam-cli`)
- An AWS SSO profile with permission to deploy Lambda and CloudFormation in `eu-west-1`
- An ASK CLI profile linked to the Amazon developer account that owns the skill
- An existing skill in the Alexa Developer Console (custom model, `en-GB`)

## First-time setup

```sh
make install                     # installs the ASK CLI locally + Lambda deps
npx ask configure --no-browser   # sign in to the Amazon developer account;
                                 # answer "No" to linking an AWS account
cp .env.example .env             # then set AWS_PROFILE and SKILL_ID
```

All account-specific values live in `.env`. ASK CLI credentials are stored in
`~/.ask/` by `ask configure`, outside the repo.

After the first deploy, grant the Timers permission once: Alexa app, More,
Skills & Games, Your Skills, Dev, the skill, Settings, Manage permissions.

## Everyday use

```sh
make login     # refresh the SSO session when it expires
make push      # deploy the Lambda, then the skill manifest and interaction model
make logs      # tail CloudWatch logs
```

Other targets: `typecheck`, `validate`, `build`, `deploy-lambda`, `deploy-skill`,
`pull-skill` (download the live skill package to `.pull/` for comparison), `clean`.

## Playing music alongside it

Create an Alexa routine with the skill as the first action (a Custom action such
as `tell daily chores to start for 25 minutes`) and your music as the last action.
Keep the music last so starting the skill does not interrupt it. A routine's sleep
timer is a fixed length, so either leave it off and stop the music yourself, or make
one routine per common length with a matching sleep timer.

## Changing the countdown

Edit `buildCheckpoints` in `lambda/src/schedule.ts` (when reminders fire and the
words Alexa says), or the `DEFAULT_MINUTES`, `MAX_MINUTES` and `MAX_TIMERS`
constants at the top of that file, and run `make push`. The latest-ending running
timer is treated as the end of the session when answering "how much time is left".

## Public repo hygiene

Nothing account-specific is committed: settings live in `.env`, ASK CLI tokens in
`~/.ask/`, and generated files (rendered manifest, ASK state, SAM build output) in
gitignored folders. CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every
push as a backstop.
