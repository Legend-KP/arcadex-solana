const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying InfiniteSpark with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CELO");

  const InfiniteSpark = await hre.ethers.getContractFactory("InfiniteSpark");
  const contract = await InfiniteSpark.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const fee = await contract.fee();

  console.log("InfiniteSpark deployed to:", address);
  console.log("Entry fee (6 decimals):", fee.toString(), "($0.10)");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "InfiniteSpark",
    network: "celo-mainnet",
    chainId: 42220,
    address,
    fee: fee.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
  };

  writeFileSync(
    join(outDir, "infinite-spark-celo-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Deployment saved to deployments/infinite-spark-celo-mainnet.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
