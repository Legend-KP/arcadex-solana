require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const privateKey = process.env.PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    celo: {
      url: "https://forno.celo.org",
      chainId: 42220,
      accounts: privateKey ? [`0x${privateKey.replace(/^0x/, "")}`] : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.CELOSCAN_API_KEY || "",
  },
  sourcify: {
    enabled: false,
  },
};
