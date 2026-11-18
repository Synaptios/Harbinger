import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'

const DEFAULT_GENERATION_MODEL = 'openai/gpt-5-mini'
const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const PROVIDER_URLS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
}
const PROVIDER_NAMES = { openai: 'OpenAI', openrouter: 'OpenRouter' }
const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_EMBEDDING_INPUTS = 128

async function readCredentials(file) {
  let contents
  try {
    contents = (await readFile(file, 'utf8')).trim()
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error('Could not read the credentials file.')
  }

  try {
    return contents.startsWith('{') ? JSON.parse(contents) : parseEnv(contents)
  } catch {
    throw new Error('Could not parse the credentials file.')
  }
}

function apiKey(...values) {
  for (const value of values) {
    if (typeof value === 'string' && /^[!-~]{1,4096}$/.test(value.trim())) {
      return value.trim()
    }
  }
  return undefined
}

function validModelId(model) {
  return typeof model === 'string' && /^[a-z0-9][a-z0-9_.:/-]{0,255}$/i.test(model) && !model.endsWith('/')
}

function modelProvider(model) {
  if (/^openai\//.test(model) || /^(?:gpt-|o\d+(?:-|$)|text-embedding-)[^/]*$/.test(model)) {
    return 'openai'
  }
  return 'openrouter'
}

function selectModel(model) {
  if (!validModelId(model)) throw new Error('A valid model ID is required.')
  const provider = modelProvider(model)
  return { provider, id: provider === 'openai' ? model.replace(/^openai\//, '') : model }
}

function openAIModelKind(id) {
  if (id.startsWith('text-embedding-')) return 'embedding'
  // The OpenAI Models API lists IDs without capabilities.
  if (/^(?:gpt-\d|gpt-chat(?:-|$)|o\d+(?:-|$))/.test(id) &&
      !/-(?:audio|image|instruct|live|realtime|search|transcribe|tts)(?:-|$)/.test(id)) {
    return 'generation'
  }
  return undefined
}

function catalogModels(data, provider, kind) {
  const models = []
  for (const item of data) {
    const { id, name, architecture } = item ?? {}
    if (!validModelId(id)) continue
    if (provider === 'openai') {
      const modelKind = openAIModelKind(id)
      if (modelKind && !id.includes('/')) {
        models.push({ id: `openai/${id}`, label: id, kind: modelKind, provider })
      }
    } else {
      if (modelProvider(id) !== 'openrouter') continue
      const inputTypes = architecture?.input_modalities
      const outputTypes = architecture?.output_modalities
      const output = kind === 'generation' ? 'text' : 'embeddings'
      if (Array.isArray(inputTypes) && !inputTypes.includes('text')) continue
      if (Array.isArray(outputTypes) && !outputTypes.includes(output)) continue
      const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 160) : id
      models.push({ id, label, kind, provider })
    }
  }
  return models
}

function openAIText(payload) {
  if (!Array.isArray(payload?.output) || (payload.status && payload.status !== 'completed')) {
    return ''
  }

  const text = []
  for (const item of payload.output) {
    if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
      continue
    }
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') text.push(part.text)
    }
  }
  return text.join('\n')
}

function embeddingVectors(payload, count, provider) {
  const invalidResponse = `${PROVIDER_NAMES[provider]} returned invalid embeddings.`
  if (!Array.isArray(payload?.data) || payload.data.length !== count) {
    throw new Error(invalidResponse)
  }

  const vectors = new Array(count)
  let dimensions
  for (const item of payload.data) {
    const { index, embedding } = item ?? {}
    if (!Number.isInteger(index) || index < 0 || index >= count || vectors[index] ||
        !Array.isArray(embedding) || !embedding.length || !embedding.every(Number.isFinite) ||
        (dimensions !== undefined && embedding.length !== dimensions)) {
      throw new Error(invalidResponse)
    }
    vectors[index] = embedding
    dimensions = embedding.length
  }
  return vectors
}

