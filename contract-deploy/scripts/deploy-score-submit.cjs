const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ScoreSubmit with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CELO");

  const ScoreSubmit = await hre.ethers.getContractFactory("ScoreSubmit");
  const contract = await ScoreSubmit.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const fee = await contract.fee();

  console.log("ScoreSubmit deployed to:", address);
  console.log("Submission fee (6 decimals):", fee.toString(), "($0.05)");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "ScoreSubmit",
    network: "celo-mainnet",
    chainId: 42220,
    address,
    fee: fee.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
  };

  writeFileSync(
    join(outDir, "score-submit-celo-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Deployment saved to deployments/score-submit-celo-mainnet.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
