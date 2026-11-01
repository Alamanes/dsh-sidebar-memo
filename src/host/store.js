// dsh-sidebar-memo — the store behind the panel. One todo list, one Markdown
// page per day, and the notebook target the user picked for uploads.
//
// A todo is not one line: it carries a title, a free-form note (where long
// briefs like "材料：… / 流程：…" actually go) and a short list of steps. Older
// entries that packed everything into the text field are lifted into that shape
// on load, so nothing written before this exists as a wall of text.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const TITLE_MAX = 200
const NOTE_MAX = 8_000
const STEP_MAX = 30
const STEP_TEXT_MAX = 200
const DIARY_TEXT_MAX = 200_000

export function today() {
  return new Date().toLocaleDateString('en-CA')
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00')
  return !Number.isNaN(date.getTime()) && date.toLocaleDateString('en-CA') === value
}

function newId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

function clip(text, limit) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  return value.length > limit ? value.slice(0, limit) : value
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, STEP_MAX).map((step) => {
    if (typeof step === 'string') return { text: clip(step, STEP_TEXT_MAX), done: false }
    return { text: clip(step?.text, STEP_TEXT_MAX), done: step?.done === true }
  }).filter(step => step.text !== '')
}

/** Lift one stored item into title + note + steps. */
function normalizeTodo(item) {
  const raw = typeof item?.text === 'string' ? item.text.replace(/\r\n?/g, '\n') : ''
  const lines = raw.split('\n')
  const title = clip(lines[0], TITLE_MAX)
  const tail = clip(lines.slice(1).join('\n'), NOTE_MAX)
  const note = typeof item?.note === 'string' && item.note.trim() !== '' ? clip(item.note, NOTE_MAX) : tail
  return {
    id: typeof item?.id === 'string' && item.id !== '' ? item.id : newId(),
    text: title,
    note,
    steps: normalizeSteps(item?.steps),
    done: item?.done === true,
    at: typeof item?.at === 'string' ? item.at : new Date().toISOString(),
    by: item?.by === 'model' ? 'model' : 'user',
  }
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.' + process.pid + '.tmp'
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export function createStore({ root, warn = () => {} }) {
  const todoFile = join(root, 'todos.json')
  const settingsFile = join(root, 'settings.json')
  const diaryDir = join(root, 'diary')

  let activity = { seq: 0, tool: '', op: '', ids: [], date: '', phase: 'idle', at: 0 }
  let todos = null
  let settings = null

  async function loadTodos() {
    if (todos !== null) return todos
    const text = await readText(todoFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: todos.json is not JSON, starting empty')
      }
    }
    const items = Array.isArray(parsed?.items) ? parsed.items : []
    todos = items
      .filter(item => item !== null && typeof item === 'object')
      .map(normalizeTodo)
      .filter(item => item.text !== '')
    return todos
  }

  async function saveTodos(next) {
    todos = next
    const items = next.map((item) => ({
      id: item.id,
      text: item.text,
      note: item.note,
      steps: item.steps,
      done: item.done,
      at: item.at,
      by: item.by,
    }))
    await writeAtomic(todoFile, JSON.stringify({ version: 2, items }, null, 2) + '\n')
    return next
  }

  async function loadSettings() {
    if (settings !== null) return settings
    const text = await readText(settingsFile)
    let parsed = null
    if (text !== null) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        warn('dsh-sidebar-memo: settings.json is not JSON, using defaults')
      }
    }
    settings = {
      provider: parsed?.provider === 'getnote' ? 'getnote' : parsed?.provider === 'notems' ? 'notems' : '',
      id: clip(parsed?.id ?? '', 120),
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
    }
    return settings
  }

  async function diaryDates() {
    let names = []
    try {
      names = await readdir(diaryDir)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      warn('dsh-sidebar-memo: cannot list diary pages: ' + (error?.message ?? error))
      return []
    }
    return names
      .filter(name => name.endsWith('.md'))
      .map(name => name.slice(0, -3))
      .filter(isDate)
      .sort()
      .reverse()
  }

  async function readDiary(date) {
    const text = await readText(join(diaryDir, date + '.md'))
    return text === null ? '' : text
  }

  async function writeDiary(date, text, mode) {
    const next = clip(text, DIARY_TEXT_MAX)
    const current = await readDiary(date)
    const body = mode === 'replace'
      ? next
      : current === '' || next === ''
        ? current + next
        : current + '\n\n' + next
    await writeAtomic(join(diaryDir, date + '.md'), body)
    return body
  }

  async function diaryPage(date) {
    const key = isDate(date) ? date : today()
    return { date: key, text: await readDiary(key) }
  }

  async function state(date) {
    const [items, dates, page, notebook] = await Promise.all([
      loadTodos(),
      diaryDates(),
      diaryPage(date),
      loadSettings(),
    ])
    return {
      todos: items,
      dates,
      diary: page,
      notebook,
      activity: { ...activity },
      today: today(),
    }
  }

  async function addTodo({ text, note = '', steps = [], by = 'user' }) {
    const title = clip(text, TITLE_MAX)
    if (title === '') throw new Error('待办内容不能为空')
    const items = await loadTodos()
    if (items.length >= 500) throw new Error('待办太多了，先清理一些')
    const item = {
      id: newId(),
      text: title,
      note: clip(note, NOTE_MAX),
      steps: normalizeSteps(steps),
      done: false,
      at: new Date().toISOString(),
      by,
    }
    await saveTodos([...items, item])
    return item
  }

  async function setTodoDone(id, done) {
    const items = await loadTodos()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) throw new Error('没有这条待办')
    const next = items.slice()
    next[index] = { ...next[index], done: done === true, at: new Date().toISOString() }
    await saveTodos(next)
    return next[index]
  }

  async function setStepDone(id, stepIndex, done) {
    const items = await loadTodos()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) throw new Error('没有这条待办')
    const item = items[index]
    const at = Number(stepIndex)
    if (!Number.isInteger(at) || at < 0 || at >= item.steps.length) throw new Error('没有这个步骤')
    const steps = item.steps.slice()
    steps[at] = { ...steps[at], done: done === true }
    const next = items.slice()
    next[index] = { ...item, steps }
    await saveTodos(next)
    return next[index]
  }

  async function removeTodo(id) {
    const items = await loadTodos()
    const next = items.filter(item => item.id !== id)
    if (next.length === items.length) throw new Error('没有这条待办')
    await saveTodos(next)
    return id
  }

  async function clearDone() {
    const items = await loadTodos()
    const next = items.filter(item => !item.done)
    await saveTodos(next)
    return items.length - next.length
  }

  async function setNotebook(patch) {
    const current = await loadSettings()
    const provider = patch?.provider === 'getnote' ? 'getnote' : patch?.provider === 'notems' ? 'notems' : ''
    const next = {
      provider,
      id: clip(patch?.id ?? current.id, 120),
      updatedAt: new Date().toISOString(),
    }
    settings = next
    await writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n')
    return next
  }

  async function allDiaryText() {
    const dates = (await diaryDates()).slice().reverse()
    const parts = []
    for (const date of dates) {
      const text = (await readDiary(date)).trim()
      if (text === '') continue
      parts.push('# ' + date + '\n\n' + text)
    }
    return parts.join('\n\n')
  }

  function beginActivity(tool, op) {
    activity = { ...activity, tool, op, phase: 'run', at: Date.now(), ids: [], date: '' }
  }

  function endActivity(tool, op, extra = {}) {
    activity = {
      seq: activity.seq + 1,
      tool,
      op,
      phase: 'done',
      at: Date.now(),
      ids: Array.isArray(extra.ids) ? extra.ids : [],
      date: typeof extra.date === 'string' ? extra.date : '',
    }
  }

  function currentActivity() {
    return { ...activity }
  }

  return {
    root,
    state,
    addTodo,
    setTodoDone,
    setStepDone,
    removeTodo,
    clearDone,
    readDiary,
    writeDiary,
    diaryDates,
    diaryPage,
    setNotebook,
    allDiaryText,
    beginActivity,
    endActivity,
    currentActivity,
  }
}
