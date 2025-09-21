import { memo, useEffect, useRef } from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  animated?: boolean;
}

export const Sparkline = memo(function Sparkline({
  data,
  width = 160,
  height = 60,
  stroke = 'rgba(14,165,233,0.9)',
  fill = 'rgba(14,165,233,0.18)',
  animated = false,
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const min = Math.min(...data, 0);
      const max = Math.max(...data, 1);
      const range = max - min || 1;
      const padding = 6;
      const points = data.map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const normalized = (value - min) / range;
        const jitter = animated ? Math.sin(Date.now() / 800 + index / 4) * 0.4 : 0;
        const y = height - padding - normalized * (height - padding * 2) + jitter;
        return { x, y };
      });

      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();

      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      if (animated) {
        animationRef.current = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [data, width, height, stroke, fill, animated]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', filter: 'drop-shadow(0 8px 18px rgba(14,165,233,0.2))' }}
    />
  );
});
