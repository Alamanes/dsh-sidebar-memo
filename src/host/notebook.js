// dsh-sidebar-memo — the only place that talks to the open internet. Uploads
// happen because the user pressed the button, never because the model felt like
// it; the host exposes no tool for this on purpose.
//
// Both notepads take a form post to the page itself:
//   note.ms     POST /<id>   body "&t=<text>"
//   getnote.top POST /<id>   body "text=<text>"
// The page is also the read side: the saved text sits in the textarea markup.

/** Notepad services the panel can upload to. */
export const NOTEBOOKS = {
  notems: { label: 'note.ms', origin: 'https://note.ms', field: '&t', type: 'application/x-www-form-urlencoded' },
  getnote: { label: 'getnote.top', origin: 'https://getnote.top', field: 'text', type: 'application/x-www-form-urlencoded; charset=UTF-8' },
}

/** A pad id is a path segment: letters, digits, dash, underscore, dot. */
export function cleanPadId(value) {
  const id = String(value ?? '').trim()
  if (id === '') return ''
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id)) throw new Error('记事本 ID 只能包含字母、数字、点、横线和下划线')
  return id
}

/** The page address a pad lives at. */
export function notebookUrl(provider, id) {
  const service = NOTEBOOKS[provider]
  if (service === undefined) throw new Error('还没有选择在线记事本')
  const pad = cleanPadId(id)
  if (pad === '') throw new Error('还没有填写记事本 ID')
  return service.origin + '/' + pad
}

/**
 * Replace the pad's whole content with the diary.
 * @param params.provider - 'notems' or 'getnote'.
 * @param params.id - the pad id.
 * @param params.text - the full document to upload.
 * @returns the pad address and the uploaded size.
 */
export async function uploadDiary({ provider, id, text }) {
  const service = NOTEBOOKS[provider]
  const url = notebookUrl(provider, id)
  const body = service.field === '&t'
    ? '&t=' + encodeURIComponent(String(text ?? ''))
    : 'text=' + encodeURIComponent(String(text ?? ''))
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': service.type },
      body,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    throw new Error('上传失败：' + (error?.message ?? String(error)))
  }
  if (!response.ok) throw new Error('上传失败：' + service.label + ' 返回 ' + response.status)
  return { url, bytes: Buffer.byteLength(String(text ?? ''), 'utf8'), at: new Date().toISOString() }
}

/** Read the pad back, for the panel's "看看线上" affordance. */
export async function readDiaryPad({ provider, id }) {
  const url = notebookUrl(provider, id)
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('读取失败：' + response.status)
  const html = await response.text()
  const match = provider === 'getnote'
    ? /<textarea[^>]*id="content"[^>]*>([\s\S]*?)<\/textarea>/i.exec(html)
    : /<textarea[^>]*class="content"[^>]*>([\s\S]*?)<\/textarea>/i.exec(html)
  if (match === null) return ''
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
