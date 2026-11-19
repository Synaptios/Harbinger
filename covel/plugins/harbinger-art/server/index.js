function itemsFrom(rows) {
  return rows.flatMap(({ value }) => value.items);
}

export default function register(covel) {
  covel.provideExtension('ui.slot@1', 'backdrop', {
    async handler({ previous }, ctx) {
      if (previous?.ref) return previous;
      const stage = await ctx.pluginData.get('stage', 'current');
      if (!stage?.place) return previous;
      const { id, label } = stage.place;
      const subject = itemsFrom(await ctx.pluginData.list('display')).find(item => item.id === id && item.ref);
      return {
        ...previous,
        sceneId: previous?.sceneId ?? id,
        name: previous?.name ?? label,
        ...(subject ? { ref: subject.ref } : {}),
      };
    },
  });
  covel.provideExtension('ui.slot@1', 'cast', {
    async handler({ previous }, ctx) {
      if (previous?.actors.length) return previous;
      const stage = await ctx.pluginData.get('stage', 'current');
      if (!stage) return previous;
      return {
        actors: stage.cast.map(({ id, label }, index) => ({
          characterId: id.slice('portrait:'.length),
          displayName: label,
          active: index === 0,
        })),
        retainWhenEmpty: false,
      };
    },
  });
  covel.provideExtension('ui.slot@1', 'portraits', {
    async handler({ previous }, ctx) {
      const catalogue = new Map((previous?.characters ?? []).map(item => [item.characterId, item]));
      for (const { id, kind, label, ref } of itemsFrom(await ctx.pluginData.list('display'))) {
        if (kind !== 'portrait' || !ref) continue;
        const characterId = id.slice('portrait:'.length);
        const authored = catalogue.get(characterId);
        catalogue.set(characterId, { characterId, displayName: label, avatar: ref, sprite: ref, ...authored });
      }
      return { characters: [...catalogue.values()] };
    },
  });
}
