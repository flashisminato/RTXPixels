import { CANVAS_LABEL, project, screenMapper, type DiagramPlan, type PlanMark, type PlanSegment } from './explain.ts';

const SEGMENT_COLOR: Record<PlanSegment['role'], string> = {
  path: '#ffd98a',
  normal: '#d7cbff',
  'shadow-open': '#b7ebc6',
  'shadow-blocked': '#ffb4b4',
  miss: '#a9d4f2',
};

export function createDiagram(canvas: HTMLCanvasElement): { show(plan: DiagramPlan | null, message: string): void; dispose(): void } {
  let plan: DiagramPlan | null = null;
  let message = 'Pick a pixel to follow its computed path.';
  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  function paint(): void {
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bufferWidth = Math.max(1, Math.round(cssWidth * dpr));
    const bufferHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    drawDiagram(context, cssWidth, cssHeight, dpr, plan, message);
    canvas.setAttribute('aria-label', plan
      ? `${plan.canvasLabel} The step list after this figure has the same events.`
      : message);
  }

  return {
    show(nextPlan, nextMessage) {
      plan = nextPlan;
      message = nextMessage;
      paint();
    },
    dispose() { observer.disconnect(); },
  };
}

function drawDiagram(
  context: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  plan: DiagramPlan | null,
  message: string,
): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#0c141c';
  context.fillRect(0, 0, cssWidth, cssHeight);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.font = '12px system-ui, sans-serif';
  const caption = wrap(context, plan?.canvasLabel ?? CANVAS_LABEL, cssWidth - 20);
  const legendHeight = Math.min(cssHeight * 0.34, 14 + caption.length * 15 + 8);
  const plotHeight = cssHeight - legendHeight;

  if (plan && plotHeight >= 48) {
    // The camera and the light sit far from the hits. Fitting them would stack
    // the path into one line. Those rays are clipped to the plot edge instead.
    const points = [
      ...plan.segments.flatMap(segment => {
        if (segment.role === 'shadow-open') return [segment.from];
        if (segment.role === 'path' && segment.label === '') return [segment.to];
        return [segment.from, segment.to];
      }),
      ...plan.marks.filter(mark => mark.role !== 'light' && mark.role !== 'camera').map(mark => mark.at),
    ];
    const map = screenMapper(points, cssWidth, plotHeight, 28);
    if (map) {
      const labels: { x: number; y: number; text: string }[] = [];
      for (const segment of plan.segments) labels.push(...drawSegment(context, map, segment, cssWidth, plotHeight));
      for (const mark of plan.marks) labels.push(drawMark(context, map, mark, cssWidth, plotHeight));
      context.font = '12px system-ui, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      separateLabels(context, labels, cssWidth, plotHeight);
      for (const label of labels) halo(context, label.text, label.x, label.y);
      drawAxisPlate(context, 8, 8);
    } else writeMessage(context, message, cssWidth, plotHeight);
  } else writeMessage(context, message, cssWidth, Math.max(plotHeight, cssHeight * 0.5));

  context.fillStyle = '#101820';
  context.fillRect(0, plotHeight, cssWidth, cssHeight - plotHeight);
  context.strokeStyle = '#345066';
  context.lineWidth = 1;
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(0, plotHeight);
  context.lineTo(cssWidth, plotHeight);
  context.stroke();
  context.font = '12px system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = '#d5dee8';
  caption.forEach((line, index) => context.fillText(line, 10, plotHeight + 8 + index * 15));
}

function drawAxisPlate(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.fillStyle = '#0c141c';
  context.strokeStyle = '#345066';
  context.lineWidth = 1;
  context.fillRect(x, y, 96, 70);
  context.strokeRect(x, y, 96, 70);
  drawAxes(context, x + 22, y + 50);
  context.restore();
}

function drawSegment(
  context: CanvasRenderingContext2D,
  map: (point: PlanSegment['from']) => { x: number; y: number },
  segment: PlanSegment,
  width: number,
  height: number,
): { x: number; y: number; text: string }[] {
  const mappedStart = map(segment.from);
  const mappedEnd = map(segment.to);
  const start = outside(mappedStart, width, height, 20) && !outside(mappedEnd, width, height, 20)
    ? clipToRect(mappedEnd, mappedStart, width, height, 20)
    : mappedStart;
  const end = outside(mappedEnd, width, height, 20) && !outside(start, width, height, 20)
    ? clipToRect(start, mappedEnd, width, height, 20)
    : mappedEnd;
  context.save();
  context.strokeStyle = SEGMENT_COLOR[segment.role];
  context.lineWidth = segment.role === 'normal' ? 1.5 : 2.25;
  context.setLineDash(segment.role === 'miss' ? [5, 4] : []);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  if (segment.role !== 'normal') arrow(context, start, end);
  context.restore();
  if (!segment.label) return [];
  const along = segment.role === 'normal' ? 0.85 : 0.55;
  return [{
    x: start.x + (end.x - start.x) * along + 8,
    y: start.y + (end.y - start.y) * along - 12,
    text: segment.label,
  }];
}

