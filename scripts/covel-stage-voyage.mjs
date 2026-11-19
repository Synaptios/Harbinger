import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { configureNativeStory, sectionToml } from '../covel/native-model-config.mjs';
import { resolveStoryRoute } from '../covel/provider-routes.mjs';

const [database, output] = process.argv.slice(2).map(path => resolve(path));
const configuredPath = database && `${database}.llm.toml`;
if (!database || !output || output === configuredPath) {
  throw new Error('Pass a save database and a separate candidate TOML path.');
}

const environment = {
  ...process.env, COVEL_LLM_TOML: '', HARBINGER_MODEL_SETTINGS_PATH: `${database}.model-settings.json`,
};
const baseline = configureNativeStory(database, environment);
if (!baseline.COVEL_LLM_TOML || !baseline.OPENAI_API_KEY || !baseline.OPENROUTER_API_KEY || !baseline.INWORLD_API_KEY) {
  throw new Error('Staging Voyage requires the Previous lineup and all three provider credentials.');
}

const [story, state, complex, memory, safety] = await Promise.all(
  ['glm-5.3-flash', 'gemma-4-31b', 'gemini-3-flash', 'mistral-nemo', 'qwen3-14b']
    .map(model => resolveStoryRoute({ model }, environment)),
);

function target({ provider, modelId: model, baseUrl, protocol }, reasoningEffort) {
  return { provider, model, baseUrl, protocol, reasoningEffort };
}

const assignments = {
  story: target(story), character: target(story), state: target(state),
  staging: target(state), 'pacing-director': target(state), 'state-complex': target(complex),
  fast: target(memory), 'harbinger-memory': target(memory),
  'harbinger-safety': target(safety, 'disabled'),
  'harbinger-continuity': { provider: 'openai', model: 'gpt-6.2-sol', reasoningEffort: 'low' },
};

const original = await readFile(baseline.COVEL_LLM_TOML, 'utf8');
const candidate = original.split(/(?=^\[covel\.)/mu).filter(section => {
  const name = /^\[covel\.([\w-]+)\]/u.exec(section)?.[1];
  return !name || !Object.hasOwn(assignments, name);
}).join('').trimEnd();
const updated = Object.entries(assignments).map(([role, config]) => sectionToml(`covel.${role}`, config)).join('\n\n');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${candidate}\n\n${updated}\n`, { mode: 0o600 });
console.log(`Staged ${Object.keys(assignments).length} Voyage role bindings.`);
