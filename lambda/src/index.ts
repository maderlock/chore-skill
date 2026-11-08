import * as Alexa from 'ask-sdk-core';
import { services } from 'ask-sdk-model';

const TIMER_SCOPE = 'alexa::alerts:timers:skill:readwrite';
const LOCALE = 'en-GB';

// [minutes after start, what Alexa says]
const CHECKPOINTS: [number, string][] = [
  [5, 'Twenty minutes left.'],
  [10, 'Fifteen minutes left.'],
  [15, 'Ten minutes left.'],
  [20, 'Five minutes left.'],
  [24, 'One minute left.'],
  [25, "Time's up. Chores done, well done everyone!"],
];

const timerRequest = (mins: number, text: string): services.timerManagement.TimerRequest => ({
  duration: `PT${mins}M`,
  timerLabel: `chores ${mins}`,
  creationBehavior: { displayExperience: { visibility: 'HIDDEN' } },
  triggeringBehavior: {
    operation: { type: 'ANNOUNCE', textToAnnounce: [{ locale: LOCALE, text }] },
    notificationConfig: { playAudible: false },
  },
});

const hasTimerPermission = (h: Alexa.HandlerInput): boolean => {
  const scope = h.requestEnvelope.context.System.user.permissions?.scopes?.[TIMER_SCOPE];
  return scope?.status === 'GRANTED';
};

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

const startTimers = async (h: Alexa.HandlerInput) => {
  const timers = h.serviceClientFactory!.getTimerManagementServiceClient();
  await timers.deleteTimers(); // clear any previous run so restarting is clean
  for (const [mins, text] of CHECKPOINTS) {
    await timers.createTimer(timerRequest(mins, text));
  }
};

const StartHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest' ||
    (Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(h.requestEnvelope) === 'StartChoresIntent'),
  async handle(h) {
    if (!hasTimerPermission(h)) return askForPermission(h);
    await startTimers(h);
    return h.responseBuilder
      .speak('Chore timer started. Twenty-five minutes, go!')
      .withShouldEndSession(true)
      .getResponse();
  },
};

// Alexa calls back here after the user answers the permission prompt.
const PermissionResponseHandler: Alexa.RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'Connections.Response',
  async handle(h) {
    const status = (h.requestEnvelope.request as any).payload?.status;
    if (status === 'ACCEPTED') {
      await startTimers(h);
      return h.responseBuilder
        .speak('Thanks. Chore timer started. Twenty-five minutes, go!')
        .withShouldEndSession(true)
        .getResponse();
    }
    return h.responseBuilder
      .speak('I need permission to set timers. You can grant it in the Alexa app under this skill\u2019s settings.')
      .withShouldEndSession(true)
      .getResponse();
  },
};

const FINAL_MINUTES = CHECKPOINTS[CHECKPOINTS.length - 1][0];

const TimeLeftHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(h.requestEnvelope) === 'TimeLeftIntent',
  async handle(h) {
    let secondsLeft = 0;
    if (hasTimerPermission(h)) {
      const res = await h.serviceClientFactory!.getTimerManagementServiceClient().getTimers();
      const finalTimer = (res.timers ?? []).find(
        (t) => t.timerLabel === `chores ${FINAL_MINUTES}` && t.status === 'ON' && t.triggerTime,
      );
      if (finalTimer?.triggerTime) {
        secondsLeft = Math.round((new Date(finalTimer.triggerTime).getTime() - Date.now()) / 1000);
      }
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
    if (hasTimerPermission(h)) {
      await h.serviceClientFactory!.getTimerManagementServiceClient().deleteTimers();
    }
    return h.responseBuilder.speak('Chore timer cancelled.').withShouldEndSession(true).getResponse();
  },
};

const HelpHandler: Alexa.RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' &&
    Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.HelpIntent',
  handle: (h) =>
    h.responseBuilder
      .speak('Say start chores to begin a twenty-five minute chore timer, how much time is left to check it, or cancel to stop it.')
      .reprompt('Would you like to start chores?')
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
