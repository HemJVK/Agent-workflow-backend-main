import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // App
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Auth
  JWT_SECRET: Joi.string().required(),

  // AI Providers
  OPENROUTER_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // Twilio (optional unless you rely on SMS)
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_API_KEY_SID: Joi.string().allow('').optional(),
  TWILIO_API_KEY_SECRET: Joi.string().allow('').optional(),
  TWILIO_PHONE_NUMBER: Joi.string().allow('').optional(),

  // Temporal
  TEMPORAL_ADDRESS: Joi.string().default('temporal:7233'),
  TEMPORAL_TASK_QUEUE: Joi.string().default('agentic-workflow-queue'),
  TEMPORAL_NAMESPACE: Joi.string().default('default'),

  // MCP / Marketplaces
  SMITHERY_API_KEY: Joi.string().allow('').optional(),
  GLAMA_API_KEY: Joi.string().allow('').optional(),

  // Other Keys
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
  GOOGLE_GEMINI_API_KEY: Joi.string().allow('').optional(),

  // Database (Fail if these are missing)
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),

  // Composio (per-user Gmail MCP integration)
  COMPOSIO_API_KEY: Joi.string().allow('').optional(),
});
