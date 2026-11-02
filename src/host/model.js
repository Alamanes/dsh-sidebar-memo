// One-off model calls for the diary page and the goal critique: the same route
// the conversation uses, streamed through the host's llm service, assembled by
// hand because a plugin does not import the harness packages.
//
// A bookkeeping call should not pay for deliberation, so the effort is the
// lowest the model offers (efforts[0]); a model that rejects it falls back to the
// session's own choice for the rest of the process.

const CALL_TIMEOUT_MS = 120_000

/**
 * The provider and model a request should use: the agent's current choice, else
 * the first provider that declares a model.
 * @param ctx - host plugin context.
 * @returns {provider, model, reasoningEffort?}
 */
export function routeOf(ctx) {
  let selection
  try {
    selection = ctx.get('agentDefaultModel', false)?.currentSelection?.()
  } catch {
    selection = undefined
  }
  if (selection !== undefined && selection !== null && typeof selection.provider === 'string' && typeof selection.model === 'string') {
    return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
  }
  const llm = ctx.get('llm', false)
  const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : []
  const first = providers.find(entry => Array.isArray(entry?.models) && entry.models.length > 0)
  if (first !== undefined) return { provider: first.id ?? first.provider, model: first.models[0] }
  throw new Error('No model is available: add one in Harness settings.')
}

let effortBroken = false

async function leastEffort(llm, route) {
  try {
    const info = await llm.resolveModelInfo?.({ provider: route.provider, model: route.model })
    const efforts = info?.reasoning?.efforts
    if (Array.isArray(efforts) && efforts.length > 0 && typeof efforts[0]?.id === 'string') return efforts[0].id
  } catch { /* older host: fall through to the literal */ }
  return 'off'
}

/**
 * Ask the model once and return its text.
 * @param ctx - host plugin context.
 * @param params.system - the system prompt.
 * @param params.text - the single user message.
 * @param params.maxTokens - the first output budget.
 * @param params.warn - logger for the discarded-reply case.
 */
export async function askOnce(ctx, { system, text, maxTokens = 4_096, warn = () => {} }) {
  const llm = ctx.get('llm', false)
  if (llm === undefined || typeof llm.stream !== 'function') throw new Error('The llm service is not available.')
  const route = routeOf(ctx)
  const effort = effortBroken ? route.reasoningEffort : await leastEffort(llm, route)

  const attempt = async (reasoningEffort) => {
    const budgets = [maxTokens, Math.min(maxTokens * 2, 16_384)]
    for (const budget of budgets) {
      let reply = ''
      let finish
      let failure
      const options = {
        provider: route.provider,
        model: route.model,
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        maxTokens: budget,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      }
      if (typeof reasoningEffort === 'string') options.reasoningEffort = reasoningEffort
      for await (const chunk of llm.stream(options)) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') reply += chunk.text
        else if (chunk?.type === 'finish') { finish = chunk.reason; failure = chunk.failure }
      }
      if (finish === 'error' || finish === 'aborted') throw new Error(failure?.message ?? String(finish))
      const trimmed = reply.trim()
      if (finish !== 'max-tokens' && trimmed !== '') return trimmed
      if (finish !== 'max-tokens') throw new Error('模型这次没有输出内容')
      warn('dsh-sidebar-memo: the model used its whole output budget; retrying once with room')
    }
    throw new Error('The model used up the output budget and wrote no complete answer.')
  }

  try {
    return await attempt(effort)
  } catch (error) {
    const message = String(error?.message ?? '')
    const worthRetrying = effort !== route.reasoningEffort && /reasoning|effort|没有输出内容/i.test(message)
    if (!worthRetrying) throw error
    effortBroken = true
    warn('dsh-sidebar-memo: effort "' + effort + '" produced nothing, retrying with the session default')
    return attempt(route.reasoningEffort)
  }
}
