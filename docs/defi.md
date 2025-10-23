# DeFi Integration Roadmap

The on-chain modules (DEX aggregation, yield farming, flash-loan arbitrage, cross-chain arbitrage, NFT market making) are **not yet production-ready**. They remain in development while we finish real integrations, harden risk controls, and expand test coverage.

What’s available today:

- Shared abstractions (`DexAggregationService`, `CrossExchangeArbitrageEngine`, etc.) and placeholder strategies inside the repository.
- Environment variable scaffolding so we can wire real providers once implementation work is complete.

What still needs to happen before we expose these bots to end users:

1. **Real liquidity adapters** – replace the stubs with live integrations (1inch/ParaSwap quoting, contract calls for DEX swaps, bridge SDKs, flash-loan providers, NFT marketplace APIs).
2. **Risk envelopes** – extend guard rails (position sizing, slippage, on-chain failure handling) to match what we already enforce on the CEX grid bot.
3. **Observability** – add tracing and metrics so on-chain execution is as observable as exchange runs.
4. **Compliance review** – confirm KYC/AML implications, token coverage, and jurisdictional constraints.

Until those pieces land, these strategies are hidden in the client portal and should be treated as internal R&D. Refer back once the integrations ship for step-by-step configuration guidance.
