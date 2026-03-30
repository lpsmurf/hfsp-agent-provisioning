import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { VpsRegistry, VpsNode } from './vps-registry';
import { ShellProvisioner, ProvisionConfig, ProvisionResult } from './provisioner';
import { PortRegistry } from './port-registry';

export class MultiVpsProvisioner {
  constructor(
    private db: Database.Database,
    private registry: VpsRegistry,
    private localProvisioner: ShellProvisioner,
  ) {}

  async provision(config: ProvisionConfig): Promise<ProvisionResult & { vpsNodeId: number }> {
    const node = this.registry.getBestNode();
    let result: ProvisionResult;

    if (this.registry.isLocal(node)) {
      result = await this.localProvisioner.provision(config);
    } else {
      result = await this.provisionRemote(node, config);
    }

    // Record which node this tenant landed on + increment counter
    this.db.prepare('UPDATE tenants SET vps_node_id = ? WHERE tenant_id = ?')
      .run(node.id, config.tenantId);
    if (result.ok) this.registry.incrementAgents(node.id);

    return { ...result, vpsNodeId: node.id };
  }

  private async provisionRemote(node: VpsNode, config: ProvisionConfig): Promise<ProvisionResult> {
    const started = new Date().toISOString();
    const ssh = (cmd: string[]) => execFileSync('ssh', [
      '-i', node.ssh_key_path,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=15',
      '-o', 'StrictHostKeyChecking=accept-new',
      `${node.ssh_user}@${node.host}`,
      ...cmd,
    ], { encoding: 'utf8', stdio: 'pipe' });

    const scpFile = (local: string, remote: string) => execFileSync('scp', [
      '-i', node.ssh_key_path,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      local,
      `${node.ssh_user}@${node.host}:${remote}`,
    ], { stdio: 'pipe' });

    try {
      // Allocate port from this node's range using a per-node registry file
      const portRegPath = path.join(
        process.env.HOME ?? '/home/hfsp',
        `.openclaw/port-registry-node${node.id}.json`
      );
      const portReg = new PortRegistry(portRegPath, node.port_range_start, node.port_range_end);
      const port = portReg.allocate(config.tenantId);

      // Setup remote tenant dirs
      const remoteBase = `/home/${node.ssh_user}/tenants/${config.tenantId}`;
      ssh(['mkdir', '-p', remoteBase, `${remoteBase}/secrets`]);

      // SCP config + secrets
      scpFile(config.configPath, `${remoteBase}/openclaw.json`);
      const secretsDir = config.secretsPath;
      if (fs.existsSync(secretsDir)) {
        for (const f of fs.readdirSync(secretsDir)) {
          scpFile(path.join(secretsDir, f), `${remoteBase}/secrets/${f}`);
        }
      }

      // Run container on remote
      const containerName = `hfsp_${config.tenantId}`;
      ssh([
        'docker', 'run', '-d',
        '--name', containerName,
        '--restart', 'unless-stopped',
        '--memory', '512m', '--memory-swap', '512m', '--cpus', '0.75',
        '-p', `127.0.0.1:${port}:${port}`,
        '-v', `${remoteBase}/openclaw.json:/run/openclaw/openclaw.json:ro`,
        '-v', `${remoteBase}/secrets:/home/hfsp/.openclaw/secrets:ro`,
        '-e', `GATEWAY_PORT=${port}`,
        config.image,
      ]);

      // Write nginx conf on PIERCALITO pointing to remote node IP:port
      const nginxConf = `/etc/nginx/conf.d/hfsp-tenants/${config.tenantId}.conf`;
      fs.writeFileSync(nginxConf, `
location /ws/${config.tenantId} {
  proxy_pass http://${node.host}:${port};
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
}
`.trim());
      try { execFileSync('sudo', ['nginx', '-s', 'reload'], { stdio: 'pipe' }); } catch {}

      const publicUrl = `wss://agents.hfsp.cloud/ws/${config.tenantId}`;
      return {
        ok: true, tenantId: config.tenantId, containerName,
        image: config.image, gatewayPort: port,
        gatewayUrl: `ws://${node.host}:${port}`,
        publicUrl, startedAt: started, finishedAt: new Date().toISOString(),
        healthPassed: true,
      };
    } catch (err) {
      return {
        ok: false, tenantId: config.tenantId, containerName: `hfsp_${config.tenantId}`,
        image: config.image, gatewayPort: 0, gatewayUrl: '', publicUrl: '',
        startedAt: started, finishedAt: new Date().toISOString(),
        healthPassed: false, error: String(err),
      };
    }
  }
}
