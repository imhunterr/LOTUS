// Brownie owns deployment/tests; Hardhat supplies an isolated local EVM RPC only.
module.exports = { networks: { hardhat: { chainId: 31337, initialBaseFeePerGas: 0, blockGasLimit: 15000000 } } };
