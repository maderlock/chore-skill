import * as Alexa from 'ask-sdk-core';
import { services } from 'ask-sdk-model';
import { buildCheckpoints, DEFAULT_MINUTES, MAX_MINUTES, parseMinutes, spokenMinutes } from './schedule';

const TIMER_SCOPE = 'alexa::alerts:timers:skill:readwrite';
const LOCALE = 'en-GB';

const timerRequest = (mins: number, text: string): services.timerManagement.TimerRequest => ({
  duration: `PT${mins}M`,
  timerLabel: `chores ${mins}`,
  creationBehavior: { displayExperience: { visibility: 'HIDDEN' } },
  triggeringBehavior: {
    operation: { type: 'ANNOUNCE', textToAnnounce: [{ locale: LOCALE, text }] },
    notificationConfig: { playAudible: false },
  },
});

// Some request types (e.g. "ask/tell <skill> ...") arrive without the per-scope map, so
// also accept a consent token. Stop and time-left do not rely on this: they just call
// the API and handle a 401/403 as "no permission".
const hasTimerPermission = (h: Alexa.HandlerInput): boolean => {
  const perms = h.requestEnvelope.context.System.user.permissions;
  return perms?.scopes?.[TIMER_SCOPE]?.status === 'GRANTED' || !!perms?.consentToken;
};

const isPermissionError = (e: unknown): boolean => {
  const code = (e as { statusCode?: number })?.statusCode;
  return code === 401 || code === 403;
};

const NO_PERMISSION_SPEECH =
  'I don\u2019t have permission to manage timers. Please turn on Timers for this skill in the Alexa app.';

const askForPermission = (h: Alexa.HandlerInput) =>
  h.responseBuilder
    .addDirective({
      type: 'Connections.SendRequest',
      name: 'AskFor',
      payload: {
        '@type': 'AskForPermissionsConsentRequest',
        '@version': '1',
        permissionScope: TIMER_SCOPE,
      },
      token: '',
    })
    .getResponse();

// Delete every timer the skill owns, then re-list to confirm. Returns how many are left.
const clearTimers = async (timers: any): Promise<number> => {
  const before = await timers.getTimers();
  console.log('Timers before clear:', JSON.stringify(before.timers ?? []));
  await timers.deleteTimers();
  const mid = await timers.getTimers();
  await Promise.all((mid.timers ?? []).map((t: any) => (t.id ? timers.deleteTimer(t.id) : undefined)));
  const after = await timers.getTimers();
  console.log('Timers after clear:', JSON.stringify(after.timers ?? []));
  return (after.timers ?? []).length;
};

const slotMinutes = (h: Alexa.HandlerInput): { given: boolean; minutes?: number } => {
  const raw = Alexa.getSlotValue(h.requestEnvelope, 'minutes');
  if (raw === undefined || raw === null || raw === '') return { given: false };
  return { given: true, minutes: parseMinutes(raw) };
};

class TooManyTimersError extends Error {}

const startTimers = async (h: Alexa.HandlerInput, total: number) => {
  const timers = h.serviceClientFactory!.getTimerManagementServiceClient();
  await clearTimers(timers); // clear any previous run so restarting is clean
  try {
    await Promise.all(buildCheckpoints(total).map((c) => timers.createTimer(timerRequest(c.at, c.text))));
  } catch (e) {
    if (JSON.stringify(e, Object.getOwnPropertyNames(e as object)).includes('MAX_TIMERS_EXCEEDED')) {
      await clearTimers(timers);
      throw new TooManyTimersError();
    }
    throw e;
  }
};

const TOO_MANY_SPEECH =
  'Sorry, Alexa has too many timers set already. Cancel some of your own timers and try again.';

const startedSpeech = (total: number) => `Chore timer started. ${spokenMinutes(total)}, go!`;

const StartHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest' ||
    (Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'StartChoresIntent'),
  async handle(h) {
    const slot = slotMinutes(h);
    if (slot.given && slot.minutes === undefined) {
      return h.responseBuilder
        .speak(`I can time from 1 to ${MAX_MINUTES} minutes. How many minutes?`)
        .reprompt('How many minutes would you like?')
        .withShouldEndSession(false)
        .getResponse();
    }
    const total = slot.minutes ?? DEFAULT_MINUTES;
    if (!hasTimerPermission(h)) {
      h.attributesManager.setSessionAttributes({ minutes: total });
      return askForPermission(h);
    }
    try {
      await startTimers(h, total);
    } catch (e) {
      if (e instanceof TooManyTimersError) {
        return h.responseBuilder.speak(TOO_MANY_SPEECH).withShouldEndSession(true).getResponse();
      }
      throw e;
    }
    return h.responseBuilder.speak(startedSpeech(total)).withShouldEndSession(true).getResponse();
  },
};

