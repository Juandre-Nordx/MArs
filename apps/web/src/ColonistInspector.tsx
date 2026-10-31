import {
  residentFeedback,
  type ColonyState,
  type CitizenComment,
} from '@mars/simulation';
export function ColonistInspector({
  colony,
  id,
  onClose,
}: {
  colony: ColonyState;
  id: string;
  onClose: () => void;
}) {
  const feedback = residentFeedback(colony, id),
    resident = colony.residents.find((r) => r.id === id);
  if (!feedback || !resident) return null;
  const comments = (items: CitizenComment[], compact = false) =>
    items.map((item) => (
      <li key={item.code}>
        {compact ? (
          <details>
            <summary>{item.title}</summary>
            <p>“{item.quote}”</p>
            <small>{item.evidence}</small>
          </details>
        ) : (
          <>
            <strong>{item.title}</strong>
            <p>“{item.quote}”</p>
            <small>{item.evidence}</small>
            {item.action && <p className="citizen-action">{item.action}</p>}
          </>
        )}
      </li>
    ));
  return (
    <section
      className="colonist-inspector"
      aria-label="Colonist conversation"
      data-testid="colonist-inspector"
    >
      <div className="citizen-title">
        <h3>{feedback.name}</h3>
        <button aria-label="Close conversation" onClick={onClose}>
          ×
        </button>
      </div>
      <span
        className={`citizen-mood ${feedback.mood.toLowerCase()}`}
        data-testid="citizen-mood"
      >
        {feedback.mood}
      </span>
      <blockquote data-testid="citizen-quote">“{feedback.headline}”</blockquote>
      <p className="muted">
        {resident.activity} ·{' '}
        {resident.homeId ? `Home: ${resident.homeId}` : 'No assigned home'}
      </p>
      <h4>What I am happy about</h4>
      {feedback.happyAbout.length ? (
        <ul
          className="citizen-comments citizen-positive"
          data-testid="citizen-likes"
        >
          {comments(feedback.happyAbout, true)}
        </ul>
      ) : (
        <p>I need the basics before I can feel settled here.</p>
      )}
      <h4>What worries me</h4>
      {feedback.concerns.length ? (
        <ul
          className="citizen-comments citizen-concerns"
          data-testid="citizen-concerns"
        >
          {comments(feedback.concerns)}
        </ul>
      ) : (
        <p>No immediate personal concerns.</p>
      )}
      <h4>What the colony needs</h4>
      {feedback.cityNeeds.length ? (
        <ul className="citizen-comments" data-testid="citizen-city-needs">
          {comments(feedback.cityNeeds)}
        </ul>
      ) : (
        <p>The essentials are covered right now.</p>
      )}
      <p className="muted">
        Current outlook reflects live colony conditions. Talking does not pause
        simulation.
      </p>
    </section>
  );
}
