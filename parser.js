export const CATEGORY_INFO = {
  overview: { title: "Общие сведения", icon: "◫", order: 0 },
  system: { title: "Система", icon: "◈", order: 1 },
  hardware: { title: "Оборудование", icon: "◆", order: 2 },
  processes: { title: "Процессы и ядро", icon: "▦", order: 3 },
  memory: { title: "Память", icon: "▤", order: 4 },
  internet: { title: "Интернет", icon: "◎", order: 5 },
  vpn: { title: "VPN и туннели", icon: "◇", order: 6 },
  interfaces: { title: "Интерфейсы", icon: "⇆", order: 7 },
  wifi: { title: "Wi‑Fi", icon: "⌁", order: 8 },
  mws: { title: "MWS", icon: "⌘", order: 9 },
  hosts: { title: "Хосты", icon: "▧", order: 10 },
  dhcp: { title: "DHCP и DNS", icon: "≋", order: 11 },
  routing: { title: "Маршрутизация", icon: "↝", order: 12 },
  networkRules: { title: "Сетевые правила", icon: "⌘", order: 13 },
  cloud: { title: "Облако", icon: "☁", order: 14 },
  ipv6: { title: "IPv6", icon: "6", order: 15 },
  qos: { title: "QoS", icon: "≋", order: 16 },
  security: { title: "Безопасность", icon: "⬡", order: 17 },
  configuration: { title: "Полная конфигурация", icon: "⌘", order: 18 },
  general: { title: "Общие настройки", icon: "⚙", order: 19 },
  users: { title: "Пользователи", icon: "♙", order: 20 },
  domain: { title: "Доменное имя", icon: "◎", order: 21 },
  usb: { title: "USB", icon: "↯", order: 22 },
  services: { title: "Сервисы", icon: "⚙", order: 23 },
  logs: { title: "Логи", icon: "≡", order: 24 },
  other: { title: "Прочее", icon: "•••", order: 25 },
};

const CONFIG_GROUPS = [
  ["mws", "MWS — модульная Wi‑Fi-система", /^mws\b/i],
  ["wifi", "Wi‑Fi и точки доступа", /^(interface\s+Wifi|wifi|wlan|access-point|mesh|roaming)/i],
  ["vpn", "VPN и туннели", /^(interface\s+(Wireguard|OpenVPN|OpenConnect|IPsec|L2TP|PPTP|SSTP|GRE|EoIP|IPIP|Tunnel|ZeroTier)|crypto|ipsec|vpn-server|wireguard-server|oc-server|sstp-server)/i],
  ["internet", "Интернет-подключения", /^(interface\s+(PPPoE|UsbModem|UsbLte|UsbQmi|CdcEthernet|Yota)|pppoe|kabinet)/i],
  ["interfaces", "Интерфейсы и сегменты", /^(interface|port|switch|vlan|bridge|segment)/i],
  ["routing", "Маршруты, политики и NAT", /^(ip (route|policy|nat|static|conntrack)|ipv6 (route|static|local-prefix)|route|router|policy|nat|ppe)/i],
  ["dhcp", "DHCP, DNS и узлы", /^(ip dhcp|ip name-server|dns-proxy|nextdns|skydns|known host|host |ipv6 subnet|mdns)/i],
  ["security", "Доступ и безопасность", /^(access|access-list|object-group|firewall|isolate-private|user|ntce|ip (ssh|telnet|http|hotspot|ftp)\b|cloud control)/i],
  ["services", "Сервисы и приложения", /^(service|afp|cifs|dlna|dyndns|opkg|ntp|snmp|upnp|printer|torrent|udpxy|easyconfig)/i],
  ["system", "Система и компоненты", /^(system|hostname|domainname|administrator|clock|schedule|button|led|components)/i],
];

function decodeEntities(value) {
  const el = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (el) { el.innerHTML = value; return el.value; }
  return value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

export function parseFilename(filename) {
  const clean = filename.replace(/\.(txt|xml)$/i, "");
  const match = clean.match(/^self-?test_([^_]+)_([^_]+)_([^_]+)_([^_]+)_(.+)$/i);
  if (!match) return { device: clean, channel: "—", version: "—", role: "—", timestamp: "—" };
  return { device: match[1], channel: match[2], version: match[3], role: match[4], timestamp: match[5] };
}

export function extractFiles(text) {
  const results = [];
  const opening = /<file\s+name="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = opening.exec(text))) {
    let contentStart = opening.lastIndex;
    contentStart += (text.slice(contentStart).match(/^\s*/)?.[0] || "").length;
    let contentEnd;
    if (text.startsWith("<![CDATA[", contentStart)) {
      contentStart += 9;
      contentEnd = text.indexOf("]]>", contentStart);
      if (contentEnd < 0) break;
      const closing = text.indexOf("</file>", contentEnd + 3);
      if (closing < 0) break;
      opening.lastIndex = closing + 7;
    } else {
      contentEnd = text.indexOf("</file>", contentStart);
      if (contentEnd < 0) break;
      opening.lastIndex = contentEnd + 7;
    }
    results.push({ name: decodeEntities(match[1]), content: text.slice(contentStart, contentEnd).replace(/^\s*\n|\s+$/g, "") });
  }
  return results;
}

