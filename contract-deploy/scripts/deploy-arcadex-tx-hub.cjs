const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ArcadeXTxHub with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CELO");

  const ArcadeXTxHub = await hre.ethers.getContractFactory("ArcadeXTxHub");
  const contract = await ArcadeXTxHub.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const owner = await contract.owner();

  console.log("ArcadeXTxHub deployed to:", address);
  console.log("Owner:", owner);

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "ArcadeXTxHub",
    network: "celo-mainnet",
    chainId: 42220,
    address,
    owner,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
    notes:
      "General MiniPay hub: signIn(purpose) free; payWithUSDT/USDC(purpose) after setFee.",
  };

  writeFileSync(
    join(outDir, "arcadex-tx-hub-celo-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Deployment saved to deployments/arcadex-tx-hub-celo-mainnet.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
