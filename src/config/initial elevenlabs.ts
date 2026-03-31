// TECH LEAD — ElevenLabs API config
// Owner: Dev 4 — Real-time & Communications
// Purpose: ElevenLabs Conversational AI SDK configuration

import { ElevenLabsClient } from 'elevenlabs';

if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error('ELEVENLABS_API_KEY is not set in environment variables');
}

export const elevenLabsClient = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

export const elevenLabsConfig = {
  apiKey: process.env.ELEVENLABS_API_KEY,

  // Agent IDs configured in ElevenLabs dashboard
  agents: {
    providerDispatch: process.env.ELEVENLABS_AGENT_PROVIDER_DISPATCH ?? '',
    userConfirmation: process.env.ELEVENLABS_AGENT_USER_CONFIRMATION ?? '',
    bookingReminder: process.env.ELEVENLABS_AGENT_BOOKING_REMINDER ?? '',
  },

  // Voice IDs for TTS fallback
  voices: {
    default: process.env.ELEVENLABS_VOICE_DEFAULT ?? 'Rachel',
    male: process.env.ELEVENLABS_VOICE_MALE ?? 'Adam',
  },

  // Conversational AI settings
  conversation: {
    maxDurationSeconds: 120,
    silenceTimeoutMs: 8000,
    firstMessageTimeoutMs: 15000,
  },

  // Retry settings for failed calls
  retry: {
    maxAttempts: 3,
    delayMs: 5000,
  },
} as const;

export type ElevenLabsAgentType = keyof typeof elevenLabsConfig.agents;
