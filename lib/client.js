/**
 * dsh-sidebar-memo browser half.
 *
 * A right-sidebar tab type of its own, registered into the same tab registry the
 * shipped three use, so the capsule, the icon slot and the pick animation match
 * them by construction.
 *
 * Two pages. The list is the same entry-shaped todo column as before. The goal
 * page holds a goal card — sentence, deadline, log, critique — and the diary
 * underneath it: she says what happened, the model writes the page, the panel
 * only reads it back. The critique and the page are both written by the host
 * half on a one-shot call with the least reasoning the model offers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-memo',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const ID = 'dsh-sidebar-memo'
    const KIND = 'memo'
    const ROUTE = 'api/dsh-memo'
    const POLL_MS = 900
    const NOTICE_MS = 3200

    const MOODS = [
      { id: 'sharp', label: '毒舌', hint: '刻薄挖苦，只针对进度' },
      { id: 'gentle', label: '温柔', hint: '先接住，再轻推' },
      { id: 'plain', label: '机械', hint: '只报事实与偏差' },
      { id: 'custom', label: '自定义', hint: '按你写的口吻' },
    ]

    let styleJob = null
    function ensureStyle() {
      if (document.getElementById('dshm-style') !== null) return
      if (styleJob !== null) return
      styleJob = fetch(ROUTE + '/style')
        .then((response) => (response.ok ? response.text() : ''))
        .then((text) => {
          if (text === '' || document.getElementById('dshm-style') !== null) return
          const style = document.createElement('style')
          style.id = 'dshm-style'
          style.textContent = text
          document.head.appendChild(style)
        })
        .catch(() => { styleJob = null })
    }

    function call(path, options) {
      return fetch(ROUTE + path, { headers: { 'content-type': 'application/json' }, ...options })
        .then((response) => response.json())
        .then((value) => {
          if (value === null || typeof value !== 'object' || value.ok !== true) {
            throw new Error(value?.error ?? '请求失败')
          }
          return value
        })
    }

    function iso(date) {
      return date.toLocaleDateString('en-CA')
    }

    function shift(dateKey, days) {
      const date = new Date(dateKey + 'T12:00:00')
      date.setDate(date.getDate() + days)
      return iso(date)
    }

    const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

    function label(dateKey) {
      const date = new Date(dateKey + 'T12:00:00')
      if (Number.isNaN(date.getTime())) return dateKey
      return (date.getMonth() + 1) + '月' + date.getDate() + '日'
    }

    function stamp(value) {
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
    }

    function moodLabel(id) {
      return (MOODS.find((mood) => mood.id === id) ?? MOODS[1]).label
    }

    function diffTodos(prev, next) {
      const before = new Map((prev ?? []).map((item) => [item.id, item]))
      const after = new Map((next ?? []).map((item) => [item.id, item]))
      return {
        added: (next ?? []).filter((item) => !before.has(item.id)),
        removed: (prev ?? []).filter((item) => !after.has(item.id)),
        toggled: (next ?? []).filter((item) => {
          const old = before.get(item.id)
          return old !== undefined && old.done !== item.done
        }),
      }
    }

    /** Split a note into display rows: "键：值" pairs, plain lines, blank gaps. */
    function parseNote(note) {
      const rows = []
      for (const line of String(note ?? '').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') { rows.push({ kind: 'gap' }); continue }
        const pair = /^([^\s：:]{1,12})[：:]\s*(.+)$/.exec(trimmed)
        if (pair !== null) rows.push({ kind: 'kv', key: pair[1], value: pair[2] })
        else rows.push({ kind: 'text', value: trimmed })
      }
      while (rows.length > 0 && rows[rows.length - 1].kind === 'gap') rows.pop()
      return rows
    }

    function noteLineCount(note) {
      return String(note ?? '').split('\n').filter(line => line.trim() !== '').length
    }

    /** The plugin mark: the panel's keeper herself, served by the host half. */
    function MemoArtwork({ size = 22, className }) {
      return h('img', {
        className: 'dshm-avatar' + (className ? ' ' + className : ''),
        src: ROUTE + '/avatar',
        width: size,
        height: size,
        alt: '',
        draggable: false,
        loading: 'eager',
      })
    }

    function Chevron({ dir, size = 12 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: dir === 'left' ? 'M10 3.5 5.5 8l4.5 4.5' : dir === 'right' ? 'M6 3.5 10.5 8 6 12.5' : 'M3.5 6 8 10.5 12.5 6' }))
    }

    function notePreview(rows) {
      const row = rows.find((item) => item.kind !== 'gap')
      if (row === undefined) return ''
      return row.kind === 'kv' ? row.key + '  ' + row.value : row.value
    }

    /** The folded note, editable in place: the same block turns into a textarea. */
    function NoteBlock({ rows, note, onMore, onSave }) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState('')
      const open = () => { setDraft(String(note ?? '')); setEditing(true) }
      const save = () => {
        setEditing(false)
        const next = draft.replace(/\s+$/, '')
        if (next === String(note ?? '').trim()) return
        onSave(next)
      }
      return h('div', { className: 'dshm-note' },
        h('div', { className: 'dshm-note-head' },
          h('span', { className: 'dshm-note-title' }, editing ? '改备注' : '备注'),
          editing
            ? h('button', { className: 'dshm-note-close dshm-note-action', title: '保存备注', onClick: save }, '保存')
            : h('button', { className: 'dshm-note-close dshm-note-action', title: '编辑备注', onClick: open }, '编辑'),
          h('button', { className: 'dshm-note-close', title: editing ? '放弃这次修改' : '收起备注', onClick: editing ? () => setEditing(false) : onMore }, editing ? '取消' : '收起')),
        editing
          ? h('textarea', {
              className: 'dshm-note-edit',
              value: draft,
              autoFocus: true,
              placeholder: '一行一件事，也可以分小节写',
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() }
                else if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
              },
            })
          : rows.map((row, index) => {
          if (row.kind === 'gap') return h('div', { className: 'dshm-note-gap', key: 'g' + index })
          if (row.kind === 'kv') {
            return h('div', { className: 'dshm-note-row', key: 'r' + index },
              h('span', { className: 'dshm-note-key' }, row.key),
              h('span', { className: 'dshm-note-val' }, row.value))
          }
          return h('div', { className: 'dshm-note-text', key: 't' + index }, row.value)
        }),
      )
    }

    function TodoEntry({ item, arriving, leaving, open, onToggle, onDelete, onNote, onStep, onEdit }) {
      const done = item.done === true
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState('')
      const settled = useRef(false)
      const openTitle = () => {
        if (leaving) return
        settled.current = false
        setDraft(item.text)
        setEditing(true)
      }
      const closeTitle = () => {
        if (settled.current) return
        settled.current = true
        setEditing(false)
        const next = draft.trim()
        if (next === '' || next === item.text) return
        onEdit(item, { text: next })
      }
      const rows = useMemo(() => parseNote(item.note), [item.note])
      const lines = noteLineCount(item.note)
      const keys = rows.filter((row) => row.kind === 'kv').map((row) => row.key)
      const summary = keys.length > 0
        ? keys.slice(0, 6).join(' · ') + (keys.length > 6 ? ' …' : '')
        : notePreview(rows).slice(0, 40)
      const steps = item.steps ?? []
      const stepDone = steps.filter(step => step.done).length
      const hasMeta = lines > 0 || steps.length > 0 || item.by === 'model'

      return h('div', {
        className: 'dshm-item' + (arriving ? ' is-arriving' : '') + (leaving ? ' is-leaving' : ''),
        'data-done': String(done),
        'data-id': item.id,
      },
        h('div', { className: 'dshm-head-line' },
          h('button', {
            className: 'dshm-check',
            'data-done': String(done),
            title: done ? '标记为未完成' : '标记为完成',
            'aria-pressed': String(done),
            onClick: () => { if (!leaving) onToggle(item, !done) },
          }, done
            ? h('svg', { key: 'on', viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: 'M2.2 6.3 4.9 9l4.9-6' }))
            : null),
          h('div', { className: 'dshm-item-main' },
            editing
              ? h('input', {
                  className: 'dshm-edit-input',
                  value: draft,
                  autoFocus: true,
                  'aria-label': '改这条待办',
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') { event.preventDefault(); closeTitle() }
                    else if (event.key === 'Escape') { event.preventDefault(); settled.current = true; setEditing(false) }
                  },
                  onBlur: closeTitle,
                  onDoubleClick: (event) => event.stopPropagation(),
                })
              : h('div', { className: 'dshm-item-title', title: '双击改标题', onDoubleClick: openTitle }, item.text),
            hasMeta
              ? h('div', { className: 'dshm-sub' },
                  item.by === 'model' ? h('span', { className: 'dshm-sub-item' }, 'AI') : null,
                  lines > 0
                    ? h('button', {
                        className: 'dshm-note-btn dshm-note-summary',
                        'data-open': String(open),
                        title: open ? '收起备注' : '展开备注',
                        onClick: () => onNote(item),
                      },
                        h('span', { className: 'dshm-note-summary-text' }, summary),
                        h(Chevron, { dir: 'down', size: 10 }))
                    : null,
                  steps.length > 0
                    ? h('span', { className: 'dshm-sub-item' }, stepDone + '/' + steps.length + ' 步')
                    : null)
              : null),
          h('button', { className: 'dshm-del', title: '删掉这条', onClick: () => { if (!leaving) onDelete(item) } }, '×'),
        ),
        lines > 0 && open
          ? h(NoteBlock, {
              rows,
              note: item.note,
              onMore: () => onNote(item),
              onSave: (text) => onEdit(item, { note: text }),
            })
          : null,
        steps.length > 0
          ? h('ul', { className: 'dshm-steps' }, ...steps.map((step, index) =>
              h('li', { className: 'dshm-step', key: index, 'data-done': String(step.done) },
                h('button', {
                  className: 'dshm-stepbox',
                  'data-done': String(step.done),
                  title: step.done ? '标记为未完成' : '标记为完成',
                  onClick: () => onStep(item, index, !step.done),
                }),
                h('span', { className: 'dshm-steptext' }, step.text))))
          : null,
      )
    }

    /** A small labelled input used by both goal forms. */
    function Field({ label: title, children }) {
      return h('label', { className: 'dshm-field' },
        h('span', { className: 'dshm-field-label' }, title),
        children)
    }

    function GoalForm({ initial, submitLabel, onSubmit, onCancel }) {
      const [text, setText] = useState(initial?.text ?? '')
      const [note, setNote] = useState(initial?.note ?? '')
      const [busy, setBusy] = useState(false)
      const submit = () => {
        const body = text.trim()
        if (body === '' || busy) return
        setBusy(true)
        Promise.resolve(onSubmit({ text: body, note: note.trim() }))
          .catch(() => {})
          .finally(() => { setBusy(false) })
      }
      return h('div', { className: 'dshm-goal-form' },
        h(Field, { label: '想做到的事' },
          h('textarea', {
            className: 'dshm-goal-input',
            value: text,
            rows: 2,
            autoFocus: true,
            placeholder: '一句话，写具体：在 12 月前写完第一卷',
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() }
            },
          })),
        h(Field, { label: '衡量' },
          h('input', {
            className: 'dshm-goal-input',
            value: note,
            placeholder: '怎么算做到，可以不填',
            onChange: (event) => setNote(event.target.value),
          })),
        h('div', { className: 'dshm-goal-actions' },
          h('button', { className: 'dshm-btn is-primary', disabled: busy || text.trim() === '', onClick: submit }, submitLabel),
          onCancel === undefined ? null : h('button', { className: 'dshm-btn', onClick: onCancel }, '取消')),
      )
    }

    /** One goal: sentence, deadline, progress log and the last critique. */
    function GoalCard({ goal, jobs, onReview, onLog, onDone, onDrop, onEdit }) {
      const [editing, setEditing] = useState(false)
      const [logging, setLogging] = useState(false)
      const [logDraft, setLogDraft] = useState('')
      const [showLogs, setShowLogs] = useState(false)
      const reviewBusy = jobs?.review?.running === true && jobs.review.id === goal.id
      const reviewFailed = jobs?.review?.running === false && jobs.review.id === goal.id && jobs.review.error !== ''
      const logs = goal.logs ?? []
      const shownLogs = showLogs ? logs : logs.slice(-3)
      const saveLog = () => {
        const text = logDraft.trim()
        if (text === '') return
        setLogDraft('')
        setLogging(false)
        onLog(goal, text)
      }
      if (editing) {
        return h('div', { className: 'dshm-goal' },
          h(GoalForm, {
            initial: goal,
            submitLabel: '保存',
            onSubmit: (fields) => onEdit(goal, fields).then(() => setEditing(false)),
            onCancel: () => setEditing(false),
          }))
      }
      return h('div', { className: 'dshm-goal', 'data-done': String(goal.done) },
        h('div', { className: 'dshm-goal-title', title: '双击改目标', onDoubleClick: () => setEditing(true) }, goal.text),
        h('div', { className: 'dshm-goal-meta' },
          goal.done
            ? h('span', { className: 'dshm-goal-days is-done' }, goal.doneAt === '' ? '已达成' : label(goal.doneAt.slice(0, 10)) + ' 达成')
            : h('span', { className: 'dshm-goal-days' }, '进行中'),
          goal.note === '' ? null : h('span', { className: 'dshm-goal-note' }, goal.note)),
        logs.length > 0
          ? h('div', { className: 'dshm-log' },
              h('div', { className: 'dshm-log-head' },
                h('span', null, '进度 ' + logs.length + ' 条'),
                logs.length > 3
                  ? h('button', { className: 'dshm-link', onClick: () => setShowLogs((value) => !value) }, showLogs ? '收起' : '全部')
                  : null),
              h('ol', { className: 'dshm-log-list' }, ...shownLogs.map((log, index) =>
                h('li', { className: 'dshm-log-item', key: index },
                  h('span', { className: 'dshm-log-at' }, log.at.slice(5, 10)),
                  h('span', { className: 'dshm-log-text' }, log.text)))))
          : null,
        logging
          ? h('div', { className: 'dshm-log-compose' },
              h('input', {
                className: 'dshm-goal-input',
                value: logDraft,
                autoFocus: true,
                placeholder: '这一笔做了什么',
                onChange: (event) => setLogDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); saveLog() }
                  else if (event.key === 'Escape') { setLogging(false); setLogDraft('') }
                },
              }),
              h('button', { className: 'dshm-btn is-primary', onClick: saveLog }, '记下'))
          : null,
        goal.review !== null
          ? h('blockquote', { className: 'dshm-review' },
              h('div', { className: 'dshm-review-head' },
                h('span', { className: 'dshm-review-who' }, '复盘'),
                h('span', { className: 'dshm-review-meta' }, label(goal.review.at.slice(0, 10)) + ' · ' + moodLabel(goal.review.mode))),
              h('p', { className: 'dshm-review-body' }, goal.review.text))
          : null,
        reviewBusy
          ? h('div', { className: 'dshm-review is-busy' },
              h('span', { className: 'dshm-pulse' }),
              'AI 正在读你立目标以来的日记…')
          : null,
        reviewFailed
          ? h('div', { className: 'dshm-fail' },
              h('span', null, '复盘没写成：' + jobs.review.error),
              h('button', { className: 'dshm-link', onClick: () => onReview(goal) }, '再试一次'))
          : null,
        h('div', { className: 'dshm-goal-actions' },
          goal.done
            ? h('button', { className: 'dshm-btn', onClick: () => onDone(goal, false) }, '重新开始')
            : h('button', { className: 'dshm-btn is-primary', disabled: reviewBusy, onClick: () => onReview(goal) }, reviewBusy ? '复盘里…' : '让 AI 复盘'),
          goal.done ? null : h('button', { className: 'dshm-btn', onClick: () => setLogging((value) => !value) }, '记一笔'),
          goal.done ? null : h('button', { className: 'dshm-btn', onClick: () => onDone(goal, true) }, '达成'),
          h('div', { className: 'dshm-spacer' }),
          h('button', { className: 'dshm-link is-danger', onClick: () => onDrop(goal) }, '删掉')),
      )
    }

    /** The diary page: what the model wrote, and one box for what happened. */
    function DiaryBlock({ diary, raw, dates, date, jobs, onDate, onSend, draft, setDraft, onRetry }) {
      const writing = jobs?.diary?.running === true && jobs.diary.date === date
      const failed = jobs?.diary?.running === false && jobs.diary.date === date && jobs.diary.error !== ''
      const chips = []
      for (const key of [date, ...(dates ?? []).slice(0, 6)]) {
        if (!chips.includes(key)) chips.push(key)
      }
      const todayKey = iso(new Date())
      const notesLength = String(raw?.text ?? '').length
      return h('div', { className: 'dshm-diary-block' },
        h('div', { className: 'dshm-section-head' },
          h('h3', { className: 'dshm-section-title' }, '日记'),
          h('div', { className: 'dshm-spacer' }),
          h('span', { className: 'dshm-section-note' }, '你说，AI 写')),
        h('div', { className: 'dshm-dateline' },
          h('button', { className: 'dshm-iconbtn', title: '前一天', onClick: () => onDate(shift(date, -1)) }, h(Chevron, { dir: 'left' })),
          h('div', { className: 'dshm-datetext' },
            label(date),
            h('span', null, WEEK[new Date(date + 'T12:00:00').getDay()] ?? ''),
            h('input', {
              className: 'dshm-datepick',
              type: 'date',
              value: date,
              title: '跳到某一天',
              onClick: (event) => {
                try { event.currentTarget.showPicker?.() } catch { /* the click alone opens it */ }
              },
              onChange: (event) => {
                const next = event.target.value
                if (next !== '') onDate(next)
              },
            })),
          h('button', { className: 'dshm-iconbtn', title: '后一天', onClick: () => onDate(shift(date, 1)) }, h(Chevron, { dir: 'right' })),
          date === todayKey ? null : h('button', { className: 'dshm-today', onClick: () => onDate(todayKey) }, '今天')),
        h('div', { className: 'dshm-dates' }, ...chips.map((key) =>
          h('button', {
            key,
            className: 'dshm-datechip',
            'data-active': String(key === date),
            onClick: () => onDate(key),
          }, key === todayKey ? '今天' : label(key)))),
        h('div', { className: 'dshm-paper' + (writing ? ' is-writing' : '') },
          String(diary?.text ?? '').trim() === ''
            ? h('p', { className: 'dshm-paper-empty' }, writing ? 'AI 正在写这一页…' : '这一页还空着。把今天做了什么说给它，它来落笔。')
            : h('div', { className: 'dshm-paper-body' }, diary.text),
          writing ? h('div', { className: 'dshm-inkbar' }) : null),
        failed
          ? h('div', { className: 'dshm-fail' },
              h('span', null, '这次没写成：' + jobs.diary.error),
              h('button', { className: 'dshm-link', onClick: () => onRetry(date) }, '再试一次'))
          : null,
        !failed && notesLength > 0 && raw?.fresh === true && !writing
          ? h('div', { className: 'dshm-fail is-quiet' },
              h('span', null, '这一天还有 ' + notesLength + ' 字口述没整理。'),
              h('button', { className: 'dshm-link', onClick: () => onRetry(date) }, '让 AI 整理'))
          : null,
        h('div', { className: 'dshm-compose is-notes' },
          h('textarea', {
            className: 'dshm-notes-input',
            value: draft,
            rows: 2,
            placeholder: date === todayKey ? '今天做了什么：去了哪、见了谁、做成了什么' : '补一句这一天的什么',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSend() }
            },
          }),
          h('button', {
            className: 'dshm-add is-wide',
            'data-ready': String(draft.trim() !== ''),
            title: '交给 AI 写成日记',
            onClick: onSend,
          }, writing ? '写…' : '交给 AI')),
      )
    }

    function SettingsSheet({ mood, custom, onSave, onClose }) {
      const [voice, setVoice] = useState(mood)
      const [note, setNote] = useState(custom)
      const [saving, setSaving] = useState(false)
      const save = () => {
        setSaving(true)
        Promise.resolve(onSave(voice, note)).finally(() => {
          setSaving(false)
          onClose()
        })
      }
      return h('div', { className: 'dshm-sheet' },
        h('div', { className: 'dshm-sheet-head' },
          h('span', { className: 'dshm-sheet-title' }, '复盘的口吻'),
          h('button', { className: 'dshm-iconbtn', title: '关闭', onClick: onClose }, '×')),
        h('div', { className: 'dshm-voice-grid' }, ...MOODS.map((option) =>
          h('button', {
            key: option.id,
            className: 'dshm-voice',
            'data-on': String(voice === option.id),
            onClick: () => setVoice(option.id),
          },
            h('span', { className: 'dshm-voice-label' }, option.label),
            h('span', { className: 'dshm-voice-hint' }, option.hint)))),
        voice === 'custom'
          ? h('textarea', {
              className: 'dshm-voice-custom',
              value: note,
              rows: 3,
              placeholder: '写一段口吻说明，比如：像个不耐烦的教练，直接说重点，别哄我',
              onChange: (event) => setNote(event.target.value),
            })
          : null,
        h('p', { className: 'dshm-sheet-hint' }, '下一次复盘生效，已经写下的点评不会改。'),
        h('div', { className: 'dshm-goal-actions' },
          h('button', { className: 'dshm-btn is-primary', disabled: saving, onClick: save }, '保存'),
          h('button', { className: 'dshm-btn', onClick: onClose }, '收起')),
      )
    }

    function App() {
      const [data, setData] = useState(null)
      const [seg, setSeg] = useState('todo')
      const [date, setDate] = useState(iso(new Date()))
      const [compose, setCompose] = useState('')
      const [notes, setNotes] = useState('')
      const [flash, setFlash] = useState(null)
      const [ghosts, setGhosts] = useState([])
      const [notice, setNotice] = useState(null)
      const [thinking, setThinking] = useState(false)
      const [openNotes, setOpenNotes] = useState({})
      const [sheet, setSheet] = useState(false)
      const [goalForm, setGoalForm] = useState(false)
      const [mark, setMark] = useState(null)

      const dateRef = useRef(date)
      const segRef = useRef(seg)
      const prevTodos = useRef([])
      const prevJobs = useRef(null)
      const goalPageRef = useRef(null)
      const lastSeq = useRef(-1)
      const mounted = useRef(true)

      const say = useCallback((text) => {
        setNotice({ text, key: String(Date.now()) + Math.random().toString(36).slice(2, 5) })
      }, [])

      useEffect(() => { dateRef.current = date }, [date])
      useEffect(() => { segRef.current = seg }, [seg])

      const apply = useCallback((value) => {
        const activity = value.activity ?? { seq: 0 }
        const previous = prevTodos.current
        const next = value.todos ?? []
        if (activity.seq !== lastSeq.current) {
          lastSeq.current = activity.seq
          const change = diffTodos(previous, next)
          const isTodo = activity.tool === 'memo' && !String(activity.op).startsWith('goal')
          if (isTodo && activity.op === 'add') {
            setFlash({ kind: 'add', ids: change.added.map((item) => item.id), at: Date.now() })
            if (change.added.length > 0) say('已记下：' + change.added[0].text)
          } else if (isTodo && activity.op === 'done') {
            const ticked = change.toggled.filter((item) => item.done)[0]
            setFlash({ kind: 'done', ids: change.toggled.filter((item) => item.done).map((item) => item.id), at: Date.now() })
            say(ticked === undefined ? '划掉了一件' : '已完成：' + ticked.text)
          } else if (isTodo && activity.op === 'del') {
            setFlash({ kind: 'del', at: Date.now() })
            if (change.removed.length > 0) setGhosts(change.removed)
            say(change.removed.length > 0 ? '已删掉：' + change.removed[0].text : '删掉了一件')
          } else if (isTodo && activity.op === 'clear') {
            setFlash({ kind: 'del', at: Date.now() })
            say('清理了已完成的待办')
          } else if (activity.tool === 'diary' && (activity.op === 'write' || activity.op === 'rewrite')) {
            setFlash({ kind: 'diary', at: Date.now() })
            say(activity.op === 'rewrite' ? '重写了 ' + label(activity.date || dateRef.current) + ' 的日记' : '日记已更新')
          }
          if (isTodo && segRef.current !== 'todo' && activity.op !== 'read') setMark('todo')
        }
        const priorJobs = prevJobs.current
        const jobs = value.jobs ?? {}
        if (priorJobs !== null) {
          if (priorJobs.diary?.running === true && jobs.diary?.running === false) {
            if (jobs.diary.error === '') say('AI 写好了 ' + label(jobs.diary.date) + ' 的日记')
          }
          if (priorJobs.review?.running === true && jobs.review?.running === false) {
            if (jobs.review.error === '') say('复盘写好了')
          }
        }
        prevJobs.current = jobs
        setThinking(activity.phase === 'run' && Date.now() - Number(activity.at ?? 0) < 6000)
        prevTodos.current = next
        if (mounted.current) {
          setData(value)
          if (value.diary !== undefined) setDate(value.diary.date)
        }
      }, [say])

      const load = useCallback((when) => {
        const target = when ?? dateRef.current
        return call('/state?date=' + encodeURIComponent(target)).then((value) => {
          apply(value)
        }).catch(() => {})
      }, [apply])

      useEffect(() => {
        mounted.current = true
        ensureStyle()
        void load(dateRef.current)
        const timer = setInterval(() => {
          if (document.visibilityState === 'hidden') return
          void load(dateRef.current)
        }, POLL_MS)
        return () => {
          mounted.current = false
          clearInterval(timer)
        }
      }, [load])

      useEffect(() => {
        if (flash === null) return undefined
        const timer = setTimeout(() => setFlash(null), 1800)
        return () => clearTimeout(timer)
      }, [flash])

      useEffect(() => {
        if (ghosts.length === 0) return undefined
        const timer = setTimeout(() => setGhosts([]), 620)
        return () => clearTimeout(timer)
      }, [ghosts])

      useEffect(() => {
        if (mark === null) return undefined
        const timer = setTimeout(() => setMark(null), 6000)
        return () => clearTimeout(timer)
      }, [mark])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => {
          if (mounted.current) setNotice(null)
        }, NOTICE_MS)
        return () => clearTimeout(timer)
      }, [notice])

      const patch = (next) => {
        apply({
          ...(data ?? { todos: [], dates: [], diary: { date, text: '' }, raw: { text: '', fresh: false }, goals: [], mood: 'gentle', custom: '', jobs: {}, activity: { seq: lastSeq.current }, today: iso(new Date()) }),
          ...next,
        })
      }

      const addTodo = () => {
        const text = compose.trim()
        if (text === '') return
        setCompose('')
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'add', text, date: dateRef.current }) })
          .then((value) => {
            patch(value)
            if (value.item !== undefined) setFlash({ kind: 'add', ids: [value.item.id], at: Date.now() })
          })
          .catch((error) => say(String(error?.message ?? error)))
      }

      const editTodo = (item, fields) => {
        setData((current) => current === null ? current : {
          ...current,
          todos: current.todos.map((row) => (row.id === item.id ? { ...row, ...fields } : row)),
        })
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'edit', id: item.id, ...fields, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => { say(String(error?.message ?? error)); void load() })
      }

      const toggleTodo = (item, done) => {
        setData((current) => current === null ? current : { ...current, todos: current.todos.map((row) => (row.id === item.id ? { ...row, done } : row)) })
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'toggle', id: item.id, done, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => { say(String(error?.message ?? error)); void load() })
      }

      const toggleStep = (item, index, done) => {
        setData((current) => current === null ? current : {
          ...current,
          todos: current.todos.map((row) => row.id !== item.id ? row : {
            ...row,
            steps: (row.steps ?? []).map((step, at) => (at === index ? { ...step, done } : step)),
          }),
        })
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'step', id: item.id, index, done, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => { say(String(error?.message ?? error)); void load() })
      }

      const deleteTodo = (item) => {
        setData((current) => current === null ? current : { ...current, todos: current.todos.filter((row) => row.id !== item.id) })
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'del', id: item.id, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => { say(String(error?.message ?? error)); void load() })
      }

      const clearDone = () => {
        call('/todo', { method: 'POST', body: JSON.stringify({ op: 'clear', date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => say(String(error?.message ?? error)))
      }

      const toggleNote = (item) => {
        setOpenNotes((current) => {
          const next = { ...current }
          if (next[item.id] === true) delete next[item.id]
          else next[item.id] = true
          return next
        })
      }

      const goDate = (next) => {
        if (next === dateRef.current) return
        dateRef.current = next
        setDate(next)
        void load(next)
      }

      const pushGoal = (fields) => {
        return call('/goal', { method: 'POST', body: JSON.stringify({ op: 'set', ...fields, date: dateRef.current }) })
          .then((value) => {
            patch(value)
            setGoalForm(false)
            say('目标立好了，AI 开始读日记')
          })
          .catch((error) => { say(String(error?.message ?? error)); throw error })
      }

      const editGoal = (goal, fields) => {
        return call('/goal', { method: 'POST', body: JSON.stringify({ op: 'set', id: goal.id, ...fields, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => { say(String(error?.message ?? error)); throw error })
      }

      const logGoal = (goal, text) => {
        call('/goal', { method: 'POST', body: JSON.stringify({ op: 'log', id: goal.id, log: text, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => say(String(error?.message ?? error)))
      }

      const reviewGoal = (goal) => {
        call('/goal/review', { method: 'POST', body: JSON.stringify({ id: goal.id, date: dateRef.current }) })
          .then((value) => patch(value))
          .catch((error) => say(String(error?.message ?? error)))
      }

      const doneGoal = (goal, done) => {
        call('/goal', { method: 'POST', body: JSON.stringify({ op: 'done', id: goal.id, done, date: dateRef.current }) })
          .then((value) => { patch(value); say(done ? '目标达成' : '目标重新开始') })
          .catch((error) => say(String(error?.message ?? error)))
      }

      const dropGoal = (goal) => {
        call('/goal', { method: 'POST', body: JSON.stringify({ op: 'drop', id: goal.id, date: dateRef.current }) })
          .then((value) => { patch(value); say('目标删掉了') })
          .catch((error) => say(String(error?.message ?? error)))
      }

      const saveMood = (mood, custom) => {
        return call('/mood', { method: 'POST', body: JSON.stringify({ mood, custom, date: dateRef.current }) })
          .then((value) => { patch(value); say('口吻改好了') })
          .catch((error) => say(String(error?.message ?? error)))
      }

      const sendNotes = () => {
        const text = notes.trim()
        if (text === '') return
        setNotes('')
        call('/raw', { method: 'POST', body: JSON.stringify({ date: dateRef.current, text }) })
          .then((value) => { patch(value); say('交给 AI 了，正在写') })
          .catch((error) => { setNotes(text); say(String(error?.message ?? error)) })
      }

      const retryDiary = (when) => {
        call('/diary/retry', { method: 'POST', body: JSON.stringify({ date: when }) })
          .then((value) => patch(value))
          .catch((error) => say(String(error?.message ?? error)))
      }

      const todos = data?.todos ?? []
      const openCount = todos.filter((item) => !item.done).length
      const doneCount = todos.length - openCount
      const goals = data?.goals ?? []
      const current = goals.find((goal) => !goal.done) ?? null
      const history = goals.filter((goal) => goal.done)
      const arrivingIds = flash !== null && flash.kind === 'add' ? flash.ids ?? [] : []
      const jobs = data?.jobs ?? {}

      return h('div', { className: 'dshm-root', 'data-dsh-plugin': 'sidebar-memo' },
        h('div', { className: 'dshm-runbar', 'data-on': String(thinking) }),
        h('div', { className: 'dshm-head' },
          h('h2', { className: 'dshm-title' }, '备忘录'),
          notice !== null
            ? h('span', { className: 'dshm-count dshm-notice', key: notice.key, title: notice.text }, notice.text)
            : h('span', { className: 'dshm-count' },
                data === null ? '读取中' : seg === 'todo' ? (todos.length === 0 ? '空着' : openCount + ' 件未完成') : (current === null ? '没有进行中的目标' : '目标进行中')),
          h('div', { className: 'dshm-spacer' }),
          h('button', {
            className: 'dshm-iconbtn',
            title: sheet ? '收起设置' : '复盘的口吻',
            onClick: () => {
              const next = !sheet
              setSheet(next)
              if (next && seg === 'goal' && goalPageRef.current !== null) goalPageRef.current.scrollTo({ top: 0 })
            },
          }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('circle', { cx: 8, cy: 8, r: 2.2 }),
            h('path', { d: 'M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1' })))),
        h('div', { className: 'dshm-tabs', 'data-at': seg },
          h('button', { className: 'dshm-tab', 'data-active': String(seg === 'todo'), onClick: () => { setSeg('todo'); setMark(null) } },
            '清单', mark === 'todo' ? h('span', { className: 'dshm-tab-dot' }) : null),
          h('button', { className: 'dshm-tab', 'data-active': String(seg === 'goal'), onClick: () => { setSeg('goal'); setMark(null) } },
            '目标', current !== null && (current.logs ?? []).length > 0 ? h('span', { className: 'dshm-tab-count' }, current.logs.length + '') : null,
            mark === 'goal' ? h('span', { className: 'dshm-tab-dot' }) : null),
        ),
        seg === 'todo'
          ? h('div', { className: 'dshm-todo' },
              h('div', { className: 'dshm-list' },
                todos.length === 0 && ghosts.length === 0
                  ? h('div', { className: 'dshm-empty' },
                      h('p', { className: 'dshm-empty-title' }, '还没有记下的事'),
                      h('p', { className: 'dshm-empty-body' }, '在下面写一件，也可以让 AI 替你记。'))
                  : null,
                todos.map((item) => h(TodoEntry, {
                  key: item.id,
                  item,
                  arriving: arrivingIds.includes(item.id),
                  leaving: false,
                  open: openNotes[item.id] === true,
                  onToggle: toggleTodo,
                  onDelete: deleteTodo,
                  onNote: toggleNote,
                  onStep: toggleStep,
                  onEdit: editTodo,
                })),
                ghosts.map((item) => h(TodoEntry, {
                  key: 'ghost-' + item.id,
                  item,
                  arriving: false,
                  leaving: true,
                  open: false,
                  onToggle: () => {},
                  onDelete: () => {},
                  onNote: () => {},
                  onStep: () => {},
                  onEdit: () => {},
                })),
              ),
              doneCount > 0
                ? h('div', { className: 'dshm-foot is-flush' },
                    h('span', null, doneCount + ' 件已完成'),
                    h('div', { className: 'dshm-spacer' }),
                    h('button', { className: 'dshm-textbtn', onClick: clearDone }, '清空已完成'))
                : null,
              h('div', { className: 'dshm-compose' },
                h('input', {
                  className: 'dshm-input',
                  value: compose,
                  placeholder: '记一件要做的事',
                  onChange: (event) => setCompose(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); addTodo() } },
                }),
                h('button', { className: 'dshm-add', 'data-ready': String(compose.trim() !== ''), title: '添加', onClick: addTodo }, '+'),
              ),
            )
          : h('div', { className: 'dshm-goalpage', ref: goalPageRef },
              sheet ? h(SettingsSheet, {
                mood: data?.mood ?? 'gentle',
                custom: data?.custom ?? '',
                onSave: saveMood,
                onClose: () => setSheet(false),
              }) : null,
              h('div', { className: 'dshm-goals' },
                current === null && history.length === 0 && goalForm === false
                  ? h('div', { className: 'dshm-empty' },
                      h('p', { className: 'dshm-empty-title' }, '还没有目标'),
                      h('p', { className: 'dshm-empty-body' }, '立一个想做到的事，AI 会按你选的口气，盯着日记替你复盘。'),
                      h('button', { className: 'dshm-btn is-primary dshm-empty-action', onClick: () => setGoalForm(true) }, '立一个目标'))
                  : null,
                current !== null
                  ? h(GoalCard, {
                      goal: current,
                      jobs,
                      onReview: reviewGoal,
                      onLog: logGoal,
                      onDone: doneGoal,
                      onDrop: dropGoal,
                      onEdit: editGoal,
                    })
                  : null,
                goalForm
                  ? h(GoalForm, {
                      submitLabel: '立下',
                      onSubmit: pushGoal,
                      onCancel: () => setGoalForm(false),
                    })
                  : (current === null && history.length === 0 ? null
                    : h('button', { className: 'dshm-goal-new', onClick: () => setGoalForm(true) }, '+ 再立一个目标')),
                history.length === 0
                  ? null
                  : h('div', { className: 'dshm-history' },
                      h('div', { className: 'dshm-section-head' },
                        h('h3', { className: 'dshm-section-title' }, '达成的'),
                        h('span', { className: 'dshm-section-note' }, history.length + ' 个')),
                      ...history.slice(0, 4).map((goal) =>
                        h('div', { className: 'dshm-history-item', key: goal.id },
                          h('span', { className: 'dshm-history-text' }, goal.text),
                          h('button', { className: 'dshm-link', onClick: () => dropGoal(goal) }, '删掉')))),
              ),
              h('div', { className: 'dshm-divider' }),
              h(DiaryBlock, {
                diary: data?.diary,
                raw: data?.raw,
                dates: data?.dates,
                date,
                jobs,
                onDate: goDate,
                onSend: sendNotes,
                draft: notes,
                setDraft: setNotes,
                onRetry: retryDiary,
              }),
            ),
      )
    }

    function MemoTitle() {
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
        h(MemoArtwork, { size: 13 }),
        '备忘录')
    }

    function definition() {
      return {
        id: ID,
        kind: KIND,
        priority: 'builtin',
        title: () => '备忘录',
        guide: [{
          id: 'memo',
          order: 40,
          title: () => '备忘录',
          description: () => '清单、目标与日记',
          icon: MemoArtwork,
        }],
      }
    }

    function apply(ctx) {
      ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
        try {
          scope.effect(() => scope.sidebarRightTabs.register(definition()), 'dsh-sidebar-memo: tab type')
        } catch (error) {
          console.warn('dsh-sidebar-memo: tab type not registered', error)
        }
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
          name: 'sidebar.right.pane.tab',
          key: ID,
          inject: () => ({}),
        }, App)), 'dsh-sidebar-memo: tab body')
        scope.effect(() => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: ID,
        }, MemoTitle)), 'dsh-sidebar-memo: tab title')
      })
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'sidebarRightTabs']
    return module.exports
  },
})
