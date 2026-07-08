import { BaseEdge, EdgeLabelRenderer, getBezierPath } from 'reactflow';

// A manual connection with a ✕ button at its midpoint to delete it (you can also
// select it and press Delete/Backspace).
export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          className="edge-delete nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          title="Delete connection"
          onClick={(e) => {
            e.stopPropagation();
            data?.onDelete?.();
          }}
        >
          ✕
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
