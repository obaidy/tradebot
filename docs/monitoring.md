# Monitoring Guide

The analytics and risk engines export several Prometheus metrics that you can surface in Grafana, Datadog, or Render’s built-in monitoring. Key gauges:

| Metric | Labels | Description |
| --- | --- | --- |
| `analytics_sharpe_ratio` | `client_id` | Sharpe ratio (risk-adjusted returns) over the recent lookback window. |
| `analytics_max_drawdown_usd` | `client_id` | Maximum drawdown (negative P&L) observed in the lookback window. |
| `analytics_win_rate` | `client_id` | Fraction of winning runs. |
| `analytics_avg_slippage_bps` | `client_id` | Average slippage in basis points. |
| `analytics_fill_rate_pct` | `client_id` | Percentage of orders that fully filled. |
| `risk_value_at_risk_usd` | `client_id`, `pair` | VaR computed by the risk engine for the active run. |
| `risk_stress_loss_usd` | `client_id`, `pair` | Worst-case loss from configured stress scenarios. |
| `risk_kelly_fraction` | `client_id`, `pair` | Kelly sizing fraction applied to position sizing. |
| `intelligence_composite_score` | `client_id`, `pair` | Composite signal from the intelligence engine (volatility + sentiment + on-chain). |
| `intelligence_risk_bias` | `client_id`, `pair` | Suggested risk stance: 1 increase / 0 neutral / -1 reduce. |
| `intelligence_garch_volatility` | `client_id`, `pair` | GARCH-style volatility estimate. |
| `intelligence_per_trade_usd` | `client_id`, `pair` | Per-trade USD allocation recommended by intelligence engine. |
| `intelligence_take_profit_pct` | `client_id`, `pair` | Recommended take-profit percentage. |

### Example PromQL

```
analytics_sharpe_ratio{client_id="default"}
risk_value_at_risk_usd{client_id="default", pair="BTC/USDT"}
intelligence_composite_score{client_id="default"}
```

### Alert Recommendations

- **Drawdown protection**: alert when `risk_stress_loss_usd` exceeds your tolerance or when `analytics_max_drawdown_usd` breaches thresholds.
- **Execution quality**: track `analytics_avg_slippage_bps` and `analytics_fill_rate_pct` trends; create alerts if slippage spikes or fill rate drops.
- **Signal validation**: monitor `intelligence_composite_score` / `intelligence_risk_bias` alongside actual P&L to tune ML adjustments.

Expose `/metrics` via the existing Prometheus server (`METRICS_PORT`, default `9100`) and add the above expressions to your dashboard of choice. Update Render’s environment to include `ADMIN_API_TOKEN` and the new `RISK_*` variables so analytics endpoints can authenticate and produce complete data.

### Order Routing Audit Trail

Each FIX or prime-broker order now triggers an `order_routing_log` info event. The log payload includes the adapter id, venue (`fix` or `prime`), symbol, side, quantity, and sanitized metadata such as the client order id or desk identifier. Forward these logs to your SIEM/compliance destination or persist them via the admin API to maintain an auditable trail of routed orders.
