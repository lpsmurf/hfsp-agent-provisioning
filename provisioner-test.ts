import { ShellProvisioner } from "./provisioner";

async function main() {
  const tenantId = `test_${Date.now()}`;
  const provisioner = new ShellProvisioner();

  console.log(`[test] provisioning tenant: ${tenantId}`);

  const result = await provisioner.provision({
    tenantId,
    image: "hfsp-openclaw-runtime:local",
    surface: "telegram",
    containerName: `hfsp_${tenantId}`,
    workspacePath: `/tmp/hfsp-workspace-${tenantId}`,
    secretsPath: `/home/hfsp/.openclaw/secrets`,
    configPath: `/home/hfsp/.openclaw/openclaw.json`,
    gatewayPort: 18790,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    const status = await provisioner.status(tenantId);
    console.log(JSON.stringify({ status }, null, 2));
  }

  console.log("[test] cleaning up...");
  await provisioner.stop(tenantId);
  await provisioner.remove(tenantId);
  console.log("[test] done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
