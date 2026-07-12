interface WelcomeProps {
  onNew: () => void
  onOpen: () => void
  onSample: () => void
}

export function Welcome({ onNew, onOpen, onSample }: WelcomeProps) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="welcome-title">ChoiceScript IDE</h1>
        <p className="welcome-sub">A dedicated editor for ChoiceScript interactive fiction.</p>
        <div className="welcome-actions">
          <button className="welcome-btn primary" onClick={onNew}>
            <span className="welcome-btn-title">New Project</span>
            <span className="welcome-btn-desc">Scaffold a fresh game in a folder</span>
          </button>
          <button className="welcome-btn" onClick={onOpen}>
            <span className="welcome-btn-title">Open Project</span>
            <span className="welcome-btn-desc">Open an existing ChoiceScript game folder</span>
          </button>
          <button className="welcome-btn" onClick={onSample}>
            <span className="welcome-btn-title">Open Sample Game</span>
            <span className="welcome-btn-desc">Explore the bundled example</span>
          </button>
        </div>
      </div>
    </div>
  )
}