export function extractTemperatures(text) {
  const sensors = [];
  const interfaceRe = /<interface\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/interface>/gi;
  let match;
  while ((match = interfaceRe.exec(text))) {
    const temperature = match[2].match(/<temperature>\s*(-?\d+(?:[.,]\d+)?)\s*<\/temperature>/i)?.[1];
    if (temperature === undefined) continue;
    const value = Number(temperature.replace(",", "."));
    if (Number.isFinite(value)) sensors.push({ id: match[1], value });
  }
  return sensors;
}

function temperatureDisplayName(id) {
  return ({ WifiMaster0: "2.4 GHz", WifiMaster1: "5 GHz" })[id] || id;
}

function isStructuredJson(content) {
  try {
    const value = JSON.parse(content);
    return value !== null && typeof value === "object";
  } catch {
    return false;
  }
}

function extractShowOutput(text, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");
  const match = text.match(new RegExp(`<!--\\s*${escaped}\\s*-->\\s*([\\s\\S]*?)(?=<!--|<\\/selftest>)`, "i"));
  return match?.[1]?.trim() || "";
}

function showCategory(command) {
  const explicit = SHOW_CATEGORY_OVERRIDES.get(command.toLowerCase());
  if (explicit) return explicit;
  const normalized = command.toLowerCase();
  const prefix = SHOW_CATEGORY_PREFIXES.find(([candidate]) => normalized === candidate || normalized.startsWith(`${candidate} `));
  if (prefix) return prefix[1];
  if (/\b(wifi|wlan|association)/i.test(command)) return "wifi";
  if (/\bmws\b/i.test(command)) return "mws";
  if (/\b(vpn|tunnel|wireguard|openvpn|ipsec|l2tp|pptp|sstp|zerotier)\b/i.test(command)) return "vpn";
  if (/\b(dhcp|dns|hotspot|host|lease)\b/i.test(command)) return "dhcp";
  if (/\b(route|routing|policy|nat)\b/i.test(command)) return "routing";
  if (/\b(firewall|security|access|user|crypto)\b/i.test(command)) return "security";
  if (/\b(memory|meminfo|swap)\b/i.test(command)) return "memory";
  if (/\b(process|cpu|kernel|cpustat)\b/i.test(command)) return "processes";
  if (/\b(interface|port|switch|vlan|bridge)\b/i.test(command)) return "interfaces";
  if (/\b(version|system|identification|defaults)\b/i.test(command)) return "system";
  return "other";
}

const SHOW_CATEGORY_PREFIXES = [
  ["show mws log", "logs"], ["show log", "logs"],
  ["show ip http", "security"], ["show ip telnet", "security"], ["show ip ftp", "security"],
  ["show ssh", "security"], ["show authentication", "security"], ["show dot1x", "security"],
  ["show interface cells", "internet"], ["show interface operators", "internet"], ["show interface esim", "internet"], ["show interface dsl", "internet"],
  ["show nvox", "services"], ["show ntce", "qos"],
  ["show afp", "services"], ["show cifs", "services"], ["show dlna", "services"], ["show torrent", "services"], ["show udpxy", "services"], ["show printers", "services"],
  ["show nextdns", "networkRules"], ["show skydns", "networkRules"], ["show chilli", "networkRules"], ["show dyndns", "networkRules"],
  ["show ipv6", "ipv6"], ["show led", "general"], ["show button", "general"], ["show clock", "general"],
  ["show easyconfig", "general"], ["show kabinet", "internet"],
];

const SHOW_CATEGORY_OVERRIDES = new Map([
  ["show acme", "internet"],
  ["show button", "general"],
  ["show clock date", "general"],
  ["show cloud", "cloud"],
  ["show cloud ndmp link", "cloud"],
  ["show cloud ndmp status", "cloud"],
  ["show components status", "general"],
  ["show configurator status", "general"],
  ["show device-list", "hosts"],
  ["show drivers", "hardware"],
  ["show dyndns", "networkRules"],
  ["show dyndns report", "networkRules"],
  ["show environment", "general"],
  ["show internet status", "internet"],
  ["show ip arp", "networkRules"],
  ["show ip conntrack", "internet"],
  ["show ip conntrack lockout", "internet"],
  ["show ip http proxy", "networkRules"],
  ["show ip name-server", "dhcp"],
  ["show ip neighbour", "hosts"],
  ["show ip rule", "security"],
  ["show ip service", "services"],
  ["show ipset", "general"],
  ["show ipv6 conntrack", "ipv6"],
  ["show ipv6 netfilter", "ipv6"],
  ["show ipv6 prefixes", "ipv6"],
  ["show ipv6 subnets", "ipv6"],
  ["show last-change", "general"],
  ["show media", "usb"],
  ["show ndns", "cloud"],
  ["show ndss", "cloud"],
  ["show netfilter", "internet"],
  ["show ntce hosts", "qos"],
  ["show ntce status", "qos"],
  ["show ntp status", "system"],
  ["show object-group fqdn", "networkRules"],
  ["show oc-server", "domain"],
  ["show ping-check", "internet"],
  ["show processes", "processes"],
  ["show tags", "users"],
  ["show threads", "processes"],
  ["show upnp redirect", "internet"],
  ["show usb", "usb"],
  ["show crypto map", "vpn"],
  ["show user", "users"],
]);

