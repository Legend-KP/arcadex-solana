const { writeFileSync, mkdirSync } = require("fs");
const { join, resolve } = require("path");
const hre = require("hardhat");

const SECONDS_PER_DAY = 24 * 60 * 60;
const CAMPAIGN_ID = 1;
const REQUIRED_DAYS = 7;
const REWARD_OFFCHAIN = 0;
const CAMPAIGN_TYPE_STREAK = 0;

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying ArcadeXRewards with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "CELO");

  // Pass deployer as initial eligibility signer (can rotate later). Zero skips gated campaigns.
  const ArcadeXRewards = await hre.ethers.getContractFactory("ArcadeXRewards");
  const contract = await ArcadeXRewards.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("ArcadeXRewards deployed to:", address);

  const rewardMeta = hre.ethers.id("INFINITE_SPARK_24H");
  const now = Math.floor(Date.now() / 1000);
  const startTime = now;
  const endTime = now + 365 * SECONDS_PER_DAY; // 1 year window; shorten via setCampaign later

  const tx = await contract.setCampaign(
    CAMPAIGN_ID,
    CAMPAIGN_TYPE_STREAK,
    true, // active
    REQUIRED_DAYS,
    SECONDS_PER_DAY,
    0, // maxClaims (N/A for off-chain)
    startTime,
    endTime,
    REWARD_OFFCHAIN,
    hre.ethers.ZeroAddress,
    0,
    rewardMeta,
    true, // resetAfterMilestone
    false, // requireEligibility — open for v1 Infinite Spark streak
    0 // maxSinglePayout (STREAK only; must be 0)
  );
  await tx.wait();

  console.log("Campaign", CAMPAIGN_ID, "configured (7-day OFFCHAIN Infinite Spark STREAK)");
  console.log("  startTime:", startTime);
  console.log("  endTime:", endTime);
  console.log("  requireEligibility: false");
  console.log("  campaignType: STREAK");

  const outDir = resolve(__dirname, "../../deployments");
  mkdirSync(outDir, { recursive: true });

  const deployment = {
    contract: "ArcadeXRewards",
    network: "celo-mainnet",
    chainId: 42220,
    address,
    campaignId: CAMPAIGN_ID,
    campaignType: "STREAK",
    requiredDays: REQUIRED_DAYS,
    minIntervalSeconds: SECONDS_PER_DAY,
    rewardMode: REWARD_OFFCHAIN,
    rewardMeta,
    resetAfterMilestone: true,
    requireEligibility: false,
    maxSinglePayout: 0,
    startTime,
    endTime,
    eligibilitySigner: deployer.address,
    spinResultSigner: hre.ethers.ZeroAddress,
    constructorArgs: [deployer.address],
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash ?? null,
    setCampaignTxHash: tx.hash,
  };

  writeFileSync(
    join(outDir, "arcadex-rewards-celo-mainnet.json"),
    JSON.stringify(deployment, null, 2)
  );

  console.log("Saved deployments/arcadex-rewards-celo-mainnet.json");
  console.log("Set NEXT_PUBLIC_ARCADEX_REWARDS_CONTRACT=" + address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
