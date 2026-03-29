import { ShellProvisioner } from "./provisioner";
import { PortRegistry } from "./port-registry";

const CONFIG_PATH = "/home/hfsp/.openclaw/openclaw.json";
const SECRETS_PATH = "/home/hfsp/.openclaw/secrets";
const IMAGE = "hfsp-openclaw-runtime:local";

async function main() {
  const registry = new PortRegistry();
  const provisioner = new ShellProvisioner(registry);

  const tenantA = `ta_${Date.now()}`;
  const tenantB = `tb_${Date.now() + 1}`;

  console.log("[test] provisioning two tenants in parallel...");

  const [resultA, resultB] = await Promise.all([
    provisioner.provision({
      tenantId: tenantA,
      image: IMAGE,
      surface: "telegram",
      containerName: `hfsp_${tenantA}`,
      workspacePath: `/tmp/ws_${tenantA}`,
      secretsPath: SECRETS_PATH,
      configPath: CONFIG_PATH,
    }),
    provisioner.provision({
      tenantId: tenantB,
      image: IMAGE,
      surface: "telegram",
      containerName: `hfsp_${tenantB}`,
      workspacePath: `/tmp/ws_${tenantB}`,
      secretsPath: SECRETS_PATH,
      configPath: CONFIG_PATH,
    }),
  ]);

  console.log("\n=== Tenant A ===");
  console.log(JSON.stringify(resultA, null, 2));
  console.log("\n=== Tenant B ===");
  console.log(JSON.stringify(resultB, null, 2));

  const portsUnique = resultA.gatewayPort !== resultB.gatewayPort;
  console.log(`\n[test] ports unique: ${portsUnique} (${resultA.gatewayPort} vs ${resultB.gatewayPort})`);

  console.log("\n[test] registry state:");
  console.log(JSON.stringify(registry.list(), null, 2));

  console.log("\n[test] cleaning up...");
  await Promise.all([
    provisioner.stop(tenantA).then(() => provisioner.remove(tenantA)),
    provisioner.stop(tenantB).then(() => provisioner.remove(tenantB)),
  ]);

  console.log("[test] registry after cleanup:");
  console.log(JSON.stringify(registry.list(), null, 2));
  console.log("[test] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