function extractShowSections(text) {
  const definitions = [
    ["show defaults", "show defaults", "system"],
    ["show version", "show version", "system"],
    ["show identification", "show identification", "system"],
    ["show system", "show system", "system"],
    ["show system cpustat", "Загрузка процессора", "processes", "cpustat"],
    ["show associations", "Подключённые Wi‑Fi-устройства", "wifi", "associations"],
    ["show ip policy", "Политики маршрутизации", "routing", "ip-policy"],
    ["show ip route", "Маршруты IPv4", "routing", "ip-routes"],
    ["show ipv6 route", "Маршруты IPv6", "routing", "ipv6-routes"],
    ["show ip dhcp pool", "Пулы DHCP", "dhcp", "dhcp-pools"],
    ["show ip hotspot", "show ip hotspot", "dhcp"],
    ["show ip dhcp bindings", "show ip dhcp bindings", "dhcp"],
    ["show mws associations", "MWS: подключения", "mws"],
    ["show mws controller", "MWS: контроллер", "mws"],
  ];
  const configured = definitions.map(([command, name, category, presentation]) => {
    const content = extractShowOutput(text, command);
    return content ? { key: `derived:${category}:${command.replaceAll(" ", "-")}`, name, category, content, virtual: true, source: "show", presentation } : null;
  }).filter(Boolean);
  const known = new Set(definitions.map(([command]) => command.toLowerCase()));
  const generic = [];
  const counters = new Map();
  const marker = /<!--\s*(show\s+[^>]*?)\s*-->\s*([\s\S]*?)(?=<!--|<\/selftest>)/gi;
  let match;
  while ((match = marker.exec(text))) {
    const command = match[1].trim().replace(/\s+/g, " ");
    const content = match[2].trim();
    if (!content || known.has(command.toLowerCase())) continue;
    const category = showCategory(command);
    const slug = command.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "") || "output";
    const occurrence = (counters.get(slug) || 0) + 1;
    counters.set(slug, occurrence);
    generic.push({
      key: `derived:${category}:${slug}${occurrence > 1 ? `:${occurrence}` : ""}`,
      name: command,
      category,
      content,
      virtual: true,
      source: "show",
    });
  }
  return [...configured, ...generic];
}

function getShowVersionMeta(text) {
  const version = extractShowOutput(text, "show version");
  const take = tag => version.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() || "—";
  const nested = (parent, tag) => version.match(new RegExp(`<${parent}>[\\s\\S]*?<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>[\\s\\S]*?<\\/${parent}>`, "i"))?.[1]?.trim() || "—";
  return {
    hwId: take("hw_id"), region: take("region"), release: take("release"), sandbox: take("sandbox"),
    ndmExact: nested("ndm", "exact"), ndmCdate: nested("ndm", "cdate"),
    bspExact: nested("bsp", "exact"), bspCdate: nested("bsp", "cdate"),
  };
}

const SEARCH_LIMIT = 1000;

