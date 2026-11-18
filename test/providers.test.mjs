import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createProviders } from '../providers.mjs'

async function credentials(t, contents = '') {
  const directory = await mkdtemp(join(tmpdir(), 'harbinger-providers-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, '.credentials')
  await writeFile(file, contents)
  return file
}

test('sends the default generation request to OpenAI with separate instructions and user data', async (t) => {
  const requests = []
  const providers = await createProviders({
    env: { OPENAI_API_KEY: 'test-direct', OPENROUTER_API_KEY: 'test-router' },
    credentialFile: await credentials(t),
    fetchImpl: async (url, options) => {
      requests.push(new Request(url, options))
      return Response.json({
        status: 'completed',
        output: [
          { type: 'reasoning', summary: [] },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'A light in the distance.' }],
          },
        ],
      })
    },
  })

  const text = await providers.generate({
    prompt: 'Narrate the scene.',
    input: { scene: 'the docks', action: 'look north' },
  })

  assert.equal(text, 'A light in the distance.')
  const [request] = requests
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.get('authorization'), 'Bearer test-direct')
  const body = await request.json()
  assert.equal(body.model, 'gpt-5-mini')
  assert.equal(body.instructions, 'Narrate the scene.')
  assert.deepEqual(JSON.parse(body.input), { scene: 'the docks', action: 'look north' })
})

test('routes a third-party generation model to OpenRouter and honors the environment alias over the file', async (t) => {
  const requests = []
  const providers = await createProviders({
    env: { OPEN_AI_API_KEY: 'test-direct', OPEN_ROUTER_API_KEY: 'test-router-env' },
    credentialFile: await credentials(t, 'OPENROUTER_API_KEY="test-router-file" # local default\n'),
    fetchImpl: async (url, options) => {
      requests.push(new Request(url, options))
      return Response.json({ choices: [{ message: { content: 'A storm is coming.' } }] })
    },
  })

  const text = await providers.generate({
    model: 'anthropic/claude-sonnet-4.6',
    prompt: 'Describe the weather.',
    input: { location: 'the docks' },
  })

  assert.equal(text, 'A storm is coming.')
  const [request] = requests
  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(request.headers.get('authorization'), 'Bearer test-router-env')
  const body = await request.json()
  assert.equal(body.model, 'anthropic/claude-sonnet-4.6')
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Describe the weather.' },
    { role: 'user', content: '{"location":"the docks"}' },
  ])
})

test('uses the default OpenAI embedding model and returns vectors in input order', async (t) => {
  const requests = []
  const providers = await createProviders({
    env: {},
    credentialFile: await credentials(t, '# Local configuration\nOPEN_AI_API_KEY="test-local"\n'),
    fetchImpl: async (url, options) => {
      requests.push(new Request(url, options))
      return Response.json({
        data: [
          { index: 1, embedding: [0.4, -0.5] },
          { index: 0, embedding: [0.9, 0.2] },
        ],
      })
    },
  })

  const vectors = await providers.embed({ texts: ['the pier', 'the ship'] })

  assert.deepEqual(vectors, [[0.9, 0.2], [0.4, -0.5]])
  const [request] = requests
  assert.equal(request.url, 'https://api.openai.com/v1/embeddings')
  assert.equal(request.headers.get('authorization'), 'Bearer test-local')
  assert.deepEqual(await request.json(), {
    model: 'text-embedding-3-small',
    input: ['the pier', 'the ship'],
    encoding_format: 'float',
  })
})

