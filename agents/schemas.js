import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

const sourceRef = {
  type: 'array',
  items: { type: 'string' },
};

export const schemas = {
  viewpoint: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'stances', 'consensus', 'divergence', 'source_answer_ids', 'content_type'],
    properties: {
      content_type: { type: 'string', enum: ['knowledge', 'debate', 'exam', 'collection'] },
      summary: { type: 'string', minLength: 1 },
      stances: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['stance_name', 'stance_summary', 'arguments', 'source_answer_ids'],
          properties: {
            stance_name: { type: 'string', minLength: 1 },
            stance_summary: { type: 'string', minLength: 1 },
            arguments: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            source_answer_ids: sourceRef,
          },
        },
      },
      consensus: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
      },
      divergence: { type: 'string', minLength: 1 },
      source_answer_ids: sourceRef,
    },
  },
  map: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    required: [
      'core_concepts',
      'learning_path',
      'misconceptions',
      'application_scenarios',
      'source_answer_ids',
    ],
    properties: {
      core_concepts: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'definition', 'example', 'source_answer_ids'],
          properties: {
            term: { type: 'string', minLength: 1 },
            definition: { type: 'string', minLength: 1 },
            example: { type: 'string', minLength: 1 },
            source_answer_ids: sourceRef,
          },
        },
      },
      learning_path: {
        type: 'array',
        minItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['step', 'action', 'duration', 'source_answer_ids'],
          properties: {
            step: { type: 'string', minLength: 1 },
            action: { type: 'string', minLength: 1 },
            duration: { type: 'string', minLength: 1 },
            source_answer_ids: sourceRef,
          },
        },
      },
      misconceptions: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['misconception', 'correction', 'source_answer_ids'],
          properties: {
            misconception: { type: 'string', minLength: 1 },
            correction: { type: 'string', minLength: 1 },
            source_answer_ids: sourceRef,
          },
        },
      },
      application_scenarios: {
        type: 'array',
        minItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['scenario', 'practice', 'source_answer_ids'],
          properties: {
            scenario: { type: 'string', minLength: 1 },
            practice: { type: 'string', minLength: 1 },
            source_answer_ids: sourceRef,
          },
        },
      },
      source_answer_ids: sourceRef,
    },
  },
  cards: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    required: ['cards', 'review_schedule', 'source_answer_ids'],
    properties: {
      cards: {
        type: 'array',
        minItems: 5,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'front', 'back', 'source_answer_ids'],
          properties: {
            id: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['qa', 'concept', 'scenario'] },
            front: { type: 'string', minLength: 1 },
            back: { type: 'string', minLength: 1 },
            source_answer_ids: sourceRef,
          },
        },
      },
      review_schedule: {
        type: 'object',
        additionalProperties: false,
        required: ['intervals', 'plan'],
        properties: {
          intervals: {
            type: 'array',
            minItems: 4,
            maxItems: 4,
            items: { type: 'integer' },
          },
          plan: {
            type: 'array',
            minItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['day', 'action', 'card_ids'],
              properties: {
                day: { type: 'integer', minimum: 1 },
                action: { type: 'string', minLength: 1 },
                card_ids: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
      source_answer_ids: sourceRef,
    },
  },
  coach: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'understanding', 'draft', 'done', 'source_answer_ids'],
    properties: {
      reply: { type: 'string', minLength: 1 },
      understanding: { type: 'string' },
      draft: { type: 'string' },
      done: { type: 'boolean' },
      source_answer_ids: sourceRef,
      evaluation: {
        type: 'object',
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
          metrics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                score: { type: 'integer', minimum: 0, maximum: 100 },
                reason: { type: 'string' },
              },
            },
          },
          weak_points: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export function validateSchema(schemaName, data) {
  const validate = ajv.getSchema(schemaName) || ajv.addSchema(schemas[schemaName], schemaName).getSchema(schemaName);
  const valid = validate(data);
  return valid
    ? { valid: true, errors: [] }
    : { valid: false, errors: validate.errors || [] };
}