export function searchDiagnostic(diagnostic, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  if (typeof diagnostic !== "string") {
    diagnostic.searchCache ||= new Map();
    if (diagnostic.searchCache.has(needle)) return diagnostic.searchCache.get(needle);
  }
  const text = typeof diagnostic === "string" ? sanitizeRaw(diagnostic) : diagnostic.searchText;
  const lines = text.split(/\r?\n/), hits = [];
  let fileSection = null, interfaceSection = null;

  const addLineHits = (line, lineIndex, section) => {
    const lower = line.toLowerCase();
    let from = 0;
    while (hits.length < SEARCH_LIMIT && (from = lower.indexOf(needle, from)) !== -1) {
      hits.push({
        section: section?.name || "XML диагностики",
        sectionType: section?.type || "xml",
        line: lineIndex + 1,
        sectionLine: section ? lineIndex - section.start + 1 : null,
        column: from + 1,
        before: lines[lineIndex - 1] || "",
        text: line,
        after: lines[lineIndex + 1] || "",
      });
      from += Math.max(needle.length, 1);
    }
  };

  for (let index = 0; index < lines.length && hits.length < SEARCH_LIMIT; index++) {
    const line = lines[index];
    const fileStart = line.match(/<file\s+name="([^"]+)"/i);
    if (fileStart) fileSection = { name: fileStart[1], type: "file", start: index };
    if (!fileSection) {
      const interfaceStart = line.match(/<interface\b[^>]*\bname="([^"]+)"/i);
      if (interfaceStart) interfaceSection = { name: `Интерфейс · ${interfaceStart[1]}`, type: "interface", start: index };
    }
    addLineHits(line, index, fileSection || interfaceSection);
    if (fileSection && /<\/file>/i.test(line)) fileSection = null;
    if (!fileSection && interfaceSection && /<\/interface>/i.test(line)) interfaceSection = null;
  }

  if (typeof diagnostic !== "string") {
    const virtualSections = diagnostic.sections.filter(item => item.virtual);
    const representations = new Map();
    for (const section of virtualSections) {
      const virtualLines = section.content.split(/\r?\n/);
      for (let index = 0; index < virtualLines.length; index++) {
        const lower = virtualLines[index].toLowerCase();
        let from = 0;
        while ((from = lower.indexOf(needle, from)) !== -1) {
          const key = `${virtualLines[index]}\u0000${from + 1}`;
          if (!representations.has(key)) representations.set(key, []);
          representations.get(key).push({ name: section.name, key: section.key, line: index + 1, lines: virtualLines, column: from + 1, generated: section.key === "derived:temperatures" || section.source === "errors" });
          from += Math.max(needle.length, 1);
        }
      }
    }
    if (hits.length) {
      const physicalByOccurrence = new Map();
      for (const hit of hits) {
        const key = `${hit.text}\u0000${hit.column}`;
        if (!physicalByOccurrence.has(key)) physicalByOccurrence.set(key, []);
        physicalByOccurrence.get(key).push(hit);
      }
      for (const [key, refs] of representations) {
        const physical = physicalByOccurrence.get(key);
        if (!physical?.length) {
          for (const ref of refs.filter(item => item.generated)) {
            if (hits.length >= SEARCH_LIMIT) break;
            hits.push({ section: ref.name, sectionType: "derived", sectionKey: ref.key, line: null, sectionLine: ref.line, column: ref.column, before: ref.lines[ref.line - 2] || "", text: ref.lines[ref.line - 1], after: ref.lines[ref.line] || "" });
          }
          continue;
        }
        for (let index = 0; index < refs.length; index++) {
          const hit = physical[index % physical.length];
          const ref = refs[index];
          hit._representations ||= [];
          if (!hit._representations.some(item => item.key === ref.key)) hit._representations.push(ref);
        }
      }
      for (const hit of hits) {
        const refs = hit._representations || [];
        if (!refs.length) continue;
        delete hit._representations;
        hit.sections = [...new Set([hit.section, ...refs.map(ref => ref.name)])];
        hit.section = refs[0].name;
        hit.sectionType = "derived";
        hit.sectionKey = refs[0].key;
        hit.sectionLine = refs[0].line;
      }
    } else {
      for (const refs of representations.values()) {
        for (const ref of refs.filter(item => item.generated)) {
          if (hits.length >= SEARCH_LIMIT) break;
          hits.push({ section: ref.name, sectionType: "derived", sectionKey: ref.key, line: null, sectionLine: ref.line, column: ref.column, before: ref.lines[ref.line - 2] || "", text: ref.lines[ref.line - 1], after: ref.lines[ref.line] || "" });
        }
      }
      // Производное имя тоже может отсутствовать в исходном XML.
      for (const section of virtualSections) {
        const column = section.name.toLowerCase().indexOf(needle);
        if (column === -1 || hits.length >= SEARCH_LIMIT) continue;
        if (hits.some(hit => hit.sectionKey === section.key && hit.text === section.name && hit.column === column + 1)) continue;
        hits.push({ section: section.name, sectionType: "derived", sectionKey: section.key, line: null, sectionLine: null, column: column + 1, before: "", text: section.name, after: section.content.split(/\r?\n/)[0] || "" });
      }
    }
  }

  hits.truncated = hits.length >= SEARCH_LIMIT;
  if (typeof diagnostic !== "string") diagnostic.searchCache.set(needle, hits);
  return hits;
}

function categoryFor(name) {
  const n = name.toLowerCase();
  if (n === "sys:kernel/debug/usb/devices") return "usb";
  if (n === "ndm:log" || n.includes("mtdoops") || n.endsWith(".diag")) return "logs";
  if (n.includes("wifi") || n.includes("wlan")) return "wifi";
  if (n === "proc:driver/hw_nat/foe/binds" || n === "proc:fastvpn/binds") return "internet";
  if (/xfrm|fastvpn|pppol2tp|ipsec|openvpn|wireguard/.test(n)) return "vpn";
  if (/net\/dev|igmpsn|statistics/.test(n)) return "interfaces";
  if (/resolv|hosts/.test(n)) return "dhcp";
  if (/meminfo|vmstat|vmalloc|zoneinfo|slabinfo|swaps/.test(n)) return "memory";
  if (/modules|interrupts|loadavg/.test(n)) return "processes";
  if (/driver|kernel\/debug|usb|switch|mtd/.test(n)) return "hardware";
  if (n.startsWith("temp:")) return "services";
  if (n.startsWith("proc:") || n.startsWith("sys:")) return "processes";
  if (n === "ndm:sharing-config") return "configuration";
  return "other";
}

function splitConfig(content) {
  const blocks = [];
  let current = [];
  for (const line of content.split(/\r?\n/)) {
    if (line && !/^\s/.test(line) && !line.startsWith("!")) {
      if (current.length) blocks.push(current);
      current = [line];
    } else if (current.length) current.push(line);
  }
  if (current.length) blocks.push(current);

  const grouped = new Map();
  for (const block of blocks) {
    const head = block[0], body = block.join("\n");
    const definition = /^interface\s+/i.test(head) && (/^\s+ip global\s+/mi.test(body) || /^\s+description\s+.*broadband/mi.test(body))
      ? ["internet", "Интернет-подключения"]
      : CONFIG_GROUPS.find(([, , re]) => re.test(head));
    const destinations = /^mws\s+vlan\b/i.test(head)
      ? [["mws", "MWS VLAN"], ["wifi", "MWS VLAN"]]
      : [definition || ["other", "Прочие настройки"]];
    for (const [category, name] of destinations) {
      const groupKey = `${category}:${name}`;
      const sectionKey = destinations.length > 1 ? `config:${groupKey}` : `config:${name}`;
      if (!grouped.has(groupKey)) grouped.set(groupKey, { key: sectionKey, name, category, chunks: [] });
      grouped.get(groupKey).chunks.push(block.join("\n"));
    }
  }
  return [...grouped.values()].map(group => ({ ...group, content: group.chunks.join("\n\n"), virtual: true, source: "config" }));
}

