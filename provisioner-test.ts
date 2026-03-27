import { ShellProvisioner } from './provisioner';

async function main() {
  const tenantId = `test_${Date.now()}`;
  const provisioner = new ShellProvisioner();

  const result = await provisioner.provision({
    tenantId,
    image: 'hfsp-openclaw-runtime:local',
    surface: 'telegram',
    containerName: `hfsp_${tenantId}`,
    workspacePath: '/tmp/hfsp-workspace',
    secretsPath: '/tmp/hfsp-secrets',
    env: {
      HOME: '/home/hfsp',
      TEST_MODE: '1',
    },
    healthCheckCmd: 'HOME=/home/hfsp openclaw channels status --probe',
  });

  console.log(JSON.stringify(result, null, 2));

  const status = await provisioner.status(tenantId);
  console.log(JSON.stringify({ status }, null, 2));

  await provisioner.stop(tenantId);
  await provisioner.remove(tenantId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
