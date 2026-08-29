import {
  ExclusiveOperatorLockV1,
  GovernanceJournalV1,
} from "../upgradeGovernance/operator.ts";

function requiredEnvironmentPath(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must name an explicit local ceremony file`);
  }
  return value;
}

function localRpcUrl() {
  const value = process.env.AMOEBA_LOCAL_CEREMONY_RPC;
  if (value === undefined || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(value)) {
    throw new Error("AMOEBA_LOCAL_CEREMONY_RPC must be an explicit loopback HTTP endpoint");
  }
  return value;
}

async function rpc(method, params = []) {
  const response = await fetch(localRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`local ceremony RPC ${method} returned HTTP ${response.status}`);
  const decoded = await response.json();
  if (decoded === null || typeof decoded !== "object" || decoded.error !== undefined) {
    throw new Error(`local ceremony RPC ${method} failed`);
  }
  return decoded.result;
}

function unavailable(capability) {
  return async () => {
    throw new Error(`${capability} is unavailable in the read-only local ceremony verifier`);
  };
}

export function createUpgradeGovernanceCliAdaptersV1() {
  return {
    readAdapter: {
      async getGenesisHash() {
        const genesis = await rpc("getGenesisHash");
        if (typeof genesis !== "string" || genesis.length === 0) {
          throw new Error("local ceremony RPC returned an invalid genesis hash");
        }
        return genesis;
      },
      rereadPlanBindings: unavailable("plan-binding reread"),
      observeAccounts: unavailable("account observation"),
    },
    receiptFinalizedSourceReader: {
      readFinalizedFrozenHistory: unavailable("receipt-v3 history read"),
      readFinalizedAccountSnapshots: unavailable("receipt-v3 account read"),
      readFinalizedOldAuthorityRejection: unavailable("receipt-v3 authority read"),
    },
    planner: { plan: unavailable("mutation planning") },
    createPlanningSafety() {
      return {
        journal: new GovernanceJournalV1(requiredEnvironmentPath("AMOEBA_LOCAL_CEREMONY_JOURNAL")),
        lock: new ExclusiveOperatorLockV1(requiredEnvironmentPath("AMOEBA_LOCAL_CEREMONY_LOCK")),
      };
    },
    createMutationDependencies: unavailable("mutation execution"),
  };
}
