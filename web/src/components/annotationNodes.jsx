import { useState } from 'react';
import { NodeResizer, Handle, Position } from 'reactflow';
import '@reactflow/node-resizer/dist/style.css';

// A resizable grouping frame (dotted or solid). The frame body is click-through
// (pointer-events: none in CSS) so nodes underneath stay interactive — you grab
// it by its title bar and resize via the corner/edge handles on hover. It also
// exposes connection handles so you can wire a frame to other frames/elements.
export function AnnotationBox({ data }) {
  const { text, dashed, onRename, onToggleDash, onRemove, onResize } = data;
  const hasText = !!(text && text.trim());
  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={90}
        isVisible
        lineClassName="anno-resize-line"
        handleClassName="anno-resize-handle"
        onResizeEnd={(_, p) =>
          onResize({ width: p.width, height: p.height, position: { x: p.x, y: p.y } })
        }
      />
      {/* Offset off the vertical middle so they don't sit on the resize edge-handles. */}
      <Handle type="target" position={Position.Left} className="rf-handle anno-conn" style={{ top: '28%' }} />
      <Handle type="source" position={Position.Right} className="rf-handle anno-conn" style={{ top: '72%' }} />
      <div className={`anno-box ${dashed ? 'dashed' : 'solid'}`}>
        {/* Title bar: only the grip shows when there's no label; the input +
            controls appear on hover so an unlabeled frame stays clean. */}
        <div className={`anno-box-bar${hasText ? ' has-text' : ''}`}>
          <span className="anno-box-grip" title="Drag to move">⠿</span>
          <input
            className="anno-box-title nodrag nopan"
            value={text}
            placeholder="Group label"
            onChange={(e) => onRename(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            className="anno-btn nodrag"
            title={dashed ? 'Switch to solid border' : 'Switch to dotted border'}
            onClick={onToggleDash}
          >
            {dashed ? '▭' : '┈'}
          </button>
          <button className="anno-btn nodrag" title="Remove frame" onClick={onRemove}>
            ✕
          </button>
        </div>
      </div>
    </>
  );
}

// A free-floating text label for annotating regions of a large canvas. Resize
// to scale it into a section heading; drag to move, double-click to edit.
export function AnnotationLabel({ data }) {
  const { text, height, onRename, onRemove, onResize } = data;
  const [editing, setEditing] = useState(false);
  const fontSize = Math.max(11, Math.round((height || 40) * 0.5));
  return (
    <>
      <NodeResizer
        minWidth={70}
        minHeight={26}
        isVisible
        lineClassName="anno-resize-line"
        handleClassName="anno-resize-handle"
        onResizeEnd={(_, p) =>
          onResize({ width: p.width, height: p.height, position: { x: p.x, y: p.y } })
        }
      />
      <div className="anno-label" style={{ fontSize }}>
        {editing ? (
          <input
            autoFocus
            className="anno-label-input nodrag nopan"
            value={text}
            placeholder="Label"
            style={{ fontSize }}
            onChange={(e) => onRename(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') setEditing(false);
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            className="anno-label-text"
            title="Drag to move · double-click to edit"
            onDoubleClick={() => setEditing(true)}
          >
            {text || 'Label'}
          </span>
        )}
        <button className="anno-label-remove nodrag" title="Remove label" onClick={onRemove}>
          ✕
        </button>
      </div>
    </>
  );
}

export const annotationNodeTypes = {
  annoBox: AnnotationBox,
  annoLabel: AnnotationLabel,
};
