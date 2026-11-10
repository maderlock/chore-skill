# Local settings live in .env (gitignored); see .env.example.
-include .env

AWS_REGION  ?= eu-west-1
ASK_PROFILE ?= default
AWS_PROFILE ?=
SKILL_ID    ?=

export AWS_REGION
# Only export a profile when one is set, so CI (no .env) uses no profile at all.
ifneq ($(strip $(AWS_PROFILE)),)
export AWS_PROFILE
endif

STACK     := chore-timer-skill
ASK       := $(CURDIR)/node_modules/.bin/ask
BUILD_DIR := build
SKILL_OUT := $(BUILD_DIR)/skill-package

.DEFAULT_GOAL := help
.PHONY: help install login check-config typecheck validate build deploy-lambda render-skill deploy-skill push pull-skill logs clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install root (ASK CLI) and Lambda dependencies
	npm ci
	cd lambda && npm ci

login: ## Refresh the AWS SSO session
	aws sso login --profile $(AWS_PROFILE)

check-config:
	@[ -n "$(AWS_PROFILE)" ] || { echo "Set AWS_PROFILE in .env (copy .env.example)"; exit 1; }
	@case "$(SKILL_ID)" in amzn1.ask.skill.*) ;; *) echo "Set SKILL_ID in .env (copy .env.example)"; exit 1;; esac
	@aws sts get-caller-identity >/dev/null 2>&1 || { echo "No valid AWS session for $(AWS_PROFILE): run 'make login'"; exit 1; }

typecheck: ## Type-check the Lambda source
	cd lambda && npx tsc --noEmit

validate: ## Lint the SAM template
	sam validate --lint --region $(AWS_REGION)

build: typecheck ## Bundle the Lambda with SAM + esbuild
	sam build

deploy-lambda: check-config build ## Deploy the Lambda stack (SAM / CloudFormation)
	sam deploy --region $(AWS_REGION) --parameter-overrides SkillId=$(SKILL_ID)

render-skill: check-config
	@ARN=$$(aws cloudformation describe-stacks --region $(AWS_REGION) --stack-name $(STACK) \
	    --query "Stacks[0].Outputs[?OutputKey=='FunctionArn'].OutputValue" --output text 2>/dev/null); \
	if [ -z "$$ARN" ] || [ "$$ARN" = "None" ]; then echo "Stack not found: run 'make deploy-lambda' first"; exit 1; fi; \
	rm -rf $(BUILD_DIR) && mkdir -p $(BUILD_DIR)/.ask && cp -R skill-package $(SKILL_OUT); \
	sed -i.bak "s|__LAMBDA_ARN__|$$ARN|" $(SKILL_OUT)/skill.json && rm $(SKILL_OUT)/skill.json.bak; \
	printf '{"askcliResourcesVersion":"2020-03-31","profiles":{"%s":{"skillMetadata":{"src":"./skill-package"}}}}\n' "$(ASK_PROFILE)" > $(BUILD_DIR)/ask-resources.json; \
	printf '{"askcliStatesVersion":"2020-03-31","profiles":{"%s":{"skillId":"%s"}}}\n' "$(ASK_PROFILE)" "$(SKILL_ID)" > $(BUILD_DIR)/.ask/ask-states.json; \
	echo "Skill endpoint -> $$ARN"

deploy-skill: render-skill ## Deploy skill manifest + interaction model (ASK CLI)
	cd $(BUILD_DIR) && $(ASK) deploy --target skill-metadata --ignore-hash --profile $(ASK_PROFILE)

push: deploy-lambda deploy-skill ## Deploy everything

pull-skill: ## Download the live skill package into .pull/ to compare with skill-package/
	rm -rf .pull && mkdir .pull && cd .pull && $(ASK) smapi export-package --skill-id $(SKILL_ID) --stage development --profile $(ASK_PROFILE)

logs: ## Tail the Lambda logs
	sam logs --stack-name $(STACK) --region $(AWS_REGION) --tail

clean: ## Remove build output
	rm -rf .aws-sam $(BUILD_DIR) .pull
