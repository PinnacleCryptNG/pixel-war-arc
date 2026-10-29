import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerEntitySecretCiphertext, initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error("ERROR: CIRCLE_API_KEY not set in environment");
    process.exit(1);
  }

  // 1. Generate a fresh 32-byte secret (never printed to stdout)
  const entitySecret = crypto.randomBytes(32).toString("hex");

  // 2. Ensure recovery dir exists under /home/user/app (user-downloadable)
  const recoveryDir = "/home/user/app/.circle";
  fs.mkdirSync(recoveryDir, { recursive: true });

  // 3. Register the ciphertext with Circle
  console.log("Registering entity secret ciphertext with Circle...");
  const response = await registerEntitySecretCiphertext({
    apiKey,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir,
  });

  // 4. Persist the recovery file
  const recoveryPath = path.join(recoveryDir, "recovery_file.dat");
  if (response.data?.recoveryFile) {
    fs.writeFileSync(recoveryPath, response.data.recoveryFile);
    console.log("Recovery file written to:", recoveryPath);
  } else {
    console.log("Recovery file written by SDK to:", recoveryDir);
  }

  // 5. Append secret to .env
  const envPath = "/home/user/app/.env";
  fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, "utf-8");
  console.log("CIRCLE_ENTITY_SECRET written to .env");

  // 6. Verify registration with a read-only call
  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  try {
    await client.listWalletSets({ pageSize: 1 });
    console.log("VERIFICATION: Entity secret registered and confirmed OK");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("VERIFICATION FAILED:", msg);
    process.exit(1);
  }

  console.log("SUCCESS: Entity secret registration complete.");
  console.log("RECOVERY_PATH:" + recoveryPath);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Registration failed:", msg);
  process.exit(1);
});