function drawMark(
  context: CanvasRenderingContext2D,
  map: (point: PlanMark['at']) => { x: number; y: number },
  mark: PlanMark,
  width: number,
  height: number,
): { x: number; y: number; text: string } {
  const mapped = map(mark.at);
  const farther = mark.role === 'light' && outside(mapped, width, height, 20);
  const point = farther ? clampPoint(mapped, width, height, 20) : mapped;
  context.save();
  context.lineWidth = 1.5;
  context.strokeStyle = '#f4fbff';
  context.fillStyle = mark.role === 'blocker' ? '#ffb4b4' : mark.role === 'light' ? '#fff1b0' : '#ffd98a';
  if (mark.role === 'light') {
    diamond(context, point.x, point.y, 6);
    context.fill();
  } else if (mark.role === 'blocker') {
    cross(context, point.x, point.y, 6);
    context.stroke();
  } else if (mark.role === 'camera') {
    circle(context, point.x, point.y, 5);
    context.stroke();
  } else {
    circle(context, point.x, point.y, 4);
    context.fill();
  }
  context.restore();
  const text = farther ? 'light, farther' : mark.label;
  return { x: point.x + 10, y: point.y - (mark.role === 'blocker' ? -16 : 12), text };
}

function separateLabels(
  context: CanvasRenderingContext2D,
  labels: { x: number; y: number; text: string }[],
  width: number,
  height: number,
): void {
  const plate = { x: 8, y: 8, width: 96, height: 70 };
  for (const label of labels) {
    const textWidth = context.measureText(label.text).width;
    label.x = Math.max(4, Math.min(label.x, width - textWidth - 4));
    label.y = Math.max(10, Math.min(label.y, height - 8));
    const hitsPlate = label.x < plate.x + plate.width
      && label.x + textWidth > plate.x
      && label.y + 8 > plate.y
      && label.y - 8 < plate.y + plate.height;
    if (!hitsPlate) continue;
    const shifted = plate.x + plate.width + 6;
    if (shifted + textWidth <= width - 4) label.x = shifted;
    else label.y = Math.min(height - 8, plate.y + plate.height + 14);
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < labels.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = labels[i];
        const b = labels[j];
        const aw = context.measureText(a.text).width;
        const bw = context.measureText(b.text).width;
        const overlaps = Math.abs(a.y - b.y) < 14 && a.x < b.x + bw + 6 && b.x < a.x + aw + 6;
        if (overlaps) a.y = Math.min(height - 8, a.y + 14);
      }
    }
  }
}

function outside(point: { x: number; y: number }, width: number, height: number, margin: number): boolean {
  return point.x < margin || point.y < margin || point.x > width - margin || point.y > height - margin;
}

function clampPoint(point: { x: number; y: number }, width: number, height: number, margin: number): { x: number; y: number } {
  return {
    x: Math.min(width - margin, Math.max(margin, point.x)),
    y: Math.min(height - margin, Math.max(margin, point.y)),
  };
}

function clipToRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  margin: number,
): { x: number; y: number } {
  if (!outside(end, width, height, margin)) return end;
  const minX = margin;
  const minY = margin;
  const maxX = width - margin;
  const maxY = height - margin;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [start.x - minX, maxX - start.x, start.y - minY, maxY - start.y];
  let enter = 0;
  let leave = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return clampPoint(end, width, height, margin);
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
  }
  if (enter > leave) return clampPoint(end, width, height, margin);
  return { x: start.x + leave * dx, y: start.y + leave * dy };
}

function drawAxes(context: CanvasRenderingContext2D, x: number, y: number): void {
  const height = project([0, 1, 0]);
  const depth = project([0, 0, 1]);
  const heightLength = Math.hypot(height.x, height.y) || 1;
  const depthLength = Math.hypot(depth.x, depth.y) || 1;
  context.save();
  context.strokeStyle = '#d5dee8';
  context.fillStyle = '#d5dee8';
  context.lineWidth = 1.25;
  context.setLineDash([]);
  context.font = '11px system-ui, sans-serif';
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  axis(context, x, y, x + 30, y, '+X', 2, 12);
  axis(context, x, y, x + height.x / heightLength * 32, y - height.y / heightLength * 32, '+Y', 4, -2);
  axis(context, x, y, x + depth.x / depthLength * 26, y - depth.y / depthLength * 26, '+Z', -22, -2);
  context.restore();
}

function axis(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  label: string,
  labelX: number,
  labelY: number,
): void {
  context.beginPath();
  context.moveTo(x0, y0);
  context.lineTo(x1, y1);
  context.stroke();
  arrow(context, { x: x0, y: y0 }, { x: x1, y: y1 });
  context.fillText(label, x1 + labelX, y1 + labelY);
}

function arrow(context: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 10) return;
  const angle = Math.atan2(dy, dx);
  const size = 8;
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - size * Math.cos(angle - 0.4), end.y - size * Math.sin(angle - 0.4));
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - size * Math.cos(angle + 0.4), end.y - size * Math.sin(angle + 0.4));
  context.stroke();
}

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
}

function diamond(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x + radius, y);
  context.lineTo(x, y + radius);
  context.lineTo(x - radius, y);
  context.closePath();
}

function cross(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  context.beginPath();
  context.moveTo(x - radius, y - radius);
  context.lineTo(x + radius, y + radius);
  context.moveTo(x + radius, y - radius);
  context.lineTo(x - radius, y + radius);
}

function halo(context: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(8, 12, 18, 0.92)';
  context.strokeText(text, x, y);
  context.fillStyle = '#f4fbff';
  context.fillText(text, x, y);
}

function writeMessage(context: CanvasRenderingContext2D, message: string, width: number, height: number): void {
  context.save();
  context.font = '15px system-ui, sans-serif';
  context.fillStyle = '#d5dee8';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const lines = wrap(context, message, width - 32);
  lines.forEach((line, index) => {
    context.fillText(line, width / 2, height / 2 + (index - (lines.length - 1) / 2) * 20);
  });
  context.restore();
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
