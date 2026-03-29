import { ShellProvisioner } from "../src/provisioner";
import { PortRegistry } from "../src/port-registry";
import { NginxManager } from "../src/nginx-manager";

const CONFIG_PATH = "/home/hfsp/.openclaw/openclaw.json";
const SECRETS_PATH = "/home/hfsp/.openclaw/secrets";
const IMAGE = "hfsp-openclaw-runtime:local";

async function main() {
  const registry = new PortRegistry();
  const nginx = new NginxManager();
  const provisioner = new ShellProvisioner(registry, nginx);

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

  console.log(`\n[test] ports unique: ${resultA.gatewayPort !== resultB.gatewayPort}`);
  console.log(`[test] public URLs:`);
  console.log(`  A: ${resultA.publicUrl}`);
  console.log(`  B: ${resultB.publicUrl}`);

  console.log("\n[test] nginx conf files:");
  const { execSync } = await import("node:child_process");
  console.log(execSync("ls -la /etc/nginx/conf.d/hfsp-tenants/").toString());

  console.log("[test] cleaning up...");
  await Promise.all([
    provisioner.stop(tenantA).then(() => provisioner.remove(tenantA)),
    provisioner.stop(tenantB).then(() => provisioner.remove(tenantB)),
  ]);

  console.log("[test] nginx conf files after cleanup:");
  console.log(execSync("ls /etc/nginx/conf.d/hfsp-tenants/").toString().trim() || "(empty)");
  console.log("[test] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
