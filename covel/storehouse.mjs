export function proposeStorehouseAppearance(complete, context, instructions) {
  return complete({
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