function getConfigMeta(config) {
  const take = re => config.match(re)?.[1]?.trim() || "—";
  return {
    model: take(/^! \$\$\$ Model:\s*(.+)$/mi),
    configFormat: take(/^! \$\$\$ Version:\s*(.+)$/mi),
    hostname: take(/^\s*hostname\s+(.+)$/mi),
  };
}

export function parseDiagnostic(filename, text) {
  const fileMeta = parseFilename(filename);
  const raw = extractFiles(text);
  if (!raw.length) throw new Error("В файле не найдены секции <file>. Возможно, это не Keenetic self-test.");
  const config = raw.find(item => item.name === "ndm:sharing-config")?.content || "";
  const searchText = sanitizeRaw(text);
  const sections = raw.map(item => ({ key: `raw:${item.name}`, name: item.name, content: item.content, category: categoryFor(item.name), virtual: false }));
  sections.push({ key: "raw:selftest-structured", name: "Структурированные данные self-test", content: searchText, category: "other", virtual: false, sanitized: true });
  const errors = [...text.matchAll(/<error\b[^>]*>([\s\S]*?)<\/error>/gi)].map(match => decodeEntities(match[1].trim())).filter(Boolean);
  if (errors.length) sections.push({ key: "derived:collection-errors", name: "Ошибки сбора диагностики", content: errors.join("\n"), category: "other", virtual: true, source: "errors" });
  sections.push(...splitConfig(config));
  sections.push(...extractServiceConfigurations(config));
  sections.push(...extractShowSections(text));
  const temperatures = extractTemperatures(text);
  if (temperatures.length) sections.push({ key: "derived:temperatures", name: "Температура", category: "hardware", virtual: true, content: temperatures.map(sensor => `${temperatureDisplayName(sensor.id)}: ${sensor.value} °C`).join("\n") });
  for (const section of sections) {
    if (!section.sanitized) section.content = sanitizeRaw(section.content);
    delete section.sanitized;
    if (!section.presentation && isStructuredJson(section.content)) section.presentation = "json";
  }
  const meta = { ...fileMeta, ...getConfigMeta(config), ...getShowVersionMeta(text), firmware: fileMeta.version, temperatures, maxTemperature: temperatures.length ? Math.max(...temperatures.map(sensor => sensor.value)) : null };
  const semantic = extractSemanticConfig(config, meta, temperatures);
  return {
    id: `${filename}:${text.length}:${Math.random().toString(36).slice(2)}`,
    filename, size: new Blob([text]).size, text, searchText, searchCache: new Map(), meta, sections, semantic,
    lineCount: text.split(/\r?\n/).length,
  };
}

function splitConfigIntoBlocks(content) {
  const blocks = [], current = [];
  for (const line of content.split(/\r?\n/)) {
    if (line && !/^\s/.test(line) && !line.startsWith("!")) {
      if (current.length) blocks.push([...current]);
      current.length = 0;
    }
    if (line || current.length) current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function extractServiceConfigurations(config) {
  const definitions = [
    ["smb", "Сервер SMB", /^cifs\b/im],
    ["sstp", "VPN-сервер SSTP", /^sstp-server\b/im],
    ["openconnect", "OpenConnect VPN-сервер", /^oc-server\b/im],
    ["wireguard", "WireGuard VPN-сервер", /^wireguard-server\b/im],
    ["l2tp", "VPN-сервер L2TP/IPsec", /^\s+l2tp-server\b/im],
    ["ikev2", "VPN-сервер IKEv2/IPsec", /^crypto map VirtualIPServerIKE2\b/im],
  ];
  const blocks = splitConfigIntoBlocks(config);
  return definitions.map(([key, name, re]) => {
    const content = blocks.filter(block => re.test(block.join("\n"))).map(block => block.join("\n")).join("\n\n");
    return content ? { key: `derived:services:${key}`, name, category: "services", content, virtual: true, source: "config" } : null;
  }).filter(Boolean);
}

function interfaceBlocks(config) {
  const blocks = [];
  const lines = config.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("interface ")) continue;
    const chunk = [lines[i]];
    for (i++; i < lines.length && (lines[i] === "!" || /^\s/.test(lines[i])); i++) chunk.push(lines[i]);
    i--;
    blocks.push({ name: chunk[0].slice(10).trim(), lines: chunk, raw: chunk.join("\n") });
  }
  return blocks;
}

