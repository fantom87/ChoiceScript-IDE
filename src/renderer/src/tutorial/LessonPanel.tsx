/**
 * The build-a-game tutorial panel: lesson text + task + a LIVE check of the
 * learner's actual files (re-validated on every edit). Next unlocks when the
 * code really does the thing; "Show example" reveals that lesson's demo.
 */
import { useMemo, useState } from 'react'
import { LESSONS, checkLesson } from './lessons'

export function LessonPanel({
  idx,
  files,
  onIdx,
  onClose
}: {
  idx: number
  files: Record<string, string>
  onIdx: (i: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [showDemo, setShowDemo] = useState(false)
  const lesson = LESSONS[Math.min(idx, LESSONS.length - 1)]
  const res = useMemo(() => checkLesson(idx, files), [idx, files])
  const last = idx === LESSONS.length - 1

  return (
    <div className={`lesson-panel ${collapsed ? 'lesson-collapsed' : ''}`}>
      <div className="lesson-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="lesson-crumb">
          📖 Lesson {idx + 1}/{LESSONS.length}
        </span>
        <span className="lesson-title">{lesson.title}</span>
        <span className={`lesson-state ${res.pass ? 'ok' : ''}`}>{res.pass ? '✓' : '…'}</span>
        <button
          className="tut-x"
          title="Close (progress is saved)"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ✕
        </button>
      </div>
      {!collapsed && (
        <div className="lesson-body">
          {lesson.body.map((b, i) =>
            b.kind === 'code' ? (
              <pre key={i} className="lesson-code">
                {b.text}
              </pre>
            ) : (
              <p key={i}>{b.text}</p>
            )
          )}
          <div className={`lesson-task ${res.pass ? 'lesson-task-done' : ''}`}>
            <b>{res.pass ? '✓ Done: ' : 'Your task: '}</b>
            {lesson.task}
          </div>
          {!res.pass && res.notes.length > 0 && (
            <ul className="lesson-notes">
              {res.notes.slice(0, 4).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {showDemo && (
            <pre className="lesson-code lesson-demo">
              {Object.entries(lesson.demo)
                .map(([scene, text]) => `— ${scene}.txt —\n${text}`)
                .join('\n\n')}
            </pre>
          )}
          <div className="lesson-foot">
            <button className="header-btn" onClick={() => setShowDemo((s) => !s)}>
              {showDemo ? 'Hide example' : 'Show example'}
            </button>
            <span className="tut-btns">
              {idx > 0 && (
                <button className="header-btn" onClick={() => onIdx(idx - 1)}>
                  Back
                </button>
              )}
              {!res.pass && !last && (
                <button className="header-btn lesson-skip" title="Move on without completing" onClick={() => onIdx(idx + 1)}>
                  Skip
                </button>
              )}
              <button
                className={`header-btn tut-next ${res.pass ? '' : 'lesson-locked'}`}
                disabled={!res.pass}
                title={res.pass ? '' : 'Complete the task to continue'}
                onClick={() => onIdx(last ? -1 : idx + 1)}
              >
                {last ? 'Finish' : 'Next'}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
