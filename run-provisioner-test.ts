const { ShellProvisioner } = require('./provisioner.ts');

async function main() {
  const p = new ShellProvisioner();
  const tenantId = 'test-tenant-001';
  const containerName = 'hfsp_test_tenant_001';

  const res = await p.provision({
    tenantId,
    image: 'hfsp-openclaw-runtime:local',
    surface: 'telegram',
    containerName,
    workspacePath: '/opt/hfsp/test-tenants/test-tenant-001/workspace',
    secretsPath: '/opt/hfsp/test-tenants/test-tenant-001/secrets',
    env: { HOME: '/home/hfsp', TEST_MODE: '1' },
    healthCheckCmd: 'HOME=/home/hfsp openclaw channels status --probe',
    healthCheckUser: 'hfsp',
  });

  console.log(JSON.stringify(res, null, 2));
  console.log(JSON.stringify(await p.status(tenantId), null, 2));

  await p.stop(tenantId);
  await p.remove(tenantId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