// Alexa calls back here after the user answers the permission prompt.
const PermissionResponseHandler: Alexa.RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'Connections.Response',
  async handle(h) {
    const status = (h.requestEnvelope.request as any).payload?.status;
    if (status === 'ACCEPTED') {
      const total = Number(h.attributesManager.getSessionAttributes().minutes) || DEFAULT_MINUTES;
      try {
        await startTimers(h, total);
      } catch (e) {
        if (e instanceof TooManyTimersError) {
          return h.responseBuilder.speak(TOO_MANY_SPEECH).withShouldEndSession(true).getResponse();
        }
        throw e;
      }
      return h.responseBuilder
        .speak(`Thanks. ${startedSpeech(total)}`)
        .withShouldEndSession(true)
        .getResponse();
    }
    return h.responseBuilder
      .speak('I need permission to set timers. You can grant it in the Alexa app under this skill\u2019s settings.')
      .withShouldEndSession(true)
      .getResponse();
  },
};

const TimeLeftHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(h.requestEnvelope) === 'TimeLeftIntent',
  async handle(h) {
    let secondsLeft = 0;
    try {
      const res = await h.serviceClientFactory!.getTimerManagementServiceClient().getTimers();
      // The session ends when the last of the skill's running timers fires.
      const finalTimer = (res.timers ?? [])
        .filter((t) => /^chores \d+$/i.test(t.timerLabel ?? '') && t.status === 'ON' && t.triggerTime)
        .sort((x, y) => new Date(y.triggerTime!).getTime() - new Date(x.triggerTime!).getTime())[0];
      if (finalTimer?.triggerTime) {
        secondsLeft = Math.round((new Date(finalTimer.triggerTime).getTime() - Date.now()) / 1000);
      }
    } catch (e) {
      if (isPermissionError(e)) {
        return h.responseBuilder.speak(NO_PERMISSION_SPEECH).withShouldEndSession(true).getResponse();
      }
      throw e;
    }
    let speech: string;
    if (secondsLeft <= 0) {
      speech = 'There is no chore timer running.';
    } else if (secondsLeft < 60) {
      speech = 'Less than a minute left.';
    } else {
      const mins = Math.ceil(secondsLeft / 60);
      speech = `${mins} ${mins === 1 ? 'minute' : 'minutes'} left.`;
    }
    return h.responseBuilder.speak(speech).withShouldEndSession(true).getResponse();
  },
};

const StopChoresHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    ['StopChoresIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(
      Alexa.getIntentName(h.requestEnvelope),
    ),
  async handle(h) {
    const perms = h.requestEnvelope.context.System.user.permissions;
    console.log(
      'Stop request:',
      Alexa.getIntentName(h.requestEnvelope),
      'scopes:',
      JSON.stringify(perms?.scopes ?? null),
      'consentToken present:',
      !!perms?.consentToken,
    );
    let remaining = 0;
    try {
      remaining = await clearTimers(h.serviceClientFactory!.getTimerManagementServiceClient());
    } catch (e) {
      console.error('Stop failed:', JSON.stringify(e, Object.getOwnPropertyNames(e as object)));
      if (isPermissionError(e)) {
        return h.responseBuilder.speak(NO_PERMISSION_SPEECH).withShouldEndSession(true).getResponse();
      }
      throw e;
    }
    const speech = remaining
      ? `Sorry, I couldn\u2019t cancel ${remaining} of the timers.`
      : 'Chore timer cancelled.';
    return h.responseBuilder.speak(speech).withShouldEndSession(true).getResponse();
  },
};

const HelpHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent',
  handle: (h) =>
    h.responseBuilder
      .speak(`Say start for ten minutes, for any length from 1 to ${MAX_MINUTES} minutes. Ask how much time is left, or say cancel to stop it.`)
      .reprompt('How many minutes would you like?')
      .getResponse(),
};

const ExitHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    ['AMAZON.NavigateHomeIntent', 'AMAZON.FallbackIntent'].includes(
      Alexa.getIntentName(h.requestEnvelope),
    ),
  handle: (h) => h.responseBuilder.withShouldEndSession(true).getResponse(),
};

const SessionEndedHandler: Alexa.RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest',
  handle: (h) => h.responseBuilder.getResponse(),
};

const ErrorHandler: Alexa.ErrorHandler = {
  canHandle: () => true,
  handle(h, error) {
    console.error('Chore timer error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return h.responseBuilder
      .speak('Sorry, I couldn\u2019t start the chore timer.')
      .withShouldEndSession(true)
      .getResponse();
  },
};

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    StartHandler,
    PermissionResponseHandler,
    StopChoresHandler,
    TimeLeftHandler,
    HelpHandler,
    ExitHandler,
    SessionEndedHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();
