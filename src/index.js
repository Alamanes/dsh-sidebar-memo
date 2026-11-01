// dsh-sidebar-memo — host half.
//
// The store (host/store.js) owns the files, the two tools (host/tools.js) are
// what the model writes with, the notepad upload (host/notebook.js) is what only
// the panel may call, and this file wires them to the harness: one short prompt
// section, two tools, and the panel's routes under api/dsh-memo.
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore, isDate, today } from './host/store.js'
import { createTools } from './host/tools.js'
import { NOTEBOOKS, cleanPadId, uploadDiary } from './host/notebook.js'

const ROUTE_BASE = '/api/dsh-memo'
/** The panel stylesheet ships as a real file and is served to the browser half. */
const STYLE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'memo.css')
/** The round mark the guide capsule and the tab title show. */
const AVATAR_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'avatar.png')

const MEMO_SECTION = [
  '## 备忘录',
  '右侧边栏的「备忘录」放着用户的待办清单和每日日记，两个工具读写它：memo 管待办，diary 管日记。',
  '用户说要记的事，直接写进去，不用再问一遍。日记只留在本地；上传到 note.ms / getnote.top 由用户在界面上自己点，你不主动上传，也不提议代劳。',
].join('\n')

function writeJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2_000_000) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export function apply(ctx, config) {
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataDir = config?.dataDir ?? join(dshHome, 'storages', 'dsh-memo')
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch { /* no logger */ }
  }

  const store = createStore({ root: dataDir, warn })
  const tools = createTools({ store })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.effect(() => scope.systemPrompt.section({
      name: 'sidebar-memo',
      order: 646,
      text: () => MEMO_SECTION,
    }), 'dsh-sidebar-memo: prompt section')
  })

  ctx.inject(['tools'], (scope) => {
    scope.effect(() => {
      const disposers = tools.map(tool => scope.tools.register(tool)).filter(dispose => typeof dispose === 'function')
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-sidebar-memo: tools')
  })

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const post = (path, run) => ({
        kind: 'exact',
        path: ROUTE_BASE + path,
        handler: (req, res) => {
          void (async () => {
            try {
              if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'POST only' })
              const body = await readJsonBody(req)
              writeJson(res, 200, { ok: true, ...(await run(body)) })
            } catch (error) {
              writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
        },
      })

      const routes = [
        {
          kind: 'exact',
          path: ROUTE_BASE + '/style',
          handler: (req, res) => {
            void (async () => {
              try {
                const css = await readFile(STYLE_FILE, 'utf8')
                res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' })
                res.end(css)
              } catch (error) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('/* dsh-sidebar-memo: stylesheet missing */')
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/avatar',
          handler: (req, res) => {
            void (async () => {
              try {
                const png = await readFile(AVATAR_FILE)
                res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
                res.end(png)
              } catch (error) {
                res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('no avatar')
              }
            })()
          },
        },
        {
          kind: 'exact',
          path: ROUTE_BASE + '/state',
          handler: (req, res) => {
            void (async () => {
              try {
                const url = new URL(req.url ?? '/', 'http://x')
                const date = url.searchParams.get('date') ?? ''
                writeJson(res, 200, { ok: true, ...(await store.state(isDate(date) ? date : today())) })
              } catch (error) {
                writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
              }
            })()
          },
        },
        post('/todo', async (body) => {
          const op = String(body?.op ?? '')
          if (op === 'add') {
            const item = await store.addTodo({ text: body?.text, note: body?.note, steps: body?.steps, by: 'user' })
            return { item, ...(await store.state(body?.date)) }
          }
          if (op === 'toggle') {
            await store.setTodoDone(String(body?.id ?? ''), body?.done === true)
            return { ...(await store.state(body?.date)) }
          }
          if (op === 'step') {
            await store.setStepDone(String(body?.id ?? ''), body?.index, body?.done === true)
            return { ...(await store.state(body?.date)) }
          }
          if (op === 'del') {
            await store.removeTodo(String(body?.id ?? ''))
            return { ...(await store.state(body?.date)) }
          }
          if (op === 'clear') {
            await store.clearDone()
            return { ...(await store.state(body?.date)) }
          }
          throw new Error('未知的待办操作：' + op)
        }),
        post('/diary', async (body) => {
          const date = isDate(body?.date) ? body.date : today()
          await store.writeDiary(date, body?.text, 'replace')
          return { ...(await store.state(date)) }
        }),
        post('/notebook', async (body) => {
          const id = cleanPadId(body?.id)
          await store.setNotebook({ provider: body?.provider, id })
          return { notebook: await store.state().then(state => state.notebook) }
        }),
        post('/upload', async () => {
          const state = await store.state()
          const { provider, id } = state.notebook
          if (provider === '' || id === '') throw new Error('先选好在线记事本并填上 ID')
          const text = await store.allDiaryText()
          if (text === '') throw new Error('日记本还是空的，没有可上传的内容')
          const result = await uploadDiary({ provider, id, text })
          return { upload: { ...result, provider, id, label: NOTEBOOKS[provider].label } }
        }),
      ]

      const disposers = routes.map(route => scope.webServer.register(route))
      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose()
      }
    }, 'dsh-sidebar-memo: routes')
  })

  ctx.logger?.info?.('dsh-sidebar-memo: memo at ' + dataDir)
}