const cleanValue = value => value?.replace(/^"|"$/g, "").trim() || "—";
const firstValue = (block, re) => cleanValue(block.lines.map(line => line.trim()).find(line => re.test(line))?.match(re)?.[1]);
const allValues = (block, re) => block.lines.map(line => line.trim().match(re)?.[1]).filter(Boolean).map(cleanValue);
const directState = block => [...block.lines].reverse().find(line => /^    (up|down)$/.test(line))?.trim() || "—";
const statusLabel = state => state === "up" ? "Включено" : state === "down" ? "Выключено" : "Не указано";
const sanitizeRaw = raw => String(raw || "").split(/\r?\n/).map(line => {
  const secret = /^(\s*(?:(?:wireguard|authentication)\s+)?(?:preshared-key|private-key|password|identity|wpa-psk)|\s*password\s+nt)\b/i;
  if (/^\s*crypto\s+ike\s+key\b/i.test(line)) return `${line.match(/^\s*/)?.[0] || ""}crypto ike [скрыто: ключ]`;
  if (/^\s*(?:ft\s+)?iapp\s+key\b/i.test(line)) return `${line.match(/^\s*/)?.[0] || ""}[скрыто: ключ IAPP]`;
  if (/^\s*wpa\s+psk\b/i.test(line)) return `${line.match(/^\s*/)?.[0] || ""}[скрыто: ключ Wi-Fi]`;
  if (secret.test(line)) return `${line.match(/^\s*/)?.[0] || ""}[скрыто: секрет]`;
  if (/^\s*wireguard peer\s+/i.test(line)) return line.replace(/(wireguard peer)\s+.*/i, "$1 [скрыто]");
  return line;
}).join("\n");

function inferWifiBand(master, accessPoint) {
  const compatibility = firstValue(master, /^compatibility\s+(.+)$/i);
  const hint = `${master.name} ${compatibility}`;
  if (/6\s*GHz|6G\b|AccessPoint_6/i.test(hint) || /WifiMaster2/.test(master.name)) return "6 ГГц";
  if (/5\s*GHz|5G\b|AccessPoint_5/i.test(hint) || /WifiMaster1/.test(master.name)) return "5 ГГц";
  return "2,4 ГГц";
}

function protocolInfo(name) {
  const definitions = [
    ["PPPoE", /^PPPoE/i, "Интернет-подключения", "◉"],
    ["WireGuard", /^Wireguard/i, "VPN и туннели", "◇"], ["OpenVPN", /^OpenVPN/i, "VPN и туннели", "◇"],
    ["L2TP", /^L2TP/i, "VPN и туннели", "◇"], ["PPTP", /^PPTP/i, "VPN и туннели", "◇"],
    ["SSTP", /^SSTP/i, "VPN и туннели", "◇"], ["IPsec", /^IPsec/i, "VPN и туннели", "◇"],
    ["GRE", /^GRE/i, "VPN и туннели", "◇"], ["EoIP", /^EoIP/i, "VPN и туннели", "◇"],
    ["IPIP", /^IPIP/i, "VPN и туннели", "◇"], ["ZeroTier", /^ZeroTier/i, "VPN и туннели", "◇"],
  ];
  return definitions.find(([, re]) => re.test(name));
}

function objectFields(block, protocol) {
  const fields = {
    "Состояние": statusLabel(directState(block)), "Описание": firstValue(block, /^description\s+(.+)$/i),
    "Логическое имя": firstValue(block, /^rename\s+(.+)$/i),
    "IP-адрес": allValues(block, /^ip address\s+(?!dhcp)(.+)$/i).join(", ") || "—",
  };
  if (protocol === "PPPoE") {
    fields["Интерфейс провайдера"] = firstValue(block, /^(?:over|bind)\s+(.+)$/i);
    fields["Имя пользователя"] = firstValue(block, /^authentication identity\s+(.+)$/i);
    fields["Сервис"] = firstValue(block, /^service-name\s+(.+)$/i);
  } else {
    fields["Удалённый узел"] = firstValue(block, /^peer\s+(.+)$/i);
    fields["Endpoint"] = allValues(block, /^endpoint\s+(.+)$/i).join(", ") || "—";
    fields["Порт сервера"] = firstValue(block, /^wireguard listen-port\s+(.+)$/i);
    const peers = block.lines.filter(line => /^\s+wireguard peer\s+/i.test(line));
    fields["Пиры"] = peers.length ? String(peers.length) : "—";
    fields["Разрешённые сети"] = [...new Set(allValues(block, /^allow-ips\s+(.+)$/i))].join(", ") || "—";
    fields["MTU"] = firstValue(block, /^ip mtu\s+(.+)$/i);
    if (["L2TP", "PPTP", "SSTP"].includes(protocol)) {
      fields["Имя пользователя"] = firstValue(block, /^authentication identity\s+(.+)$/i);
      fields["Уровень безопасности"] = firstValue(block, /^security-level\s+(.+)$/i);
      fields["IPCP"] = firstValue(block, /^ipcp\s+(.+)$/i);
      fields["Роль"] = firstValue(block, /^role\s+(.+)$/i);
    }
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== "—"));
}