async function readProviderJson(response) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body.')

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Response body exceeds the size limit.')
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return JSON.parse(parts.join(''))
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function createProviders({
  env = process.env,
  credentialFile = new URL('.credentials', import.meta.url),
  fetchImpl = fetch,
} = {}) {
  const local = await readCredentials(credentialFile)
  const keys = {
    openai: apiKey(env.OPENAI_API_KEY, env.OPEN_AI_API_KEY, local.OPENAI_API_KEY, local.OPEN_AI_API_KEY),
    openrouter: apiKey(
      env.OPENROUTER_API_KEY,
      env.OPEN_ROUTER_API_KEY,
      local.OPENROUTER_API_KEY,
      local.OPEN_ROUTER_API_KEY,
    ),
  }

  async function request(provider, path, body, signal) {
    const label = PROVIDER_NAMES[provider]
    const key = keys[provider]
    if (!key) throw new Error(`Set an API key for ${label} to use this model.`)

    const json = body === undefined ? undefined : JSON.stringify(body)
    if (json !== undefined && Buffer.byteLength(json) > MAX_REQUEST_BYTES) {
      throw new Error('The provider request is too large.')
    }

    const timeout = AbortSignal.timeout(json === undefined ? 8_000 : 120_000)
    const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
    if (json !== undefined) headers['content-type'] = 'application/json'
    let response
    try {
      response = await fetchImpl(`${PROVIDER_URLS[provider]}${path}`, {
        method: json === undefined ? 'GET' : 'POST',
        headers,
        body: json,
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new Error(`${label} could not be reached.`)
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new Error(`${label} rejected the request (HTTP ${response.status}).`)
    }

    try {
      return await readProviderJson(response)
    } catch {
      throw new Error(`${label} returned an invalid response.`)
    }
  }

  async function generate({ model = DEFAULT_GENERATION_MODEL, prompt, input, signal }) {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Generation instructions are required.')
    let userData
    try {
      userData = JSON.stringify(input)
    } catch {
      throw new Error('Generation input must be serializable as JSON.')
    }
    if (userData === undefined) throw new Error('Generation input must be serializable as JSON.')

    const { provider, id } = selectModel(model)
    let text
    if (provider === 'openai') {
      const payload = await request(provider, '/responses', {
        model: id,
        instructions: prompt,
        input: userData,
        max_output_tokens: 16_384,
        store: false,
      }, signal)
      text = openAIText(payload)
    } else {
      const payload = await request(provider, '/chat/completions', {
        model: id,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userData },
        ],
        max_tokens: 16_384,
      }, signal)
      text = payload?.choices?.[0]?.message?.content
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`${PROVIDER_NAMES[provider]} returned no generation text.`)
    }
    return text
  }

  async function embed({ model = DEFAULT_EMBEDDING_MODEL, texts, signal }) {
    if (!Array.isArray(texts) || texts.length > MAX_EMBEDDING_INPUTS) {
      throw new Error(`Send up to ${MAX_EMBEDDING_INPUTS} texts per embedding request.`)
    }
    for (const text of texts) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('Embedding input must contain nonempty text.')
    }
    if (!texts.length) return []

    const { provider, id } = selectModel(model)
    const payload = await request(provider, '/embeddings', {
      model: id,
      input: texts,
      encoding_format: 'float',
    }, signal)
    return embeddingVectors(payload, texts.length, provider)
  }

  async function catalog({ signal } = {}) {
    const providers = { openai: Boolean(keys.openai), openrouter: Boolean(keys.openrouter) }
    const defaults = [
      { id: DEFAULT_GENERATION_MODEL, label: 'GPT-5 Mini', kind: 'generation', provider: 'openai' },
      { id: DEFAULT_EMBEDDING_MODEL, label: 'Text Embedding 3 Small', kind: 'embedding', provider: 'openai' },
    ]
    const endpoints = [
      { provider: 'openai', path: '/models', label: 'OpenAI model catalog' },
      { provider: 'openrouter', path: '/models', kind: 'generation', label: 'OpenRouter generation catalog' },
      { provider: 'openrouter', path: '/embeddings/models', kind: 'embedding', label: 'OpenRouter embedding catalog' },
    ]
    const configuredEndpoints = endpoints.filter(({ provider }) => providers[provider])
    const results = await Promise.allSettled(configuredEndpoints.map(async ({ provider, path, kind }) => {
      const payload = await request(provider, path, undefined, signal)
      if (!Array.isArray(payload?.data)) throw new Error('Invalid model list.')
      return catalogModels(payload.data, provider, kind)
    }))

    const models = new Map()
    for (const model of defaults) models.set(`${model.kind}:${model.id}`, model)
    const errors = []
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        errors.push(`${configuredEndpoints[index].label} could not be loaded.`)
        continue
      }
      for (const model of result.value) {
        const key = `${model.kind}:${model.id}`
        if (!models.has(key)) models.set(key, model)
      }
    }
    return { models: [...models.values()], providers, ...(errors.length ? { errors } : {}) }
  }

  return { generate, embed, catalog }
}
