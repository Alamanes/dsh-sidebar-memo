/**
 * dsh-sidebar-memo browser half.
 *
 * A right-sidebar tab type of its own, registered into the same tab registry the
 * shipped three use, so the capsule, the icon slot and the pick animation match
 * them by construction.
 *
 * A todo is drawn as an entry, not a card: a title line, a quiet metadata line,
 * then — when the entry carries one — a rule-marked note with two-column detail
 * rows and a short checklist. Long briefs stay readable because they live in the
 * note instead of being crammed into one line.
 *
 * The model's tools bump an activity sequence on the host; the panel polls it and
 * plays the animation for whatever just changed, then says what happened in a
 * strip that leaves on its own.
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
    const NOTE_PREVIEW_ROWS = 4

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

    /** The plugin mark: the notebook keeper herself, served by the host half. */
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

    /** The folded note: its first fact on one line, cut with an ellipsis. */
    function NoteBlock({ rows, onMore }) {
      return h('div', { className: 'dshm-note' },
        h('div', { className: 'dshm-note-head' },
          h('span', { className: 'dshm-note-title' }, '备注'),
          h('button', { className: 'dshm-note-close', title: '收起备注', onClick: onMore }, '收起')),
        rows.map((row, index) => {
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

    function TodoEntry({ item, arriving, leaving, open, onToggle, onDelete, onNote, onStep }) {
      const done = item.done === true
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
            h('div', { className: 'dshm-item-title' }, item.text),
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
        lines > 0 && open ? h(NoteBlock, { rows, onMore: () => onNote(item) }) : null,
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

    function App() {
      const [data, setData] = useState(null)
      const [seg, setSeg] = useState('todo')
      const [date, setDate] = useState(iso(new Date()))
      const [draft, setDraft] = useState('')
      const [saving, setSaving] = useState(false)
      const [pending, setPending] = useState(false)
      const [savedAt, setSavedAt] = useState('')
      const [compose, setCompose] = useState('')
      const [flash, setFlash] = useState(null)
      const [ghosts, setGhosts] = useState([])
      const [notice, setNotice] = useState(null)
      const [thinking, setThinking] = useState(false)
      const [openNotes, setOpenNotes] = useState({})
      const [sheet, setSheet] = useState(false)
      const [confirming, setConfirming] = useState(false)
      const [uploading, setUploading] = useState(false)
      const [padId, setPadId] = useState('')
      const [mark, setMark] = useState(null)

      const dateRef = useRef(date)
      const segRef = useRef(seg)
      const draftRef = useRef(draft)
      const dirtyRef = useRef(false)
      const prevTodos = useRef([])
      const lastSeq = useRef(-1)
      const mounted = useRef(true)
      const chipsRef = useRef(null)

      /** One strip, named after what actually changed; it leaves on its own. */
      const say = useCallback((text) => {
        setNotice({ text, key: String(Date.now()) + Math.random().toString(36).slice(2, 5) })
      }, [])

      useEffect(() => { dateRef.current = date }, [date])
      useEffect(() => { segRef.current = seg }, [seg])
      useEffect(() => { draftRef.current = draft }, [draft])

      const apply = useCallback((value) => {
        const activity = value.activity ?? { seq: 0 }
        const previous = prevTodos.current
        const next = value.todos ?? []
        if (activity.seq !== lastSeq.current) {
          lastSeq.current = activity.seq
          const change = diffTodos(previous, next)
          const isTodo = activity.tool === 'memo'
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
          const activeView = isTodo ? 'todo' : 'diary'
          if (activity.phase === 'done' && segRef.current !== activeView && activity.op !== 'read') setMark(activeView)
        }
        setThinking(activity.phase === 'run' && Date.now() - Number(activity.at ?? 0) < 6000)
        prevTodos.current = next
        if (mounted.current) {
          setData(value)
          if (!dirtyRef.current) setDraft(value.diary?.text ?? '')
          if (value.notebook !== undefined) {
            setPadId((current) => (current === '' ? (value.notebook.id ?? '') : current))
          }
        }
      }, [])

      const load = useCallback((when) => {
        const target = when ?? dateRef.current
        return call('/state?date=' + encodeURIComponent(target)).then((value) => {
          if (value.diary !== undefined) setDate(value.diary.date)
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

      // A line in the header says what just happened, then leaves on its own.
      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => {
          if (mounted.current) setNotice(null)
        }, NOTICE_MS)
        return () => clearTimeout(timer)
      }, [notice])

      // Follow the active day when the strip is scrolled out of sight.
      useEffect(() => {
        if (seg !== 'diary') return undefined
        const strip = chipsRef.current
        if (strip === null) return undefined
        const active = strip.querySelector("[data-active='true']")
        if (active !== null && typeof active.scrollIntoView === 'function') {
          active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
        }
        return undefined
      }, [seg, date, data?.dates])

      /** Write the page now: autosave and the manual shortcut share this. */
      const saveNow = useCallback(() => {
        if (!dirtyRef.current) return Promise.resolve()
        setSaving(true)
        return call('/diary', { method: 'POST', body: JSON.stringify({ date: dateRef.current, text: draftRef.current }) })
          .then(() => {
            dirtyRef.current = false
            setPending(false)
            setSavedAt(stamp(new Date()))
          })
          .catch((error) => say(String(error?.message ?? error)))
          .finally(() => { if (mounted.current) setSaving(false) })
      }, [say])

      // Debounced autosave while the draft is dirty.
      useEffect(() => {
        if (!dirtyRef.current) return undefined
        const timer = setTimeout(() => { void saveNow() }, 900)
        return () => clearTimeout(timer)
      }, [draft, date, saveNow])

      // Command-S writes the page now, the way a notebook should save.
      useEffect(() => {
        if (seg !== 'diary') return undefined
        const onKey = (event) => {
          if (!(event.metaKey || event.ctrlKey) || String(event.key).toLowerCase() !== 's') return
          event.preventDefault()
          if (dirtyRef.current) void saveNow()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [seg, saveNow])

      const patch = (next) => {
        apply({
          ...(data ?? { todos: [], dates: [], diary: { date, text: '' }, notebook: { provider: '', id: '' }, activity: { seq: lastSeq.current }, today: iso(new Date()) }),
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
        // The page being left is written first; the draft stays on screen until
        // the next page arrives, so the editor never flashes empty.
        void saveNow().then(() => {
          dateRef.current = next
          setDate(next)
          setSavedAt('')
          setFlash({ kind: 'turn', at: Date.now() })
          return load(next)
        })
      }

      const saveNotebook = (nextProvider) => {
        const provider = nextProvider ?? data?.notebook?.provider ?? ''
        call('/notebook', { method: 'POST', body: JSON.stringify({ provider, id: padId }) })
          .then(() => patch({ notebook: { ...(data?.notebook ?? {}), provider, id: padId } }))
          .catch((error) => say(String(error?.message ?? error)))
      }

      const upload = () => {
        if (confirming !== true) {
          setConfirming(true)
          setTimeout(() => { if (mounted.current) setConfirming(false) }, 4000)
          return
        }
        setConfirming(false)
        setUploading(true)
        call('/upload', { method: 'POST', body: '{}' })
          .then((value) => {
            const result = value.upload ?? {}
            say('已上传 ' + (result.bytes ?? 0) + ' 字节到 ' + (result.label ?? '在线记事本'))
            setSheet(false)
          })
          .catch((error) => say(String(error?.message ?? error)))
          .finally(() => { if (mounted.current) setUploading(false) })
      }

      const todos = data?.todos ?? []
      const openCount = todos.filter((item) => !item.done).length
      const doneCount = todos.length - openCount
      const isToday = date === iso(new Date())
      const dates = data?.dates ?? []
      const recent = dates.slice(0, 14)
      const chips = recent.includes(date) ? recent : [date, ...recent]
      const writing = flash !== null && flash.kind === 'diary'
      const turning = flash !== null && flash.kind === 'turn'
      const arrivingIds = flash !== null && flash.kind === 'add' ? flash.ids ?? [] : []

      return h('div', { className: 'dshm-root', 'data-dsh-plugin': 'sidebar-memo' },
        h('div', { className: 'dshm-runbar', 'data-on': String(thinking) }),
        h('div', { className: 'dshm-head' },
          h('h2', { className: 'dshm-title' }, '备忘录'),
          notice !== null
            ? h('span', { className: 'dshm-count dshm-notice', key: notice.key, title: notice.text }, notice.text)
            : h('span', { className: 'dshm-count' },
                data === null ? '读取中' : todos.length === 0 ? '空着' : openCount + ' 件未完成'),
          h('div', { className: 'dshm-spacer' }),
          h('button', {
            className: 'dshm-iconbtn',
            title: sheet ? '收起' : '上传到在线记事本',
            onClick: () => { setSheet((value) => !value); setConfirming(false) },
          }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('path', { d: 'M8 10.5V2.8' }), h('path', { d: 'M4.8 6 8 2.8 11.2 6' }), h('path', { d: 'M2.8 10.4v2.2a.6.6 0 0 0 .6.6h9.2a.6.6 0 0 0 .6-.6v-2.2' }))),
        ),
        h('div', { className: 'dshm-seg', 'data-at': seg },
          h('span', { className: 'dshm-seg-pill' }),
          h('button', { className: 'dshm-seg-btn', 'data-active': String(seg === 'todo'), onClick: () => { setSeg('todo'); setMark(null) } }, '待办',
            mark === 'todo' ? h('span', { className: 'dshm-seg-dot' }) : null),
          h('button', { className: 'dshm-seg-btn', 'data-active': String(seg === 'diary'), onClick: () => { setSeg('diary'); setMark(null) } }, '日记',
            mark === 'diary' ? h('span', { className: 'dshm-seg-dot' }) : null),
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
          : h('div', { className: 'dshm-diary' },
              h('div', { className: 'dshm-dateline' },
                h('button', { className: 'dshm-iconbtn', title: '前一天', onClick: () => goDate(shift(date, -1)) }, h(Chevron, { dir: 'left' })),
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
                      if (next !== '') goDate(next)
                    },
                  })),
                h('button', { className: 'dshm-iconbtn', title: '后一天', onClick: () => goDate(shift(date, 1)) }, h(Chevron, { dir: 'right' })),
                isToday ? null : h('button', { className: 'dshm-today', onClick: () => goDate(iso(new Date())) }, '今天'),
              ),
              chips.length === 0 ? null : h('div', { className: 'dshm-dates', ref: chipsRef },
                chips.map((key) => h('button', {
                  key,
                  className: 'dshm-datechip',
                  'data-active': String(key === date),
                  onClick: () => goDate(key),
                }, key === iso(new Date()) ? '今天' : label(key)))),
              h('div', { className: 'dshm-page' + (writing ? ' is-writing' : '') + (turning ? ' is-turning' : '') },
                h('textarea', {
                  className: 'dshm-textarea',
                  value: draft,
                  placeholder: isToday ? '今天想写点什么' : '这一页还空着',
                  spellCheck: false,
                  onChange: (event) => {
                    dirtyRef.current = true
                    setPending(true)
                    setDraft(event.target.value)
                  },
                }),
              ),
              h('div', { className: 'dshm-foot' },
                h('span', null, saving ? '正在保存' : pending ? '待保存' : savedAt !== '' ? '已保存 ' + savedAt : '自动保存'),
                h('div', { className: 'dshm-spacer' }),
                draft.length === 0 ? null : h('span', { className: 'dshm-chars' }, draft.length.toLocaleString() + ' 字'),
                h('button', {
                  className: 'dshm-textbtn',
                  'data-busy': String(uploading),
                  disabled: uploading,
                  onClick: () => { setSheet(true); setConfirming(false) },
                }, '上传到记事本')),
              sheet
                ? h('div', { className: 'dshm-sheet' },
                    h('p', { className: 'dshm-sheet-label' }, '上传到在线记事本'),
                    h('div', { className: 'dshm-choice' },
                      h('button', { 'data-on': String((data?.notebook?.provider ?? '') === 'notems'), onClick: () => saveNotebook('notems') }, 'note.ms'),
                      h('button', { 'data-on': String((data?.notebook?.provider ?? '') === 'getnote'), onClick: () => saveNotebook('getnote') }, 'getnote.top')),
                    h('div', { className: 'dshm-pad' },
                      h('input', {
                        value: padId,
                        placeholder: '记事本 ID',
                        onChange: (event) => setPadId(event.target.value),
                        onBlur: () => saveNotebook(),
                        onKeyDown: (event) => { if (event.key === 'Enter') saveNotebook() },
                      })),
                    h('div', { className: 'dshm-sheet-actions' },
                      h('button', {
                        className: 'dshm-primary',
                        disabled: uploading,
                        onClick: upload,
                      }, uploading ? '上传中' : confirming ? '确认上传整本日记' : '上传整本日记'),
                      h('button', { className: 'dshm-ghost', onClick: () => { setSheet(false); setConfirming(false) } }, '收起')),
                    h('p', { className: 'dshm-hint' }, '日记只在这台机器上。只有你按下上传并确认，整本日记才会被送上去。'),
                  )
                : null,
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
          description: () => '待办与日记',
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
