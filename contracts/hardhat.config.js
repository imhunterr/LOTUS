require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Offline / firewalled machines: `LOTUS_SOLCJS=1 npx hardhat compile` uses the bundled solc-js
// instead of downloading the native compiler from binaries.soliditylang.org.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (process.env.LOTUS_SOLCJS && args.solcVersion === "0.8.24") {
    const solc = require("solc");
    return { compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true, version: args.solcVersion, longVersion: solc.version() };
  }
  return runSuper();
});

const { AMOY_RPC_URL, DEPLOYER_KEY, POLYGONSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: false },
    localhost: { url: "http://127.0.0.1:8545" },
    ...(AMOY_RPC_URL && DEPLOYER_KEY
      ? { amoy: { url: AMOY_RPC_URL, accounts: [DEPLOYER_KEY], chainId: 80002 } }
      : {}),
  },
  etherscan: { apiKey: { polygonAmoy: POLYGONSCAN_API_KEY || "" } },
  gasReporter: { enabled: !!process.env.REPORT_GAS, currency: "USD" },
};
