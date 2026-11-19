import { requestStoryObject } from './narrator.mjs';

export function proposeStorehouseAppearance(provider, context, instructions) {
  return requestStoryObject(provider, {
    name: 'harbinger_storehouse',
    instructions,
    context,
    schema: {
      type: 'object',
      properties: {
        porterName: { type: 'string', enum: context.porterNames },
        sign: { type: 'string', enum: context.signs },
      },
      required: ['porterName', 'sign'],
      additionalProperties: false,
    },
  });
}
