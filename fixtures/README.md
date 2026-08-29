# Cross-language fixture generation

`release1_ceremony_accounts_v1.json` is generated from the authoritative Rust
account structs, digest functions, and PDA derivations. From the repository
root mounted in WSL Ubuntu 22.04, regenerate it with:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo test -p upgrade_controller --lib release1_ceremony_state::tests::regenerate_release1_ceremony_fixture -- --exact --ignored
```

Run the Rust consumer from that same WSL shell:

```bash
cargo test -p upgrade_controller --test release1_ceremony_golden
```

Then run the TypeScript consumer from the repository root in PowerShell:

```powershell
Set-Location clients/ts
node --import tsx --test upgradeGovernance/release1CeremonyGolden.test.ts
```