export function extractSemanticConfig(config, meta = {}, temperatures = []) {
  const blocks = interfaceBlocks(config), objects = [];
  const temperatureByInterface = new Map(temperatures.map(sensor => [sensor.id.toLowerCase(), sensor.value]));
  const masters = blocks.filter(block => /^WifiMaster\d+$/.test(block.name));
  const bandCounts = new Map();
  for (const master of masters) {
    const accessPoint = blocks.find(block => block.name === `${master.name}/AccessPoint0`);
    const band = inferWifiBand(master, accessPoint), index = bandCounts.get(band) || 0; bandCounts.set(band, index + 1);
    const configuredSecurity = accessPoint ? allValues(accessPoint, /^encryption\s+(wpa\d?|wep|tkip|aes)$/i).join(" + ").toUpperCase() : "";
    const security = configuredSecurity || (accessPoint?.lines.some(line => /^\s+encryption\s+no enable\s*$/i.test(line)) ? "Открытая сеть" : "—");
    const temperature = temperatureByInterface.get(master.name.toLowerCase());
    objects.push({ key: `wifi:${band}:${index}`, category: "Wi‑Fi", icon: "⌁", title: `Wi‑Fi ${band}`, subtitle: accessPoint ? firstValue(accessPoint, /^ssid\s+(.+)$/i) : master.name,
      fields: { "Наличие": "Есть", "Состояние": statusLabel(accessPoint ? directState(accessPoint) : directState(master)), "SSID": accessPoint ? firstValue(accessPoint, /^ssid\s+(.+)$/i) : "—", "Стандарты": firstValue(master, /^compatibility\s+(.+)$/i), "Защита": security, "Страна": firstValue(master, /^country-code\s+(.+)$/i), "Температура": temperature === undefined ? "—" : `${temperature} °C`, "Интерфейс": master.name },
      raw: sanitizeRaw([master.raw, accessPoint?.raw].filter(Boolean).join("\n")) });
  }
  for (const block of blocks.filter(item => /^Bridge\d+$/i.test(item.name))) {
    const logicalName = firstValue(block, /^rename\s+(.+)$/i), description = firstValue(block, /^description\s+(.+)$/i);
    const isWan = block.lines.some(line => /^\s+ip global\s+/i.test(line)) || block.lines.some(line => /^\s+description\s+.*broadband/i.test(line));
    const dhcp = block.lines.some(line => /^\s+ip address dhcp\s*$/i.test(line));
    objects.push({ key: `bridge:${block.name.match(/\d+$/)?.[0] || block.name}`, category: "Интерфейсы и сегменты", icon: "⇆", title: `Сегмент · ${logicalName !== "—" ? logicalName : block.name}`, subtitle: description !== "—" ? description : block.name,
      fields: { "Наличие": "Есть", "Состояние": statusLabel(directState(block)), "Логическое имя": logicalName, "Описание": description, "IP-адрес": allValues(block, /^ip address\s+(?!dhcp)(.+)$/i).join(", ") || "—", "Участники": allValues(block, /^include\s+(.+)$/i).join(", ") || "—", "Уровень безопасности": firstValue(block, /^security-level\s+(.+)$/i), "Band steering": block.lines.some(line => /^\s+band-steering\s*$/i.test(line)) ? "Включено" : "Выключено", ...(isWan ? { "Роль подключения": "Интернет", "Тип адреса": dhcp ? "DHCP" : "Статический", "Приоритет": firstValue(block, /^ip global\s+(.+)$/i) } : {}) }, raw: sanitizeRaw(block.raw) });
  }
  for (const block of blocks) {
    if (protocolInfo(block.name) || /^(?:Wifi|Bridge)/i.test(block.name)) continue;
    const isWan = block.lines.some(line => /^\s+ip global\s+/i.test(line)) || block.lines.some(line => /^\s+description\s+.*broadband/i.test(line));
    if (!isWan) continue;
    const logicalName = firstValue(block, /^rename\s+(.+)$/i), description = firstValue(block, /^description\s+(.+)$/i);
    const dhcp = block.lines.some(line => /^\s+ip address dhcp\s*$/i.test(line));
    objects.push({ key: `internet:${block.name.toLowerCase()}`, category: "Интернет-подключения", icon: "◎", title: `Подключение · ${logicalName !== "—" ? logicalName : block.name}`, subtitle: description !== "—" ? description : block.name,
      fields: { "Наличие": "Есть", "Состояние": statusLabel(directState(block)), "Логическое имя": logicalName, "Описание": description, "Тип адреса": dhcp ? "DHCP" : "Статический", "IP-адрес": allValues(block, /^ip address\s+(?!dhcp)(.+)$/i).join(", ") || "—", "Приоритет": firstValue(block, /^ip global\s+(.+)$/i), "IPv6": block.lines.some(line => /^\s+ipv6 address/i.test(line)) ? "Включён" : "Не настроен", "Интерфейс": block.name }, raw: sanitizeRaw(block.raw) });
  }
  for (const block of blocks) {
    const info = protocolInfo(block.name); if (!info) continue;
    const [protocol, , category, icon] = info;
    const exactNumber = block.name.match(new RegExp(`^${protocol}(\\d+)$`, "i"))?.[1];
    const suffix = exactNumber || block.name.slice(protocol.length).replace(/^[-_/]+/, "").toLowerCase() || "0";
    const description = firstValue(block, /^description\s+(.+)$/i);
    objects.push({ key: `${protocol.toLowerCase()}:${suffix}`, category, icon, title: `${protocol} · ${description === "—" ? block.name : description}`, subtitle: block.name, fields: { "Наличие": "Есть", ...objectFields(block, protocol) }, raw: sanitizeRaw(block.raw) });
  }
  objects.unshift({ key: "system:device", category: "Устройство", icon: "▣", title: "Модель и прошивка", subtitle: meta.device || "Устройство", fields: { "Модель": meta.model || "—", "Код устройства": meta.device || "—", "Версия образа": meta.version || "—", "Канал": meta.channel || "—", "Режим": meta.role || "—", "Версия NDM": meta.firmware || "—" }, raw: "" });
  return objects;
}

