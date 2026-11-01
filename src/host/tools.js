// The two tools the model uses on the memo panel. Both schemas stay small on
// purpose: every property is characters of context in every single turn.
//
// A todo is a title plus a note plus steps, and the schema says so plainly, so a
// long brief lands in the note instead of being crammed into the title.
import { isDate, today } from './store.js'

const READ_PAGES = 3
const PAGE_CHARS = 1600
const NOTE_LINES = 6
const NOTE_CHARS = 420

function notePreview(note) {
  const lines = String(note ?? '').split('\n').filter(line => line.trim() !== '')
  const shown = lines.slice(0, NOTE_LINES).map(line => '     ' + line).join('\n')
  return lines.length > NOTE_LINES ? shown + '\n     …还有 ' + (lines.length - NOTE_LINES) + ' 行' : shown
}

function itemLines(item) {
  const head = '- ' + item.text + '  (' + item.id + ')'
  const out = [head]
  const note = String(item.note ?? '').trim()
  if (note !== '') {
    const trimmed = note.length > NOTE_CHARS ? note.slice(0, NOTE_CHARS) + '…' : note
    out.push('  备注：\n' + notePreview(trimmed))
  }
  if (item.steps.length > 0) {
    const doneCount = item.steps.filter(step => step.done).length
    out.push('  步骤（' + doneCount + '/' + item.steps.length + '）：')
    for (const step of item.steps) out.push('    ' + (step.done ? '[x]' : '[ ]') + ' ' + step.text)
  }
  return out.join('\n')
}

function describe(item) {
  const bits = []
  if (String(item.note ?? '').trim() !== '') bits.push('备注 ' + String(item.note).split('\n').filter(line => line.trim() !== '').length + ' 行')
  if (item.steps.length > 0) bits.push(item.steps.length + ' 个步骤')
  return bits.length === 0 ? '' : '（' + bits.join('，') + '）'
}

/**
 * Build the tool definitions around one store.
 * @param params.store - the memo store.
 */
export function createTools({ store }) {
  const memo = {
    name: 'memo',
    description: 'Read or change the sidebar memo list. A todo is a one-line title plus an optional note (materials, links, conditions, a procedure) and optional checklist steps. op=read lists them with ids; add appends one; done ticks one off; del removes one; clear drops the finished ones.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['read', 'add', 'done', 'del', 'clear'], description: 'What to do.' },
        text: { type: 'string', description: 'The one-line title, for op=add.' },
        note: { type: 'string', description: 'Detail for op=add: several lines allowed, one fact per line. Put the long material here, not in the title.' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Checklist items for op=add, one short line each.' },
        id: { type: 'string', description: 'The item id from op=read, for done or del.' },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const op = String(args?.op ?? '').trim()
      store.beginActivity('memo', op)
      try {
        if (op === 'read') {
          const items = (await store.state()).todos
          store.endActivity('memo', 'read')
          if (items.length === 0) return '待办清单是空的。'
          const open = items.filter(item => !item.done).length
          return '待办（' + items.length + ' 项，' + open + ' 项未完成）：\n' + items
            .map(item => '- ' + (item.done ? '[x] ' : '[ ] ') + itemLines(item).slice(2))
            .join('\n')
        }
        if (op === 'add') {
          const item = await store.addTodo({ text: args?.text, note: args?.note, steps: args?.steps, by: 'model' })
          store.endActivity('memo', 'add', { ids: [item.id] })
          return '加进待办：' + item.text + '  (' + item.id + ')' + describe(item)
        }
        if (op === 'done') {
          const item = await store.setTodoDone(String(args?.id ?? ''), true)
          store.endActivity('memo', 'done', { ids: [item.id] })
          return '已完成：' + item.text
        }
        if (op === 'del') {
          const id = String(args?.id ?? '')
          const items = (await store.state()).todos
          const target = items.find(item => item.id === id || item.text === id)
          if (target === undefined) throw new Error('没有这条待办：' + id)
          await store.removeTodo(target.id)
          store.endActivity('memo', 'del', { ids: [target.id] })
          return '删掉：' + target.text
        }
        if (op === 'clear') {
          const removed = await store.clearDone()
          store.endActivity('memo', 'clear')
          return '清掉了 ' + removed + ' 条已完成的待办。'
        }
        throw new Error('op 只能是 read、add、done、del、clear')
      } catch (error) {
        store.endActivity('memo', 'error')
        throw error
      }
    },
  }

  const diary = {
    name: 'diary',
    description: 'Read or write the sidebar diary, one Markdown page per day. op=read returns a page (today, or the newest pages when date is omitted); op=write appends to that day, or replaces it with mode=replace. The user uploads the diary themselves; never upload it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['read', 'write'], description: 'What to do.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for today, or for the newest page on read.' },
        text: { type: 'string', description: 'Markdown to append or replace, for op=write.' },
        mode: { type: 'string', enum: ['append', 'replace'], description: 'Default append.' },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const op = String(args?.op ?? '').trim()
      store.beginActivity('diary', op)
      try {
        if (op === 'read') {
          const wanted = String(args?.date ?? '').trim()
          if (wanted !== '') {
            if (!isDate(wanted)) throw new Error('日期要写成 YYYY-MM-DD')
            const text = await store.readDiary(wanted)
            store.endActivity('diary', 'read', { date: wanted })
            return text.trim() === '' ? wanted + ' 的日记还是空的。' : wanted + ' 的日记：\n\n' + text.trim().slice(0, PAGE_CHARS)
          }
          const dates = (await store.diaryDates()).slice(0, READ_PAGES)
          store.endActivity('diary', 'read')
          if (dates.length === 0) return '日记本还是空的。'
          const parts = []
          for (const date of dates) {
            const text = (await store.readDiary(date)).trim()
            if (text !== '') parts.push('## ' + date + '\n\n' + text.slice(0, PAGE_CHARS))
          }
          return parts.join('\n\n')
        }
        if (op === 'write') {
          const date = String(args?.date ?? '').trim() === '' ? today() : String(args.date).trim()
          if (!isDate(date)) throw new Error('日期要写成 YYYY-MM-DD')
          const mode = args?.mode === 'replace' ? 'replace' : 'append'
          const body = await store.writeDiary(date, args?.text, mode)
          store.endActivity('diary', mode === 'replace' ? 'rewrite' : 'write', { date })
          return '写进 ' + date + ' 的日记了，这一页现在 ' + body.length + ' 字。'
        }
        throw new Error('op 只能是 read 或 write')
      } catch (error) {
        store.endActivity('diary', 'error')
        throw error
      }
    },
  }

  return [memo, diary]
}
