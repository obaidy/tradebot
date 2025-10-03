import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    TradingView?: any;
  }
}

const SCRIPT_ID = 'tradingview-widget-script';

type TradingViewWidgetProps = {
  symbol: string;
  interval?: string;
  theme?: 'light' | 'dark';
  height?: number;
};

export function TradingViewWidget({ symbol, interval = '60', theme = 'dark', height = 420 }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    const containerEl = containerRef.current;

    const initialize = () => {
      if (!containerEl) return;
      containerEl.innerHTML = '';
      if (window.TradingView?.widget) {
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: 'Etc/UTC',
          theme,
          style: '1',
          locale: 'en',
          toolbar_bg: 'rgba(0,0,0,0)',
          enable_publishing: false,
          hide_legend: false,
          hide_side_toolbar: false,
          container_id: containerEl.id,
          studies: ['STD;MACD'],
          withdateranges: true,
        });
      }
    };

    if (window.TradingView && window.TradingView.widget) {
      initialize();
      return;
    }

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      const handleLoad = () => initialize();
      existingScript.addEventListener('load', handleLoad, { once: true });
      return () => existingScript.removeEventListener('load', handleLoad);
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = initialize;
    document.body.appendChild(script);

    return () => {
      script.onload = null;
      if (containerEl) {
        containerEl.innerHTML = '';
      }
    };
  }, [symbol, interval, theme]);

  return <div id={`tv-widget-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`} ref={containerRef} style={{ width: '100%', height }} />;
}