export function compareSemantic(left, right) {
  const keys = new Set([...left.semantic.map(item => item.key), ...right.semantic.map(item => item.key)]);
  return [...keys].map(key => {
    const a = left.semantic.find(item => item.key === key), b = right.semantic.find(item => item.key === key);
    const fields = [...new Set([...Object.keys(a?.fields || {}), ...Object.keys(b?.fields || {})])].map(name => ({ name, left: a?.fields[name] ?? "Нет", right: b?.fields[name] ?? "Нет", changed: (a?.fields[name] ?? "Нет") !== (b?.fields[name] ?? "Нет") }));
    if (!a || !b) fields.forEach(field => { field.changed = false; });
    const status = !a ? "right-only" : !b ? "left-only" : fields.some(field => field.changed) || a.title !== b.title || a.subtitle !== b.subtitle ? "changed" : "same";
    return { key, category: a?.category || b?.category, icon: a?.icon || b?.icon, title: a?.title || b?.title, subtitle: a?.subtitle || b?.subtitle, left: a, right: b, fields, status };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

export function groupSections(diagnostic, query = "") {
  const q = query.trim().toLowerCase();
  const filtered = diagnostic.sections.filter(section => !q || section.name.toLowerCase().includes(q) || section.content.toLowerCase().includes(q));
  const groups = new Map();
  for (const section of filtered) {
    if (!groups.has(section.category)) groups.set(section.category, []);
    groups.get(section.category).push(section);
  }
  for (const sections of groups.values()) sections.sort((a, b) => Number(b.source === "config") - Number(a.source === "config") || a.name.localeCompare(b.name));
  return [...groups.entries()].sort((a, b) => CATEGORY_INFO[a[0]].order - CATEGORY_INFO[b[0]].order);
}

export function compareSections(left, right) {
  const keys = new Set([...left.sections.map(s => s.key), ...right.sections.map(s => s.key)]);
  return [...keys].map(key => {
    const a = left.sections.find(s => s.key === key);
    const b = right.sections.find(s => s.key === key);
    return { key, name: a?.name || b?.name, category: a?.category || b?.category, virtual: Boolean(a?.virtual || b?.virtual), left: a, right: b, status: !a ? "right-only" : !b ? "left-only" : a.content === b.content ? "same" : "changed" };
  }).sort((a, b) => CATEGORY_INFO[a.category].order - CATEGORY_INFO[b.category].order || a.name.localeCompare(b.name));
}

export function lineDiff(left = "", right = "") {
  const a = left === "" || left == null ? [] : left.split(/\r?\n/);
  const b = right === "" || right == null ? [] : right.split(/\r?\n/);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const out = a.slice(0, prefix).map(text => ({ type: "same", text }));
  const am = a.slice(prefix, a.length - suffix), bm = b.slice(prefix, b.length - suffix);
  if (am.length <= 5000 && bm.length <= 5000 && am.length * bm.length <= 1_200_000) {
    const dp = Array.from({ length: am.length + 1 }, () => new Uint32Array(bm.length + 1));
    for (let i = am.length - 1; i >= 0; i--) for (let j = bm.length - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) { out.push({ type: "same", text: am[i++] }); j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "removed", text: am[i++] });
      else out.push({ type: "added", text: bm[j++] });
    }
    while (i < am.length) out.push({ type: "removed", text: am[i++] });
    while (j < bm.length) out.push({ type: "added", text: bm[j++] });
  } else {
    const positions = new Map();
    bm.forEach((text, index) => { const list = positions.get(text) || []; list.push(index); positions.set(text, list); });
    const candidates = [];
    am.forEach((text, index) => { const list = positions.get(text); if (list?.length === 1) candidates.push([index, list[0]]); });
    const tails = [], previous = new Array(candidates.length).fill(-1);
    for (let index = 0; index < candidates.length; index++) {
      const value = candidates[index][1];
      let low = 0, high = tails.length;
      while (low < high) { const middle = (low + high) >> 1; if (candidates[tails[middle]][1] < value) low = middle + 1; else high = middle; }
      previous[index] = low ? tails[low - 1] : -1;
      tails[low] = index;
    }
    const anchors = [];
    for (let cursor = tails.at(-1); cursor !== undefined && cursor >= 0; cursor = previous[cursor]) anchors.push(candidates[cursor]);
    anchors.reverse();
    let i = 0, j = 0;
    const emitChanged = (ai, bj) => {
      while (i < ai || j < bj) {
        if (i < ai) out.push({ type: "removed", text: am[i++] });
        if (j < bj) out.push({ type: "added", text: bm[j++] });
      }
    };
    for (const [ai, bj] of anchors) {
      emitChanged(ai, bj);
      out.push({ type: "same", text: am[i++] });
      j++;
    }
    emitChanged(am.length, bm.length);
  }
  out.push(...a.slice(a.length - suffix).map(text => ({ type: "same", text })));
  return out;
}
