# Chore Timer: Alexa skill

A 25-minute chore timer. Launching the skill creates a set of Alexa timers that
*announce* the time remaining (no chime, nothing to dismiss), so music started
separately, for example from Spotify in the same Alexa routine, keeps playing.

## Layout

| Path | What it is |
|---|---|
| `lambda/` | TypeScript skill handler (ask-sdk-core), bundled by SAM with esbuild |
| `skill-package/` | Skill manifest and interaction model, deployed with the ASK CLI |
| `template.yaml`, `samconfig.toml` | SAM stack: Lambda, Alexa trigger, log group |
| `.env.example` | Template for local settings (copy to `.env`, which is gitignored) |
| `Makefile` | Build and deploy entry points (`make help`) |

`skill.json` contains `__LAMBDA_ARN__`, which `make deploy-skill` replaces with the
ARN from the CloudFormation stack output. The rendered copy goes in `build/`
(gitignored), so no account ID or skill ID is ever committed.

## Prerequisites

- Node 22, AWS CLI v2, AWS SAM CLI (`brew install awscli aws-sam-cli`)
- An AWS SSO profile
- An ASK CLI profile linked to the Amazon developer account that owns the skill

## First-time setup

```sh
make install                     # installs the ASK CLI locally + Lambda deps
npx ask configure --no-browser   # sign in to the Amazon developer account;
                                 # answer "No" to linking an AWS account
```

```sh
cp .env.example .env   # then set AWS_PROFILE and SKILL_ID
```

All account-specific values live in `.env`. ASK CLI credentials are stored in
`~/.ask/` by `ask configure`, outside the repo.

## Everyday use

```sh
make login     # refresh the SSO session when it expires
make push      # deploy the Lambda, then the skill manifest and interaction model
make logs      # tail CloudWatch logs
```

Other targets: `typecheck`, `validate`, `build`, `deploy-lambda`, `deploy-skill`,
`pull-skill` (download the live skill package to `.pull/` for comparison), `clean`.

## Changing the countdown

Edit `CHECKPOINTS` in `lambda/src/index.ts` and run `make push`.

## Public repo hygiene

Nothing account-specific is committed: settings live in `.env`, ASK CLI tokens in
`~/.ask/`, and generated files (rendered manifest, ASK state, SAM build output) in
gitignored folders. CI runs [gitleaks](https://github.com/gitleaks/gitleaks) on every
push as a backstop.
