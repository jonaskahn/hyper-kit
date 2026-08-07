/* Minimal mDNS *browser* for opencode's published service. opencode
   advertises `opencode-<port>` as an `_http._tcp` service on `opencode.local`
   (bonjour-service, see opencode's server/mdns.ts), so browsing that type
   yields every running instance — push-based discovery with no polling.
   Parsing is pure (parseMdnsResponse) so tests can feed raw packets. */

import { getNodeModule } from './node';

const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;
const SERVICE_TYPE = '_http._tcp.local';
const NAME_PREFIX = 'opencode-';
const QUERY_INTERVAL_MS = 20000;
const EXPIRE_INTERVAL_MS = 10000;
const DEFAULT_TTL_S = 120;

const TYPE_PTR = 12;
const TYPE_SRV = 33;

export interface MdnsRecord {
  name: string;
  type: number;
  ttl: number;
  rdata: Buffer;
}

interface ParsedMdnsResponse {
  answers: MdnsRecord[];
  authorities: MdnsRecord[];
}

interface MdnsService {
  name: string;
  port: number;
  host: string;
}

/* --- pure packet parsing ------------------------------------------------ */

function readName(buffer: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let jumped = false;
  let next = -1;
  let guard = 0;
  while (guard++ < 128) {
    const length = buffer[offset];
    if (length === 0) {
      if (!jumped) {
        next = offset + 1;
      }
      break;
    }
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | buffer[offset + 1];
      if (!jumped) {
        next = offset + 2;
        jumped = true;
      }
      offset = pointer;
      continue;
    }
    labels.push(buffer.slice(offset + 1, offset + 1 + length).toString('utf8'));
    offset += 1 + length;
  }
  return { name: labels.join('.'), next: next < 0 ? start : next };
}

export function parseMdnsResponse(buffer: Buffer): ParsedMdnsResponse {
  const result: ParsedMdnsResponse = { answers: [], authorities: [] };
  if (buffer.length < 12) {
    return result;
  }
  const counts = [
    buffer.readUInt16BE(4),
    buffer.readUInt16BE(6),
    buffer.readUInt16BE(8),
    buffer.readUInt16BE(10),
  ];
  let offset = 12;
  const readRecord = (): MdnsRecord | null => {
    const name = readName(buffer, offset);
    offset = name.next;
    if (offset + 10 > buffer.length) {
      return null;
    }
    const type = buffer.readUInt16BE(offset);
    const ttl = buffer.readUInt32BE(offset + 4);
    const rdlength = buffer.readUInt16BE(offset + 8);
    offset += 10;
    if (offset + rdlength > buffer.length) {
      return null;
    }
    const rdata = buffer.slice(offset, offset + rdlength);
    offset += rdlength;
    return { name: name.name, type, ttl, rdata };
  };
  for (let i = 0; i < counts[0]; i++) {
    const qname = readName(buffer, offset);
    offset = qname.next + 4; // qtype + qclass
  }
  for (let i = 0; i < counts[1]; i++) {
    const record = readRecord();
    if (!record) {
      break;
    }
    result.answers.push(record);
  }
  for (let i = 0; i < counts[2]; i++) {
    const record = readRecord();
    if (!record) {
      break;
    }
    result.authorities.push(record);
  }
  return result;
}

/* Records of interest: PTR entries under _http._tcp.local pointing at
   opencode instance names, and the SRV/A records resolving them. */
