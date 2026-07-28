import { ArrowUpRight, Clock3, Fingerprint, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { MemoryNode } from '../types'
import useCanvasZoom from '../useCanvasZoom'
import WorkspaceHeader from './WorkspaceHeader'

type Props = {
  nodes: MemoryNode[]
  activeNodeId: string
  onSelect: (id: string) => void
  onUseSeed: (node: MemoryNode) => void
}

export default function MemorySpace({ nodes, activeNodeId, onSelect, onUseSeed }: Props) {
  const activeNode = nodes.find((node) => node.id === activeNodeId) ?? nodes[0]
  const centerNode = nodes[0]
  const { zoom, zoomLabel, isDefaultZoom, viewportRef, resetZoom } = useCanvasZoom()

  return (
    <section className="memory-workspace">
      <WorkspaceHeader
        icon={SlidersHorizontal}
        eyebrow="音乐偏好 · 最近 184 天"
        title="这些声音，最近更适合你"
        actions={<>
          <div className="memory-stats">
            <span><strong>2,418</strong> 首播放记录</span>
            <span><strong>67</strong> 个偏好组合</span>
          </div>
          <button className="canvas-reset-button" onClick={resetZoom} disabled={isDefaultZoom} title={`恢复默认大小 · 当前 ${zoomLabel}%`} aria-label={`恢复默认大小，当前 ${zoomLabel}%`}><RotateCcw size={15} /></button>
        </>}
      />

      <div className="memory-canvas" ref={viewportRef}>
        <div className="memory-plane-frame">
          <div className="memory-plane" data-density={zoom < 75 ? 'compact' : zoom < 90 ? 'dense' : 'normal'} style={{ '--node-scale': zoom / 100 } as React.CSSProperties}>
            <svg className="memory-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {nodes.slice(1).map((node) => (
                <line key={node.id} x1={centerNode.x} y1={centerNode.y} x2={node.x} y2={node.y} />
              ))}
            </svg>
            {nodes.map((node) => (
              <button
                key={node.id}
                className={`memory-node tone-${node.tone} weight-${node.weight} ${node.id === activeNodeId ? 'is-active' : ''}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onClick={() => onSelect(node.id)}
              >
                <Fingerprint size={15} />
                <strong>{node.label}</strong>
                <small>{node.detail}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="memory-insight">
          <span className="mono-label">偏好详情</span>
          <h3>{activeNode.label}</h3>
          <p>{activeNode.detail} · 最近 30 天的夜间播放中更常出现。</p>
          <button onClick={() => onUseSeed(activeNode)}><Sparkles size={14} /> 按此偏好播放 <ArrowUpRight size={14} /></button>
        </div>
        <div className="memory-clock"><Clock3 size={15} /> 每天在本机自动更新</div>
      </div>
    </section>
  )
}
