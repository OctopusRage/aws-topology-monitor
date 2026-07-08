import { Handle, Position } from 'reactflow';

// Four connection points (one per side). With ReactFlow's "loose" connection
// mode each handle works as both source and target, so a line can leave/enter
// from whichever side is closest — keeping wires tidy instead of always
// stretching out the left/right edges.
const SIDES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

export default function ConnectHandles({ className = '' }) {
  return SIDES.map((s) => (
    <Handle
      key={s.id}
      id={s.id}
      type="source"
      position={s.position}
      className={`rf-handle conn-dot ${className}`}
    />
  ));
}
