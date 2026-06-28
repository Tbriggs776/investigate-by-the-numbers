/**
 * The non-negotiable principle, made visible. Rendered on every screen that
 * shows a score. If a reviewer ever reads a CAS as proof, the product failed.
 */
export default function Disclaimer({ inline = false }: { inline?: boolean }) {
  if (inline) {
    return (
      <p className="disclaimer-inline">
        The Composite Anomaly Score is a <strong>prioritization signal for human
        review</strong> — not a finding, an allegation, or evidence of wrongdoing.
        A high score earns a place in the queue. It earns nothing in print.
      </p>
    )
  }
  return (
    <div className="disclaimer-strip" role="note">
      Scores prioritize human attention. They are not findings. A reviewer clears
      every gate; the score is never a source.
    </div>
  )
}