test('lists usable generation and embedding models from their respective catalogs', async (t) => {
  const requests = new Map()
  const providers = await createProviders({
    env: {},
    credentialFile: await credentials(t, JSON.stringify({
      OPENAI_API_KEY: 'test-direct-json',
      OPEN_ROUTER_API_KEY: 'test-router-json',
    })),
    fetchImpl: async (url, options) => {
      const request = new Request(url, options)
      requests.set(request.url, request)
      if (url === 'https://api.openai.com/v1/models') {
        return Response.json({
          data: [
            { id: 'gpt-5-mini' },
            { id: 'o3-mini' },
            { id: 'gpt-image-1' },
            { id: 'gpt-4o-mini-transcribe' },
            { id: 'text-embedding-3-large' },
          ],
        })
      }
      if (url === 'https://openrouter.ai/api/v1/models') {
        return Response.json({
          data: [
            {
              id: 'anthropic/claude-sonnet-4.6',
              name: 'Anthropic: Claude Sonnet 4.6',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            },
            {
              id: 'openai/gpt-5-mini',
              name: 'Duplicate GPT-5 Mini',
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            },
            {
              id: 'example/image-model',
              name: 'Example Image Model',
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
          ],
        })
      }
      if (url === 'https://openrouter.ai/api/v1/embeddings/models') {
        return Response.json({
          data: [
            {
              id: 'qwen/qwen3-embedding-8b',
              name: 'Qwen: Qwen3 Embedding 8B',
              architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] },
            },
          ],
        })
      }
      throw new Error('Unexpected endpoint')
    },
  })

  const catalog = await providers.catalog()

  assert.deepEqual(catalog.providers, { openai: true, openrouter: true })
  assert.deepEqual(
    catalog.models.map(({ id, kind, provider }) => [id, kind, provider]).sort(),
    [
      ['anthropic/claude-sonnet-4.6', 'generation', 'openrouter'],
      ['openai/gpt-5-mini', 'generation', 'openai'],
      ['openai/o3-mini', 'generation', 'openai'],
      ['openai/text-embedding-3-large', 'embedding', 'openai'],
      ['openai/text-embedding-3-small', 'embedding', 'openai'],
      ['qwen/qwen3-embedding-8b', 'embedding', 'openrouter'],
    ],
  )
  assert.equal(
    catalog.models.find((model) => model.id === 'anthropic/claude-sonnet-4.6').label,
    'Anthropic: Claude Sonnet 4.6',
  )
  for (const [url, authorization] of [
    ['https://api.openai.com/v1/models', 'Bearer test-direct-json'],
    ['https://openrouter.ai/api/v1/models', 'Bearer test-router-json'],
    ['https://openrouter.ai/api/v1/embeddings/models', 'Bearer test-router-json'],
  ]) {
    const request = requests.get(url)
    assert.equal(request.method, 'GET')
    assert.equal(request.headers.get('authorization'), authorization)
  }
})

test('rejects an oversized upstream response with a generic error', async (t) => {
  const providers = await createProviders({
    env: { OPENAI_API_KEY: 'test-direct' },
    credentialFile: await credentials(t),
    fetchImpl: async () => Response.json({
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'x'.repeat(17 * 1024 * 1024) }],
        },
      ],
    }),
  })

  await assert.rejects(
    providers.generate({ prompt: 'Describe the scene.', input: { scene: 'the docks' } }),
    { message: 'OpenAI returned an invalid response.' },
  )
})

test('keeps stage defaults and usable catalogs when another provider fails', async (t) => {
  const providers = await createProviders({
    env: { OPENAI_API_KEY: 'test-direct', OPENROUTER_API_KEY: 'test-router' },
    credentialFile: await credentials(t),
    fetchImpl: async (url) => {
      if (url === 'https://api.openai.com/v1/models') {
        return Response.json({ error: { message: 'Upstream echoed test-direct' } }, { status: 401 })
      }
      if (url === 'https://openrouter.ai/api/v1/models') {
        return Response.json({ data: [{ id: 'anthropic/claude-sonnet-4.6' }] })
      }
      throw new Error('Upstream connection failed with test-router')
    },
  })

  const catalog = await providers.catalog()

  assert.deepEqual(catalog.models.map(({ id }) => id), [
    'openai/gpt-5-mini',
    'openai/text-embedding-3-small',
    'anthropic/claude-sonnet-4.6',
  ])
  assert.deepEqual(catalog.errors, [
    'OpenAI model catalog could not be loaded.',
    'OpenRouter embedding catalog could not be loaded.',
  ])
})

test('sends a third-party embedding request to OpenRouter and rejects duplicate indices', async (t) => {
  const requests = []
  const providers = await createProviders({
    env: { OPENAI_API_KEY: 'test-direct', OPENROUTER_API_KEY: 'test-router' },
    credentialFile: await credentials(t),
    fetchImpl: async (url, options) => {
      requests.push(new Request(url, options))
      return Response.json({
        data: [
          { index: 0, embedding: [0.2, 0.3] },
          { index: 0, embedding: [0.1, 0.7] },
        ],
      })
    },
  })

  await assert.rejects(
    providers.embed({ model: 'qwen/qwen3-embedding-8b', texts: ['the pier', 'the ship'] }),
    { message: 'OpenRouter returned invalid embeddings.' },
  )
  const [request] = requests
  assert.equal(request.url, 'https://openrouter.ai/api/v1/embeddings')
  assert.equal(request.headers.get('authorization'), 'Bearer test-router')
  assert.deepEqual(await request.json(), {
    model: 'qwen/qwen3-embedding-8b',
    input: ['the pier', 'the ship'],
    encoding_format: 'float',
  })
})
