import { Component, type ReactNode } from 'react'

interface Props {
  /** Short name of the guarded region, shown in the fallback. */
  label: string
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Catches render errors in a subtree so one broken view (e.g. the node
 *  canvas) shows an inline error instead of blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-title">The {this.props.label} hit an error.</div>
          <pre className="error-boundary-msg">{this.state.error.message}</pre>
          <button className="tb-button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
