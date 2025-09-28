# MEV Wallet Onboarding

To enable live MEV runs, every client provides and funds their own Flashbots signing key. The key never leaves your dedicated runner.

1. Generate a new Ethereum private key locally (MetaMask "Create Account", `ethers.Wallet.createRandom()`, or hardware wallet). Keep the seed secure.
2. In the TradeBot portal, visit **Bot lineup → MEV Arb Bot** and click **Add key**. Paste the private key; it is encrypted with your master key and stored per client.
3. The dashboard shows the derived address. Transfer ETH from any wallet/exchange to this address to cover gas and bundles. Aim for >0.05 ETH to start.
4. The portal monitors balance; if it drops below ~0.02 ETH you’ll see a warning. Top up before launching live runs.
5. Rotate or remove the key anytime via **Rotate key** or **Remove**. After rotating, fund the new address before restarting jobs.
6. For enterprise custody, coordinate with TradeBot support to set up managed key rotation if required.

During production, every MEV run decrypts the key inside your runner, builds the Flashbots bundle, and signs it directly. No other service sees the private key.