export function extractServices(parsed: ParsedMdnsResponse): MdnsService[] {
  const srvTargets = new Map<string, { port: number; target: string; ttl: number }>();
  const ptrNames = new Set<string>();
  for (const record of [...parsed.answers, ...parsed.authorities]) {
    if (record.type === TYPE_PTR && record.name === SERVICE_TYPE) {
      const target = readName(record.rdata, 0).name.toLowerCase();
      if (target.startsWith(`${NAME_PREFIX}`)) {
        ptrNames.add(target);
      }
    } else if (record.type === TYPE_SRV) {
      const name = record.name.toLowerCase();
      if (name.startsWith(NAME_PREFIX) && name.endsWith(`.${SERVICE_TYPE}`)) {
        const port = record.rdata.readUInt16BE(4);
        const target = readName(record.rdata, 6).name.toLowerCase();
        srvTargets.set(name, { port, target, ttl: record.ttl || DEFAULT_TTL_S });
      }
    }
  }
  const services: MdnsService[] = [];
  for (const [srvName, info] of srvTargets) {
    if (ptrNames.size === 0 || ptrNames.has(srvName)) {
      const instance = srvName.slice(0, srvName.indexOf(`.${SERVICE_TYPE}`));
      services.push({ name: instance, port: info.port, host: info.target });
    }
  }
  return services;
}

/* --- socket -------------------------------------------------------------- */

interface MdnsCallbacks {
  onAdd: (service: MdnsService) => void;
  onRemove: (service: MdnsService) => void;
}

interface TrackedService extends MdnsService {
  lastSeen: number;
}

export function browseMdns(callbacks: MdnsCallbacks): () => void {
  const dgram = getNodeModule('dgram') as typeof import('node:dgram') | null;
  if (!dgram) {
    return () => undefined;
  }
  const services = new Map<string, TrackedService>();
  const socket = dgram.createSocket('udp4');
  let stopped = false;
  let queryTimer: ReturnType<typeof setInterval> | undefined;
  let expireTimer: ReturnType<typeof setInterval> | undefined;

  const buildQuery = (): Buffer => {
    const name = Buffer.from('_http._tcp.local', 'utf8');
    const query = Buffer.alloc(12 + name.length + 1 + 4);
    query.writeUInt16BE(0x0000, 0); // id
    query.writeUInt16BE(0x0000, 2); // flags
    query.writeUInt16BE(1, 4); // qdcount
    name.copy(query, 12);
    query[12 + name.length] = 0;
    query.writeUInt16BE(TYPE_PTR, 12 + name.length + 1);
    query.writeUInt16BE(0x8001, 12 + name.length + 3); // IN + unicast response
    return query;
  };

  const expire = (): void => {
    const now = Date.now();
    for (const [key, service] of services) {
      if (now - service.lastSeen > DEFAULT_TTL_S * 1000) {
        services.delete(key);
        if (!stopped) {
          callbacks.onRemove({ name: service.name, port: service.port, host: service.host });
        }
      }
    }
  };

  const onMessage = (msg: Buffer): void => {
    const parsed = parseMdnsResponse(msg);
    for (const service of extractServices(parsed)) {
      const existing = services.get(service.name);
      if (existing && existing.port === service.port) {
        existing.lastSeen = Date.now();
        continue;
      }
      services.set(service.name, { ...service, lastSeen: Date.now() });
      if (!stopped) {
        callbacks.onAdd(service);
      }
    }
  };

  socket.on('error', () => undefined);
  socket.on('message', onMessage);
  socket.on('listening', () => {
    if (stopped) {
      return;
    }
    try {
      socket.addMembership(MDNS_GROUP);
    } catch {
      // membership may fail on hosts without multicast; queries still work
    }
    const send = (): void => {
      try {
        socket.send(buildQuery(), MDNS_PORT, MDNS_GROUP);
      } catch {
        // socket may be closed
      }
    };
    send();
    queryTimer = setInterval(send, QUERY_INTERVAL_MS);
    expireTimer = setInterval(expire, EXPIRE_INTERVAL_MS);
  });

  try {
    socket.bind(0);
  } catch {
    return () => undefined;
  }

  return () => {
    stopped = true;
    if (queryTimer) {
      clearInterval(queryTimer);
    }
    if (expireTimer) {
      clearInterval(expireTimer);
    }
    try {
      socket.close();
    } catch {
      // already closed
    }
    services.clear();
  };
}
