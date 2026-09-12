const fs = require("fs");
const path = require("path");
const https = require("https");

const ADDRESS = "0x2a9f38b41035a900d5038D1972955011fb3278E7";
const CHAIN_ID = 42220;
const TX_HASH =
  "0x7a9f03c05425a05f12025849574f27f9f78140e16b99a48d1abd187a173691c8";
const BUILD_INFO = path.resolve(
  __dirname,
  "../artifacts/build-info/00b5b87980d36aac0ec2f276e2557635.json"
);

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const apiKey =
  process.env.ETHERSCAN_API_KEY || process.env.CELOSCAN_API_KEY || "";

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Invalid JSON: ${raw}`));
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadBuildInfo() {
  return JSON.parse(fs.readFileSync(BUILD_INFO, "utf8"));
}

async function verifyOnSourcify() {
  const buildInfo = loadBuildInfo();
  const payload = {
    stdJsonInput: buildInfo.input,
    compilerVersion: buildInfo.solcLongVersion,
    contractIdentifier: "contracts/InfiniteSpark.sol:InfiniteSpark",
    creationTransactionHash: TX_HASH,
  };

  const submit = await postJson(
    `https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${ADDRESS}`,
    payload
  );

  if (submit.status !== 200 && submit.status !== 202) {
    if (submit.status === 409 && submit.body?.customCode === "already_verified") {
      console.log("Already verified on Sourcify.");
      return true;
    }
    throw new Error(
      `Sourcify submit failed (${submit.status}): ${JSON.stringify(submit.body)}`
    );
  }

  const verificationId = submit.body.verificationId;
  if (!verificationId) {
    if (submit.body.error) {
      throw new Error(`Sourcify error: ${submit.body.error}`);
    }
    throw new Error(`Unexpected Sourcify response: ${JSON.stringify(submit.body)}`);
  }

  console.log("Sourcify job:", verificationId);

  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const status = await getJson(
      `https://sourcify.dev/server/v2/verify/${verificationId}`
    );

    const match = status.contract?.match;
    console.log("Sourcify status:", status.status || match || status);

    if (match === "perfect" || match === "partial") {
      console.log("Verified on Sourcify.");
      return true;
    }

    if (status.status === "failed") {
      throw new Error(JSON.stringify(status));
    }
  }

  throw new Error("Sourcify verification timed out");
}

async function verifyOnCeloscan() {
  if (!apiKey) {
    return false;
  }

  const buildInfo = loadBuildInfo();
  const compilerVersion = buildInfo.solcLongVersion.startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;

  const params = new URLSearchParams({
    apikey: apiKey,
    chainid: String(CHAIN_ID),
    module: "contract",
    action: "verifysourcecode",
    contractaddress: ADDRESS,
    sourceCode: JSON.stringify(buildInfo.input),
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/InfiniteSpark.sol:InfiniteSpark",
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: "",
  });

  const submit = await getJson(
    `https://api.etherscan.io/v2/api?${params.toString()}`
  );

  if (submit.status !== "1") {
    throw new Error(
      `Celoscan submit failed: ${submit.message || JSON.stringify(submit)}`
    );
  }

  const guid = submit.result;
  console.log("Celoscan GUID:", guid);

  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const status = await getJson(
      `https://api.etherscan.io/v2/api?` +
        new URLSearchParams({
          apikey: apiKey,
          chainid: String(CHAIN_ID),
          module: "contract",
          action: "checkverifystatus",
          guid,
        }).toString()
    );

    console.log("Celoscan status:", status.result || status.message);

    if (status.status === "1") {
      console.log(
        "Verified on Celoscan:",
        `https://celoscan.io/address/${ADDRESS}#code`
      );
      return true;
    }

    if (
      status.result &&
      !String(status.result).toLowerCase().includes("pending") &&
      String(status.result).toLowerCase().includes("fail")
    ) {
      throw new Error(status.result);
    }
  }

  throw new Error("Celoscan verification timed out");
}

async function checkCeloscanVerified() {
  const res = await getJson(
    `https://api.etherscan.io/v2/api?` +
      new URLSearchParams({
        chainid: String(CHAIN_ID),
        module: "contract",
        action: "getabi",
        address: ADDRESS,
        ...(apiKey ? { apikey: apiKey } : {}),
      }).toString()
  );

  return res.status === "1" && res.result && res.result !== "Contract source code not verified";
}

async function main() {
  if (await checkCeloscanVerified()) {
    console.log("Already verified on Celoscan:", `https://celoscan.io/address/${ADDRESS}#code`);
    return;
  }

  if (apiKey) {
    const celoscanOk = await verifyOnCeloscan();
    if (celoscanOk) return;
  } else {
    console.log("No ETHERSCAN_API_KEY — trying Sourcify, then Celoscan manual step.");
  }

  await verifyOnSourcify();

  if (!apiKey) {
    console.log("");
    console.log("Sourcify verification complete.");
    console.log(
      "For Celoscan (required for MiniPay), add ETHERSCAN_API_KEY to .env and run:"
    );
    console.log("  cd contract-deploy && npm run verify");
    console.log("Get a free key at https://etherscan.io/myapikey");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
