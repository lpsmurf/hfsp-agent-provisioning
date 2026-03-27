export type Surface = 'telegram' | 'webapp' | 'extension';

export interface ProvisionConfig {
  tenantId: string;
  image: string;
  surface: Surface;
  containerName: string;
  workspacePath: string;
  secretsPath: string;
  env: Record<string, string>;
  healthCheckCmd?: string;
  portMappings?: Array<{ hostPort: number; containerPort: number }>;
}

export interface ProvisionResult {
  ok: boolean;
  tenantId: string;
  containerName: string;
  image: string;
  startedAt: string;
  finishedAt: string;
  healthPassed: boolean;
  error?: string;
}

export interface Provisioner {
  provision(config: ProvisionConfig): Promise<ProvisionResult>;
  stop(tenantId: string): Promise<{ ok: boolean; error?: string }>;
  remove(tenantId: string): Promise<{ ok: boolean; error?: string }>;
  status(tenantId: string): Promise<{
    ok: boolean;
    exists: boolean;
    running: boolean;
    healthy?: boolean;
    containerName?: string;
    error?: string;
  }>;
}

export class ShellProvisioner implements Provisioner {
  async provision(_config: ProvisionConfig): Promise<ProvisionResult> {
    const now = new Date().toISOString();
    return {
      ok: false,
      tenantId: _config.tenantId,
      containerName: _config.containerName,
      image: _config.image,
      startedAt: now,
      finishedAt: now,
      healthPassed: false,
      error: 'Not implemented',
    };
  }

  async stop(_tenantId: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'Not implemented' };
  }

  async remove(_tenantId: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'Not implemented' };
  }

  async status(_tenantId: string): Promise<{
    ok: boolean;
    exists: boolean;
    running: boolean;
    healthy?: boolean;
    containerName?: string;
    error?: string;
  }> {
    return { ok: false, exists: false, running: false, error: 'Not implemented' };
  }
}
