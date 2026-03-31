import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";

const TENANTS_DIR = "/etc/nginx/conf.d/hfsp-tenants";
const GATEWAY_HOST = "agents.hfsp.cloud";

export class NginxManager {
  private tenantsDir: string;

  constructor(tenantsDir: string = TENANTS_DIR) {
    this.tenantsDir = tenantsDir;
  }

  /** Add a tenant upstream and reload nginx. Idempotent. */
  async addTenant(tenantId: string, port: number): Promise<void> {
    const conf = this.buildConf(tenantId, port);
    writeFileSync(this.confPath(tenantId), conf, { mode: 0o644 });
    await this.reload();
  }

  /** Remove a tenant upstream and reload nginx. No-op if not present. */
  async removeTenant(tenantId: string): Promise<void> {
    const path = this.confPath(tenantId);
    if (existsSync(path)) {
      unlinkSync(path);
      await this.reload();
    }
  }

  /** Public URL for a tenant's WebSocket gateway. */
  gatewayUrl(tenantId: string): string {
    return `wss://${GATEWAY_HOST}/ws/${tenantId}`;
  }

  private buildConf(tenantId: string, port: number): string {
    // Safe: tenantId is validated to only contain word chars + underscores
    const safeId = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `# tenant: ${safeId}
location /ws/${safeId}/ {
    proxy_pass http://127.0.0.1:${port}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
`;
  }

  private confPath(tenantId: string): string {
    const safeId = tenantId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.tenantsDir, `${safeId}.conf`);
  }

  /** Route a tenant on a REMOTE node through PIERCALITO nginx */
  async addRemoteTenant(tenantId: string, remoteHost: string, port: number): Promise<void> {
    const safeId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const conf = `# Remote tenant: ${tenantId} on ${remoteHost}\nlocation /ws/${safeId}/ {\n    proxy_pass http://${remoteHost}:${port}/;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_set_header Host $host;\n    proxy_read_timeout 3600s;\n    proxy_send_timeout 3600s;\n}\n`;
    const { writeFileSync } = require('fs');
    writeFileSync(this.confPath(tenantId), conf, 'utf8');
    await this.reload();
  }

  private reload(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile("sudo", ["nginx", "-s", "reload"], (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`nginx reload failed: ${stderr?.trim() || err.message}`));
          return;
        }
        resolve();
      });
    });
  }
}
