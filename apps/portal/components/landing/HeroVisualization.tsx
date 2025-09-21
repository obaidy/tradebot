import { useEffect, useRef } from 'react';

const WIDTH = 520;
const HEIGHT = 320;

function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  const spacing = 40;
  for (let x = 0; x <= WIDTH; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
}

interface HeroVisualizationProps {
  points?: number[];
}

export function HeroVisualization({ points: externalPoints }: HeroVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>();
  const pointsRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    drawGrid(ctx);

    const hydratePoints = () => {
      if (externalPoints && externalPoints.length > 4) {
        const normalized = externalPoints.map((value, index) => {
          const max = Math.max(...externalPoints, 1);
          const min = Math.min(...externalPoints, 0);
          const range = max - min || 1;
          const normalizedValue = (value - min) / range;
          const padding = 40;
          return HEIGHT - padding - normalizedValue * (HEIGHT - padding * 2) + Math.sin(index / 5) * 3;
        });
        pointsRef.current = normalized;
        return;
      }
      const points = [];
      const base = HEIGHT * 0.5;
      let current = base;
      for (let i = 0; i < 90; i += 1) {
        current += Math.sin(i / 5) * 4 + (Math.random() - 0.5) * 10;
        current = Math.min(HEIGHT - 40, Math.max(40, current));
        points.push(current);
      }
      pointsRef.current = points;
    };

    const render = () => {
      if (!ctx) return;
      drawGrid(ctx);

      const points = pointsRef.current;
      const gradient = ctx.createLinearGradient(0, HEIGHT, WIDTH, 0);
      gradient.addColorStop(0, 'rgba(14,165,233,0.4)');
      gradient.addColorStop(0.5, 'rgba(99,102,241,0.35)');
      gradient.addColorStop(1, 'rgba(236,72,153,0.4)');

      ctx.lineWidth = 3;
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = (index / (points.length - 1)) * WIDTH;
        const eased = point + Math.sin(Date.now() / 600 + index / 6) * 4;
        if (index === 0) {
          ctx.moveTo(x, eased);
        } else {
          ctx.lineTo(x, eased);
        }
      });
      ctx.stroke();

      // fill under curve
      ctx.lineTo(WIDTH, HEIGHT);
      ctx.lineTo(0, HEIGHT);
      ctx.closePath();
      ctx.fillStyle = 'rgba(14, 165, 233, 0.12)';
      ctx.fill();

      // glowing orb
      const orbX = ((Date.now() / 40) % WIDTH) + 40;
      const orbYIndex = Math.floor((orbX / WIDTH) * (points.length - 1));
      const orbY = points[orbYIndex] ?? HEIGHT / 2;
      const radial = ctx.createRadialGradient(orbX, orbY, 0, orbX, orbY, 80);
      radial.addColorStop(0, 'rgba(34,211,238,0.55)');
      radial.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = radial;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 80, 0, Math.PI * 2);
      ctx.fill();

      animationRef.current = requestAnimationFrame(render);
    };

    hydratePoints();
    render();

    const interval = window.setInterval(hydratePoints, 6000);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      window.clearInterval(interval);
    };
  }, [externalPoints]);

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          maxWidth: WIDTH,
          borderRadius: '24px',
          border: '1px solid rgba(148,163,184,0.25)',
          background: 'rgba(8, 47, 73, 0.55)',
          boxShadow: '0 32px 60px rgba(14,165,233,0.25)',
        }}
      />
    </div>
  );
}
