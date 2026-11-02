// One-off model calls for the diary page and the goal critique: the same route
// the conversation uses, streamed through the host's llm service, assembled by
// hand because a plugin does not import the harness packages.
//
// A bookkeeping call should not pay for deliberation, so the effort starts at the
// lowest the model offers (efforts[0]). A model that answers nothing at that
// level — a thinking-only reply, or an adapter that accepts the effort and then
// emits no text — is asked again at the session level and then at the provider
// default, and the working level is kept for the rest of the process.

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

/** The host reports a finish reason as a string in older builds and as
 *  `{ kind }` in newer ones; both spellings reach the same comparisons. */
function finishKind(reason) {
  if (typeof reason === 'string') return reason
  if (reason !== null && typeof reason === 'object') {
    if (typeof reason.kind === 'string') return reason.kind
    if (typeof reason.type === 'string') return reason.type
  }
  return ''
}

/** Set once the lowest level has answered nothing; later calls skip straight
 *  to the provider default instead of paying for another empty round. */
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
  const effort = effortBroken ? undefined : await leastEffort(llm, route)

  /** One try at one effort, with a second budget when thinking eats the first. */
  const attempt = async (reasoningEffort) => {
    const budgets = [maxTokens, Math.min(maxTokens * 2, 16_384)]
    for (const budget of budgets) {
      let reply = ''
      let finish = ''
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
        else if (chunk?.type === 'finish') {
          finish = finishKind(chunk.reason)
          failure = chunk.failure
        }
      }
      if (finish === 'error' || finish === 'aborted') {
        throw new Error(String(failure?.message ?? failure ?? finish))
      }
      const trimmed = reply.trim()
      if (trimmed !== '') return { text: trimmed, finish: finish || 'stop' }
      if (finish === 'max-tokens') {
        warn('dsh-sidebar-memo: the model used its whole output budget; retrying once with room')
        continue
      }
      return { text: '', finish: finish || 'no-finish' }
    }
    return { text: '', finish: 'max-tokens' }
  }

  const first = await attempt(effort)
  if (first.text !== '') return first.text

  warn('dsh-sidebar-memo: effort "' + String(effort) + '" produced no text (' + first.finish + ')')
  effortBroken = true
  const retryEffort = effort === route.reasoningEffort ? undefined : route.reasoningEffort
  if (retryEffort === effort) throw new Error('模型这次没有输出内容（' + first.finish + '）')
  const second = await attempt(retryEffort)
  if (second.text !== '') return second.text
  throw new Error('模型这次没有输出内容（' + second.finish + '）')
}
