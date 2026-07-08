// Custom link buttons attached to a node. Everyone can click them; only admins
// get the edit (✎ / ＋ link) affordance (passed as onEdit).
export default function NodeButtons({ buttons = [], onEdit }) {
  if (!buttons.length && !onEdit) return null;
  return (
    <div className="node-btns nodrag nopan">
      {buttons.map((b) => (
        <a
          key={b.id}
          className="node-btn-link"
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          title={b.url}
          onClick={(e) => e.stopPropagation()}
        >
          {b.label || 'link'} ↗
        </a>
      ))}
      {onEdit && (
        <button
          className="node-btn-edit"
          title="Manage custom links"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          {buttons.length ? '✎' : '＋ link'}
        </button>
      )}
    </div>
  );
}
