import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const PORT_MIN = 19000;
const PORT_MAX = 19999;
const DEFAULT_REGISTRY_PATH = join(
  process.env.HOME ?? "/home/hfsp",
  ".openclaw",
  "port-registry.json"
);

type PortMap = Record<string, number>; // tenantId → port

export class PortRegistry {
  private path: string;

  constructor(registryPath: string = DEFAULT_REGISTRY_PATH) {
    this.path = registryPath;
  }

  /** Allocate a port for a tenant. Idempotent — returns existing port if already allocated. */
  allocate(tenantId: string): number {
    const map = this.read();
    if (map[tenantId] !== undefined) return map[tenantId];

    const used = new Set(Object.values(map));
    for (let port = PORT_MIN; port <= PORT_MAX; port++) {
      if (!used.has(port)) {
        map[tenantId] = port;
        this.write(map);
        return port;
      }
    }
    throw new Error(
      `Port registry exhausted: all ports ${PORT_MIN}–${PORT_MAX} are allocated`
    );
  }

  /** Release the port held by a tenant. No-op if not allocated. */
  release(tenantId: string): void {
    const map = this.read();
    if (map[tenantId] === undefined) return;
    delete map[tenantId];
    this.write(map);
  }

  /** Look up the port for a tenant without allocating. Returns undefined if not allocated. */
  get(tenantId: string): number | undefined {
    return this.read()[tenantId];
  }

  /** List all current allocations. */
  list(): PortMap {
    return { ...this.read() };
  }

  private read(): PortMap {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as PortMap;
    } catch {
      return {};
    }
  }

  private write(map: PortMap): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path); // atomic on POSIX
  }
}
