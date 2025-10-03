# DeFi Integration Overview

The DeFi toolchain unlocks on-chain execution across five modules:

| Component | Description | Key Env Vars |
| --- | --- | --- |
| DEX aggregation | Routes swaps through 1inch / ParaSwap and selects the best quote. | `ONEINCH_API_KEY`, `PARASWAP_API_KEY`, `DEX_CHAIN_ID`, `DEX_TOKEN_IN`, `DEX_TOKEN_OUT`, `DEX_AMOUNT_IN`, `DEX_SLIPPAGE_BPS` |
| Yield farming | Deploys capital into a target liquidity pool and optionally compounds rewards. | `YIELD_PROTOCOL`, `YIELD_POOL_ADDRESS`, `YIELD_CHAIN_ID`, `YIELD_TOKEN_IN`, `YIELD_AMOUNT`, `YIELD_COMPOUND` |
| Flash-loan arbitrage | Scans centralized venues for spreads and executes with flash liquidity. | `FLASH_LOAN_PROVIDER`, `FLASH_LOAN_MAX_BORROW_USD`, `FLASH_LOAN_SYMBOLS`, `FLASH_LOAN_MIN_SPREAD_PCT` |
| Cross-chain arbitrage | Evaluates bridge routes and net profitability across multiple chains. | `CROSS_CHAIN_BRIDGES`, `CROSS_CHAIN_SOURCE_ID`, `CROSS_CHAIN_DEST_ID`, `CROSS_CHAIN_MIN_PROFIT_USD` |
| NFT market making | Tracks high-volume collections for listing/bid spreads. | `NFT_MARKET_VENUES`, `NFT_COLLECTION_SLUG`, `NFT_MAX_BID_USD`, `NFT_DESIRED_SPREAD_BPS` |

## How it works

- **Adapters & Services** – `DexAggregationService` orchestrates 1inch / ParaSwap clients, while dedicated managers handle yield positions, flash loans, bridge evaluation, and NFT venue polling.
- **Strategies** – Each domain maps to a standalone strategy (`dex-aggregation`, `yield-farming`, `flash-loan-arb`, `cross-chain-arb`, `nft-market-maker`) registered in the strategy catalog and gated to Pro plans.
- **Risk & Logging** – Execution reuses the existing telemetry stack (`logger`, audit logs) so all trades show up alongside CEX activity. Flash-loan and arbitrage strategies lean on the shared `CrossExchangeArbitrageEngine` for quote discovery.

## Configuration checklist

1. **Populate API keys** for at least one DEX aggregator (1inch or ParaSwap). Without a key the aggregation strategy remains inactive.
2. **Select liquidity venues** by defining pool addresses and target chains for yield deployments.
3. **Whitelist bridges** the cross-chain engine may use via `CROSS_CHAIN_BRIDGES` JSON (include fees/duration).
4. **Set flash-loan guardrails** – max borrow size, spread threshold, supported symbols. The engine blocks trades that breach limits.
5. **Map NFT venues** – supply marketplace metadata and collection slug to focus liquidity.

## Per-client overrides

Every strategy merges environment defaults with the per-client `config` payload, so Pro members can inject custom RPC URLs, pool choices, or venue lists via the portal without exposing your house credentials.

Refer to `.env.example` for sample values and add secrets to the backend Render services (never the portal frontend).
