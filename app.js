import { CATEGORY_INFO, compareSections, compareSemantic, groupSections, lineDiff, parseDiagnostic, searchDiagnostic } from "./parser.js";

const state = { files: [], activeId: null, activeSection: null, activeCategory: "all", query: "", tab: "explore", compareLeft: null, compareRight: null, compareFilter: "all", compareSection: null, compareMode: "semantic" };
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const decodeDisplayEntities = value => String(value ?? "").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const formatBytes = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
const plural = (count, one, few, many) => count % 10 === 1 && count % 100 !== 11 ? one : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? few : many;
const platformHint = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
const formatTimestamp = value => {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(2)} ${match[4]}:${match[5]}:${match[6]} UTC` : value;
};
const wifiBandLabel = id => ({ WifiMaster0: "2.4 GHz", WifiMaster1: "5 GHz" })[id] || id;

const NAV_GROUP_ICONS = {
  status: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>`,
  internet: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.45 4 5.45 4 9s-1.4 6.55-4 9c-2.6-2.45-4-5.45-4-9s1.4-6.55 4-9z"/></svg>`,
  networks: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5a13 13 0 0 1 17 0M6.8 13a8.2 8.2 0 0 1 10.4 0M10 16.3a3.3 3.3 0 0 1 4 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/></svg>`,
  rules: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8 20 6v5.7c0 5.1-3.2 8.1-8 10-4.8-1.9-8-4.9-8-10V6z"/></svg>`,
  management: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(0 1.3)"><path d="m9.7 2.8.7-1.3h3.2l.7 1.3 1.7.7 1.4-.4 2.2 2.2-.4 1.4.7 1.7 1.3.7v3.2l-1.3.7-.7 1.7.4 1.4-2.2 2.2-1.4-.4-1.7.7-.7 1.3h-3.2l-.7-1.3-1.7-.7-1.4.4-2.2-2.2.4-1.4-.7-1.7-1.3-.7V9.1l1.3-.7.7-1.7-.4-1.4 2.2-2.2 1.4.4z"/><circle cx="12" cy="10.7" r="3.2"/></g></svg>`,
  telephony: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 3.5 10 8 8.1 9.9c1.2 2.4 3.1 4.3 5.5 5.5l1.9-1.9 4.5 2.8-.8 3.2c-.2.8-.9 1.3-1.7 1.2C10 19.8 4.2 14 3.3 6.5c-.1-.8.4-1.5 1.2-1.7z"/></svg>`,
};

const NAV_GROUPS = [
  { title: "Статус", icon: "status", categories: ["system", "traffic", "appTraffic", "wifiMonitor"] },
  { title: "Интернет", icon: "internet", categories: ["internet", "vpn"] },
  { title: "Мои сети и Wi‑Fi", icon: "networks", categories: ["interfaces", "wifi", "mws", "hosts", "dhcp", "qos"] },
  { title: "Сетевые правила", icon: "rules", categories: ["internetFilters", "firewall", "networkRules", "routing", "remoteAccess", "wifiAccess", "ipv6"] },
  { title: "Управление", icon: "management", categories: ["general", "usb", "services", "users", "diagnostics", "configuration", "other"] },
  { title: "Телефония", icon: "telephony", categories: ["telephony"] },
];

const themeMedia = matchMedia("(prefers-color-scheme: dark)");
function readStoredTheme() {
  try { return localStorage.getItem("diagdigger-theme") || "auto"; } catch { return "auto"; }
}
function storeTheme(mode) {
  try { localStorage.setItem("diagdigger-theme", mode); } catch {}
}
let themeMode = readStoredTheme();
function applyTheme(mode) {
  themeMode = mode;
  storeTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === "auto" ? (themeMedia.matches ? "dark" : "light") : mode;
  const select = $("#themeSelect");
  if (select) select.value = mode;
}
themeMedia.addEventListener("change", () => { if (themeMode === "auto") applyTheme("auto"); });
applyTheme(themeMode);

function toast(message, error = false, action = null) {
  const el = $("#toast");
  el.replaceChildren();
  const text = document.createElement("span"); text.textContent = message; text.setAttribute("role", error ? "alert" : "status"); text.setAttribute("aria-live", error ? "assertive" : "polite"); el.append(text);
  if (action) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = action.label; button.addEventListener("click", action.callback, { once: true }); el.append(button);
    requestAnimationFrame(() => button.focus());
  }
  el.classList.toggle("error", error); el.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add("hidden"), action ? 10_000 : 3200);
}

async function loadFiles(fileList) {
  const errors = [];
  for (const file of Array.from(fileList)) {
    try {
      const text = await file.text();
      const diagnostic = parseDiagnostic(file.name, text);
      if (state.files.some(item => item.filename === diagnostic.filename && item.size === diagnostic.size && item.text === diagnostic.text)) continue;
      state.files.push(diagnostic); state.activeId ||= diagnostic.id;
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  if (errors.length) toast(errors.join("\n"), true);
  if (!state.files.length) return;
  state.compareLeft ||= state.files[0].id;
  if (!state.compareRight || (state.compareRight === state.compareLeft && state.files.length > 1)) {
    state.compareRight = state.files.find(file => file.id !== state.compareLeft)?.id || state.compareLeft;
  }
  state.activeSection = null;
  render();
}

function render() {
  $("#emptyState").classList.toggle("hidden", state.files.length > 0);
  $("#workspace").classList.toggle("hidden", !state.files.length);
  $("#headerFilePicker").classList.toggle("hidden", !state.files.length);
  $("#compareBadge").textContent = state.files.length;
  renderNavigation();
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  });
  if (state.tab === "explore") renderExplore(); else renderCompare();
  updateDocumentTitle();
}

function updateDocumentTitle() {
  const file = state.files.find(item => item.id === state.activeId) || state.files[0];
  if (!file) { document.title = "DiagDigger — разбор диагностик"; return; }
  const section = file.sections.find(item => item.key === state.activeSection);
  const view = state.tab === "compare" ? "Сравнение" : section?.name || (state.activeCategory === "all" ? "Обзор" : CATEGORY_INFO[state.activeCategory]?.title || "Обзор");
  document.title = `${view} · ${file.meta.device} — DiagDigger`;
}

function focusHeading(selector) {
  requestAnimationFrame(() => {
    const heading = document.querySelector(selector);
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

function renderNavigation() {
  const file = state.files.find(item => item.id === state.activeId) || state.files[0];
  if (!file) return;
  const groups = groupSections(file);
  const sectionsByCategory = new Map(groups);
  if (state.activeCategory !== "all" && !groups.some(([key]) => key === state.activeCategory)) state.activeCategory = "all";
  $("#globalFileSelect").innerHTML = state.files.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === file.id ? "selected" : ""}>${escapeHtml(item.meta.device)} · ${escapeHtml(item.meta.model)} · ${escapeHtml(item.meta.version)}</option>`).join("");
  $("#removeCurrentFile").dataset.removeId = file.id;
  $("#categoryNav").innerHTML = `
    ${NAV_GROUPS.map((group, index) => {
      const overviewActive = state.tab === "explore" && state.activeCategory === "all";
      const overview = index === 0 ? `<button data-nav-category="all" ${overviewActive ? 'aria-current="page"' : ""} aria-label="Обзор диагностики" title="Обзор диагностики" class="nav-subitem ${overviewActive ? "active" : ""}"><span class="nav-icon">⌂</span><span>Обзор диагностики</span><span class="nav-count">${file.sections.length}</span></button>` : "";
      const items = renderNavCategories(group.categories, sectionsByCategory);
      return overview || items ? `<section class="nav-group"><div class="nav-group-title"><span class="nav-group-icon">${NAV_GROUP_ICONS[group.icon]}</span><span>${group.title}</span></div>${overview}${items}</section>` : "";
    }).join("")}
    <section class="nav-group nav-tools"><div class="nav-group-title"><span class="nav-group-icon">⇄</span><span>Инструменты</span></div><button data-nav-compare ${state.tab === "compare" ? 'aria-current="page"' : ""} aria-label="Сравнение диагностик" title="Сравнение диагностик" class="nav-subitem ${state.tab === "compare" ? "active" : ""}"><span class="nav-icon">⇄</span><span>Сравнение</span><span class="nav-count">${state.files.length}</span></button></section>`;
}

function renderNavCategories(keys, sectionsByCategory) {
  return keys.map(key => {
    const sections = sectionsByCategory.get(key);
    if (!sections?.length) return "";
    const info = CATEGORY_INFO[key];
    const active = state.tab === "explore" && state.activeCategory === key;
    return `<button data-nav-category="${key}" ${active ? 'aria-current="page"' : ""} aria-label="${escapeHtml(info.title)}" title="${escapeHtml(info.title)}" class="nav-subitem ${active ? "active" : ""}"><span class="nav-icon">${info.icon}</span><span>${info.title}</span><span class="nav-count">${sections.length}</span></button>`;
  }).join("");
}

function renderExplore() {
  const file = state.files.find(f => f.id === state.activeId) || state.files[0];
  if (!file) return;
  const allGroups = groupSections(file);
  const groups = state.activeCategory === "all" ? allGroups : allGroups.filter(([key]) => key === state.activeCategory);
  const allSections = groups.flatMap(([, sections]) => sections);
  let selected = allSections.find(s => s.key === state.activeSection);
  if (!selected && state.activeSection) state.activeSection = null;
  const categoryInfo = state.activeCategory === "all" ? null : CATEGORY_INFO[state.activeCategory];
  $("#exploreView").innerHTML = `
    <div class="view-head">
      <div><div class="eyebrow">${escapeHtml(file.meta.model)} · ${escapeHtml(file.meta.device)}</div><h1>${categoryInfo ? escapeHtml(categoryInfo.title) : "Обзор диагностики"}</h1><p>${escapeHtml(file.filename)}</p></div>
      <div class="meta-grid">
        <div><span>Устройство</span><b>${escapeHtml(file.meta.device)}</b></div>
        <div><span>Прошивка</span><b>${escapeHtml(file.meta.release)}</b></div><div><span>Размер</span><b>${formatBytes(file.size)}</b></div>
        <div><span>Регион</span><b>${escapeHtml(file.meta.region)}</b></div>
        <div><span>Sandbox</span><b>${escapeHtml(file.meta.sandbox)}</b></div>
        <div><span>NDM exact</span><b>${escapeHtml(file.meta.ndmExact)}</b><small>${escapeHtml(file.meta.ndmCdate)}</small></div><div><span>BSP exact</span><b>${escapeHtml(file.meta.bspExact)}</b><small>${escapeHtml(file.meta.bspCdate)}</small></div>
        ${file.meta.temperatures.length ? `<div class="temperature-meta"><span>Температуры</span>${file.meta.temperatures.map(sensor => `<b>${escapeHtml(wifiBandLabel(sensor.id))} · ${escapeHtml(sensor.value)} °C</b>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="search-wrap"><span>⌕</span><input id="searchInput" value="${escapeHtml(state.query)}" placeholder="Поиск по секциям и содержимому…" aria-label="Поиск по секциям и содержимому" />${state.query ? `<button class="search-clear" id="clearSearch" aria-label="Очистить поиск" title="Очистить поиск">×</button>` : `<kbd>${platformHint}</kbd>`}</div>
    ${selected ? renderSectionDetail(selected) : state.query.trim() ? renderSearchResults(file, state.query) : `
      <div class="category-grid ${state.activeCategory !== "all" ? "single" : ""}">
        ${groups.map(([key, sections]) => renderCategory(key, sections, state.query.trim(), state.activeCategory !== "all")).join("") || `<div class="empty-results">Ничего не найдено. Попробуйте изменить запрос.</div>`}
      </div>`}`;
}

function renderSearchResults(file, query) {
  const hits = searchDiagnostic(file, query);
  const grouped = hits.reduce((map, hit) => { if (!map.has(hit.section)) map.set(hit.section, []); map.get(hit.section).push(hit); return map; }, new Map());
  const sectionLink = name => file.sections.find(section => section.key === `raw:${name}` || section.name === name);
  return `<section class="search-results">
    <div class="search-results-head"><div><span>Результаты поиска</span><h2>${hits.truncated ? "Показаны первые " : ""}${hits.length} ${plural(hits.length, "упоминание", "упоминания", "упоминаний")} в ${grouped.size} ${plural(grouped.size, "разделе", "разделах", "разделах")}</h2>${hits.truncated ? `<p>Выдача ограничена. Уточните запрос, чтобы увидеть нужное совпадение.</p>` : ""}</div><code>${escapeHtml(query)}</code></div>
    ${hits.length ? [...grouped].map(([name, items]) => {
      const linked = sectionLink(name);
      return `<article class="search-result-group"><div class="search-result-group-head"><div><span>${items[0].sectionType === "file" ? "Секция диагностики" : items[0].sectionType === "interface" ? "XML-интерфейс" : items[0].sectionType === "derived" ? "Производные данные" : "XML диагностики"}</span><h3>${escapeHtml(name)}</h3></div><b>${items.length}</b>${linked ? `<button data-search-section="${escapeHtml(linked.key)}">Открыть секцию</button>` : ""}</div><div class="search-hit-list">${items.map(hit => renderSearchHit(hit, query)).join("")}</div></article>`;
    }).join("") : `<div class="empty-results">Совпадений во всём файле диагностики нет.<button type="button" id="emptySearchClear">Очистить поиск</button></div>`}
  </section>`;
}

function renderSearchHit(hit, query) {
  const location = [hit.line ? `строка файла ${hit.line}` : null, hit.sectionLine ? `строка раздела ${hit.sectionLine}` : null, `столбец ${hit.column}`].filter(Boolean).join(" · ");
  const representations = hit.sections?.length > 1 ? `<div class="search-hit-sections" title="${escapeHtml(hit.sections.join(" · "))}">Представления: ${escapeHtml(hit.sections.join(" · "))}</div>` : "";
  return `<div class="search-hit"><div class="search-hit-location">${location}</div>${representations}<pre>${hit.before ? `<span>${escapeHtml(decodeDisplayEntities(hit.before))}</span>\n` : ""}${highlight(hit.text, query)}${hit.after ? `\n<span>${escapeHtml(decodeDisplayEntities(hit.after))}</span>` : ""}</pre></div>`;
}

function renderCategory(key, sections, query, expanded = false) {
  const info = CATEGORY_INFO[key];
  const limit = expanded ? sections.length : query.trim() ? 30 : 7;
  return `<article class="category-card">
    <div class="category-head"><span class="category-icon">${info.icon}</span><div><h2>${info.title}</h2><small>${sections.length} ${plural(sections.length, "секция", "секции", "секций")}</small></div></div>
    <div class="section-list">${sections.slice(0, limit).map(renderSectionButton).join("")}</div>
    ${sections.length > limit ? `<button class="show-more" data-category="${key}">Ещё ${sections.length - limit}</button>` : ""}
  </article>`;
}

function renderSectionButton(section) {
  const count = section.content.split(/\r?\n/).length;
  const isConfig = section.source === "config";
  return `<button data-section-key="${escapeHtml(section.key)}" class="${isConfig ? "config-section" : ""}">${isConfig ? `<em>Настройка</em>` : ""}<span>${escapeHtml(section.name)}</span><small>${count} ${plural(count, "строка", "строки", "строк")}</small><b>›</b></button>`;
}

function renderSectionDetail(section) {
  if (section.presentation === "associations") return renderAssociations(section);
  if (section.presentation === "json") return renderJsonSection(section);
  if (["devices", "neighbours", "traffic-hosts", "arp", "proxies", "xml-records"].includes(section.presentation)) return renderHumanXmlSection(section);
  if (["ip-policy", "ip-routes", "ipv6-routes", "dhcp-pools", "cpustat"].includes(section.presentation)) return renderStructuredXmlSection(section);
  return `<div class="section-detail">
    <div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>${CATEGORY_INFO[section.category].title}</span><h2>${escapeHtml(section.name)}</h2></div><button class="copy-button" id="copySection">Копировать</button></div>
    <pre class="code-view" tabindex="0" role="region" aria-label="Содержимое секции ${escapeHtml(section.name)}"><code>${highlight(section.content, state.query)}</code></pre>
  </div>`;
}

const isJsonObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function jsonScalar(value) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

function renderJsonComplexValue(value) {
  const serialized = JSON.stringify(value, null, 2);
  const summary = Array.isArray(value) ? `${value.length} ${plural(value.length, "элемент", "элемента", "элементов")}` : `${Object.keys(value).length} ${plural(Object.keys(value).length, "поле", "поля", "полей")}`;
  return `<details class="json-cell-details"><summary>${summary}</summary><pre tabindex="0" role="region" aria-label="Раскрытое содержимое JSON"><code>${escapeHtml(serialized)}</code></pre></details>`;
}

function renderJsonTable(items, title = "Объекты") {
  const columns = [...new Set(items.flatMap(item => Object.keys(item)))];
  return `<section class="json-group json-collection"><div class="json-group-head"><h3>${escapeHtml(title)}</h3><span>${items.length} ${plural(items.length, "объект", "объекта", "объектов")}</span></div><div class="json-table-wrap" tabindex="0" role="region" aria-label="Таблица ${escapeHtml(title)}"><table class="json-table"><thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${items.map(item => `<tr>${columns.map(column => {
    const value = item[column];
    return `<td>${value !== null && typeof value === "object" ? renderJsonComplexValue(value) : `<code>${escapeHtml(value === undefined ? "—" : jsonScalar(value))}</code>`}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}

function renderJsonArray(values, title) {
  if (values.length && values.every(isJsonObject)) return renderJsonTable(values, title);
  if (values.length <= 12 && values.every(value => value === null || typeof value !== "object")) {
    return `<section class="json-group"><div class="json-group-head"><h3>${escapeHtml(title)}</h3><span>${values.length ? `${values.length} ${plural(values.length, "значение", "значения", "значений")}` : "Пустой массив"}</span></div>${values.length ? `<div class="json-values">${values.map(value => `<code>${escapeHtml(jsonScalar(value))}</code>`).join("")}</div>` : ""}</section>`;
  }
  return `<section class="json-group"><div class="json-group-head"><h3>${escapeHtml(title)}</h3></div>${renderJsonComplexValue(values)}</section>`;
}

function renderJsonObject(object, title = "") {
  const entries = Object.entries(object);
  const scalarEntries = entries.filter(([, value]) => value === null || typeof value !== "object");
  const complexEntries = entries.filter(([, value]) => value !== null && typeof value === "object");
  return `<section class="json-group">${title ? `<div class="json-group-head"><h3>${escapeHtml(title)}</h3></div>` : ""}${scalarEntries.length ? `<dl class="json-fields">${scalarEntries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd><code>${escapeHtml(jsonScalar(value))}</code></dd></div>`).join("")}</dl>` : ""}${complexEntries.map(([key, value]) => Array.isArray(value) ? renderJsonArray(value, key) : renderJsonObject(value, key)).join("")}</section>`;
}

function renderJsonSection(section) {
  const data = JSON.parse(section.content);
  const visualization = Array.isArray(data) ? renderJsonArray(data, "Объекты") : renderJsonObject(data);
  return `<div class="section-detail json-section"><div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>${CATEGORY_INFO[section.category].title}</span><h2>${escapeHtml(section.name)}</h2></div><button class="copy-button" id="copySection">Копировать</button></div><div class="json-view"><p class="json-summary">Структурированное представление JSON</p>${visualization}<details class="json-raw"><summary>Исходный JSON</summary><pre class="code-view" tabindex="0" role="region" aria-label="Исходный JSON секции ${escapeHtml(section.name)}"><code>${highlight(section.content, state.query)}</code></pre></details></div></div>`;
}

function parseXmlFragment(content) {
  const document = new DOMParser().parseFromString(`<root>${content}</root>`, "application/xml");
  return document.querySelector("parsererror") ? null : document.documentElement;
}

function directXmlValue(element, name) {
  return [...element.children].find(child => child.tagName === name)?.textContent?.trim() || "—";
}

function directXmlElement(element, name) {
  return [...element.children].find(child => child.tagName === name) || null;
}

function nestedXmlValue(element, parent, name) {
  const container = directXmlElement(element, parent);
  return container ? directXmlValue(container, name) : "—";
}

const XML_FIELD_LABELS = {
  name: "Имя", hostname: "Имя устройства", mac: "MAC-адрес", ip: "IPv4-адрес", ip6: "IPv6-адрес",
  address: "Адрес", "address-family": "Протокол", interface: "Интерфейс", state: "Состояние",
  active: "Активен", link: "Подключение", wireless: "Тип связи", "last-seen": "Последняя активность",
  uptime: "В сети", rxbytes: "Получено", txbytes: "Отправлено", access: "Доступ", priority: "Приоритет",
  ssid: "Сеть Wi‑Fi", ap: "Точка доступа", rssi: "Сигнал", mode: "Стандарт", security: "Защита",
  fqdn: "Доменное имя", proto: "Протокол", upstream: "Назначение", host: "Узел", allow: "Доступ", ndns: "Удалённый доступ",
  description: "Описание", firmware: "Прошивка", expired: "Срок аренды", leasetime: "Аренда",
};

function humanXmlValue(name, value) {
  if (value === "—" || value === "") return "—";
  if (["rxbytes", "txbytes"].includes(name)) return formatTraffic(value);
  if (["uptime", "last-seen", "leasetime"].includes(name)) return formatUptime(value);
  if (name === "wireless") return value === "yes" ? "Wi‑Fi" : "Кабель";
  if (["active", "ndns"].includes(name)) return value === "yes" ? "Да" : value === "no" ? "Нет" : value;
  if (name === "expired") return value === "yes" ? "Истёк" : value === "no" ? "Действует" : value;
  return value;
}

function humanState(value) {
  return ({ yes: "В сети", no: "Неактивен", up: "В сети", down: "Отключён", REACHABLE: "Доступен", STALE: "Неактивен", active: "Активен", expired: "Истёк" })[value] || value || "Состояние неизвестно";
}

function renderHumanCard({ title, subtitle = "", status = "", online = true, primary = "", fields = [] }) {
  const visibleFields = fields.filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== "—");
  return `<article class="association-card record-card"><div><code>${escapeHtml(title || "Без имени")}</code>${status ? `<span class="association-status ${online ? "online" : "offline"}">${escapeHtml(status)}</span>` : ""}</div>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}${primary ? `<strong>${escapeHtml(primary)}</strong>` : ""}<dl>${visibleFields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></article>`;
}

function renderDeviceRecord(host) {
  const active = directXmlValue(host, "active") === "yes" && directXmlValue(host, "link") !== "down";
  const name = [directXmlValue(host, "name"), directXmlValue(host, "hostname"), directXmlValue(host, "mac")].find(value => value !== "—");
  const connection = directXmlValue(host, "ssid") !== "—" ? `${directXmlValue(host, "ssid")} · ${directXmlValue(host, "ap")}` : nestedXmlValue(host, "interface", "name");
  const speed = directXmlValue(host, "txrate") !== "—" ? `${directXmlValue(host, "txrate")} Мбит/с` : directXmlValue(host, "speed") !== "—" ? `${directXmlValue(host, "speed")} Мбит/с` : "—";
  return renderHumanCard({
    title: name, subtitle: directXmlValue(host, "mac"), status: active ? "В сети" : "Не в сети", online: active,
    primary: directXmlValue(host, "ip"),
    fields: [["Подключение", connection], ["Скорость", speed], ["Сигнал", directXmlValue(host, "rssi") === "—" ? "—" : `${directXmlValue(host, "rssi")} dBm`], ["Трафик", `↓ ${formatTraffic(directXmlValue(host, "rxbytes"))} / ↑ ${formatTraffic(directXmlValue(host, "txbytes"))}`], ["В сети", formatUptime(directXmlValue(host, "uptime"))], ["Доступ", directXmlValue(host, "access")], ["DNS-фильтр", nestedXmlValue(host, "dns-filter", "profile")]],
  });
}

function neighbourAddresses(neighbour) {
  const direct = directXmlValue(neighbour, "address");
  if (direct !== "—") return direct;
  const container = directXmlElement(neighbour, "addresses");
  if (!container) return "—";
  return [...container.children].map(item => directXmlValue(item, "address")).filter(value => value !== "—").join(", ") || "—";
}

function renderNeighbourRecord(neighbour) {
  const expired = directXmlValue(neighbour, "expired") === "yes";
  const description = directXmlValue(neighbour, "description");
  return renderHumanCard({
    title: description !== "—" ? description : directXmlValue(neighbour, "mac"), subtitle: directXmlValue(neighbour, "mac"), status: expired ? "Истёк" : "Обнаружен", online: !expired,
    primary: neighbourAddresses(neighbour),
    fields: [["Интерфейс", directXmlValue(neighbour, "interface")], ["Протокол", directXmlValue(neighbour, "address-family").toUpperCase()], ["Тип связи", humanXmlValue("wireless", directXmlValue(neighbour, "wireless"))], ["Последняя активность", formatUptime(directXmlValue(neighbour, "last-seen"))], ["Аренда", formatUptime(directXmlValue(neighbour, "leasetime"))], ["Прошивка", directXmlValue(neighbour, "firmware")]],
  });
}

function renderArpRecord(arp) {
  const state = directXmlValue(arp, "state");
  return renderHumanCard({ title: directXmlValue(arp, "name") !== "—" ? directXmlValue(arp, "name") : directXmlValue(arp, "mac"), subtitle: directXmlValue(arp, "mac"), status: humanState(state), online: state === "REACHABLE", primary: directXmlValue(arp, "ip"), fields: [["Интерфейс", directXmlValue(arp, "interface")]] });
}

function renderProxyRecord(proxy) {
  const enabled = directXmlValue(proxy, "ndns") === "yes";
  return renderHumanCard({ title: directXmlValue(proxy, "name"), subtitle: directXmlValue(proxy, "proto").toUpperCase(), status: enabled ? "Опубликован" : "Локальный", online: enabled, primary: directXmlValue(proxy, "fqdn"), fields: [["Назначение", directXmlValue(proxy, "upstream")], ["Узел", directXmlValue(proxy, "host")], ["Доступ", directXmlValue(proxy, "allow")]] });
}

function renderTrafficHostRecord(record) {
  const host = directXmlElement(record, "host") || record;
  const applications = [...record.children].filter(child => child.tagName === "application");
  const totals = applications.reduce((sum, app) => ({ rx: sum.rx + (Number(directXmlValue(app, "rxbytes")) || 0), tx: sum.tx + (Number(directXmlValue(app, "txbytes")) || 0) }), { rx: 0, tx: 0 });
  const top = applications.map(app => ({ name: directXmlValue(app, "long"), bytes: (Number(directXmlValue(app, "rxbytes")) || 0) + (Number(directXmlValue(app, "txbytes")) || 0) })).sort((a, b) => b.bytes - a.bytes).slice(0, 4).map(app => app.name).join(", ");
  const name = [directXmlValue(host, "name"), directXmlValue(host, "hostname"), directXmlValue(record, "mac")].find(value => value !== "—");
  return renderHumanCard({ title: name, subtitle: directXmlValue(record, "mac"), status: `${applications.length} ${plural(applications.length, "приложение", "приложения", "приложений")}`, online: true, primary: directXmlValue(host, "ip"), fields: [["Операционная система", directXmlValue(record, "os-long")], ["Основные приложения", top], ["Трафик приложений", `↓ ${formatTraffic(totals.rx)} / ↑ ${formatTraffic(totals.tx)}`], ["Подключение", nestedXmlValue(host, "interface", "name")]] });
}

function genericXmlRecords(root) {
  let records = [...root.children];
  if (records.length === 1 && /^(response|result|list|items)$/i.test(records[0].tagName) && records[0].children.length) records = [...records[0].children];
  return records;
}

function renderGenericXmlRecord(record) {
  const scalars = [...record.children].filter(child => !child.children.length && child.textContent.trim()).slice(0, 10);
  const value = name => directXmlValue(record, name);
  const title = [value("name"), value("hostname"), value("description"), value("fqdn"), value("mac"), value("address"), value("id")].find(item => item !== "—") || record.tagName;
  const state = [value("state"), value("status"), value("active"), value("link")].find(item => item !== "—") || "";
  return renderHumanCard({ title, status: state ? humanState(state) : "", online: !/^(no|down|expired|STALE)$/i.test(state), fields: scalars.filter(child => !["name", "hostname", "description"].includes(child.tagName)).map(child => [XML_FIELD_LABELS[child.tagName] || child.tagName.replaceAll("-", " "), humanXmlValue(child.tagName, child.textContent.trim())]) });
}

function renderHumanXmlSection(section) {
  const root = parseXmlFragment(section.content);
  const records = root ? genericXmlRecords(root) : [];
  let cards = [];
  if (section.presentation === "devices") cards = records.filter(item => item.tagName === "host").map(renderDeviceRecord);
  else if (section.presentation === "neighbours") cards = records.filter(item => item.tagName === "neighbour").map(renderNeighbourRecord);
  else if (section.presentation === "traffic-hosts") cards = records.filter(item => item.tagName === "host").map(renderTrafficHostRecord);
  else if (section.presentation === "arp") cards = records.filter(item => item.tagName === "arp").map(renderArpRecord);
  else if (section.presentation === "proxies") cards = records.filter(item => item.tagName === "proxy").map(renderProxyRecord);
  else cards = records.map(renderGenericXmlRecord);
  const label = cards.length ? `${cards.length} ${plural(cards.length, "запись", "записи", "записей")}` : "Структурированных записей нет";
  return `<div class="section-detail human-xml-section"><div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>${CATEGORY_INFO[section.category].title}</span><h2>${escapeHtml(section.name)}</h2></div><button class="copy-button" id="copySection">Копировать</button></div><p class="association-summary">${label}. Данные представлены в удобном виде; исходный XML доступен ниже.</p><div class="association-grid record-grid">${cards.join("") || `<div class="empty-results">Не удалось выделить записи из этого XML.</div>`}</div><details class="json-raw human-xml-raw"><summary>Исходный XML</summary><pre class="code-view" tabindex="0" role="region" aria-label="Исходный XML секции ${escapeHtml(section.name)}"><code>${highlight(section.content, state.query)}</code></pre></details></div>`;
}

function renderDataTable(title, rows, columns) {
  return `<section class="json-group json-collection"><div class="json-group-head"><h3>${escapeHtml(title)}</h3><span>${rows.length} ${plural(rows.length, "запись", "записи", "записей")}</span></div><div class="json-table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(title)}"><table class="json-table"><thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([key]) => `<td><code>${escapeHtml(row[key] ?? "—")}</code></td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
}

function routeRows(root, routeTag) {
  return [...root.getElementsByTagName(routeTag)].map(route => {
    const table = route.parentElement.tagName.match(/^table_(\d+)$/)?.[1] || "—";
    return { table, destination: directXmlValue(route, "destination"), gateway: directXmlValue(route, "gateway"), interface: directXmlValue(route, "interface"), metric: directXmlValue(route, "metric"), proto: directXmlValue(route, "proto"), flags: directXmlValue(route, "flags") };
  });
}

function renderStructuredXmlSection(section) {
  const root = parseXmlFragment(section.content);
  let visualization = `<div class="empty-results">Не удалось разобрать структурированные данные.</div>`;
  if (root && section.presentation === "ip-policy") {
    const rows = [...root.getElementsByTagName("policy")].flatMap(policy => [...policy.getElementsByTagName("route"), ...policy.getElementsByTagName("route6")].map(route => ({ policy: policy.getAttribute("name") || "—", description: policy.getAttribute("description") || "—", family: route.tagName === "route6" ? "IPv6" : "IPv4", destination: directXmlValue(route, "destination"), gateway: directXmlValue(route, "gateway"), interface: directXmlValue(route, "interface"), metric: directXmlValue(route, "metric") })));
    visualization = renderDataTable("Маршруты по политикам", rows, [["policy", "Политика"], ["description", "Описание"], ["family", "Протокол"], ["destination", "Назначение"], ["gateway", "Шлюз"], ["interface", "Интерфейс"], ["metric", "Метрика"]]);
  } else if (root && ["ip-routes", "ipv6-routes"].includes(section.presentation)) {
    const rows = routeRows(root, section.presentation === "ipv6-routes" ? "route6" : "route");
    visualization = renderDataTable(section.presentation === "ipv6-routes" ? "Таблица маршрутов IPv6" : "Таблица маршрутов IPv4", rows, [["table", "Таблица"], ["destination", "Назначение"], ["gateway", "Шлюз"], ["interface", "Интерфейс"], ["metric", "Метрика"], ["proto", "Источник"], ["flags", "Флаги"]]);
  } else if (root && section.presentation === "dhcp-pools") {
    const rows = [...root.getElementsByTagName("pool")].map(pool => ({ name: pool.getAttribute("name") || "—", interface: directXmlValue(pool, "interface"), network: directXmlValue(pool, "network"), range: `${directXmlValue(pool, "begin")} — ${directXmlValue(pool, "end")}`, router: directXmlValue(pool, "router"), usage: `${directXmlValue(pool, "used")} / ${directXmlValue(pool, "size")}`, lease: directXmlValue(pool, "lease"), state: directXmlValue(pool, "state") }));
    visualization = renderDataTable("Пулы адресов", rows, [["name", "Пул"], ["interface", "Интерфейс"], ["network", "Сеть"], ["range", "Диапазон"], ["router", "Шлюз"], ["usage", "Занято / всего"], ["lease", "Аренда, с"], ["state", "Состояние"]]);
  } else if (root && section.presentation === "cpustat") {
    const interval = directXmlValue(root, "interval");
    const rows = [...root.children].filter(item => item.tagName !== "interval").map(item => ({ metric: ({ busy: "Занято", user: "Пользователь", nice: "Nice", system: "Система", iowait: "Ожидание I/O", irq: "IRQ", sirq: "Soft IRQ" })[item.tagName] || item.tagName, current: directXmlValue(item, "cur"), average: directXmlValue(item, "avg"), minimum: directXmlValue(item, "min"), maximum: directXmlValue(item, "max") }));
    visualization = `<p class="json-summary">Интервал измерения: ${escapeHtml(interval)} с</p>${renderDataTable("Загрузка CPU, %", rows, [["metric", "Показатель"], ["current", "Сейчас"], ["average", "Среднее"], ["minimum", "Минимум"], ["maximum", "Максимум"]])}`;
  }
  return `<div class="section-detail structured-xml-section"><div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>${CATEGORY_INFO[section.category].title}</span><h2>${escapeHtml(section.name)}</h2></div><button class="copy-button" id="copySection">Копировать</button></div><div class="json-view"><p class="json-summary">Структурированное представление XML</p>${visualization}<details class="json-raw"><summary>Исходный XML</summary><pre class="code-view" tabindex="0" role="region" aria-label="Исходный XML секции ${escapeHtml(section.name)}"><code>${highlight(section.content, state.query)}</code></pre></details></div></div>`;
}

function xmlField(fragment, name) {
  return fragment.match(new RegExp(`<${name}>\\s*([^<]*)\\s*<\\/${name}>`, "i"))?.[1]?.trim() || "—";
}

function formatTraffic(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
}

function formatUptime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return "—";
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return [days && `${days} д`, hours && `${hours} ч`, `${minutes} мин`].filter(Boolean).join(" ");
}

function renderAssociations(section) {
  const stations = [...section.content.matchAll(/<station>\s*([\s\S]*?)\s*<\/station>/gi)].map(match => match[1]);
  return `<div class="section-detail wifi-associations"><div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>Wi‑Fi</span><h2>Подключённые устройства</h2></div><button class="copy-button" id="copySection">Копировать</button></div>
    <p class="association-summary">${stations.length} ${plural(stations.length, "устройство", "устройства", "устройств")} подключено к точкам доступа.</p>
    <div class="association-grid">${stations.map(station => {
      const authenticated = xmlField(station, "authenticated") === "yes";
      return `<article class="association-card"><div><code>${escapeHtml(xmlField(station, "mac"))}</code><span class="association-status ${authenticated ? "online" : "offline"}">${authenticated ? "Подключено" : "Не авторизовано"}</span></div><small>${escapeHtml(xmlField(station, "ap"))}</small><strong>${escapeHtml(xmlField(station, "rssi"))} dBm</strong><dl><div><dt>Скорость</dt><dd>↓ ${escapeHtml(xmlField(station, "rxrate"))} / ↑ ${escapeHtml(xmlField(station, "txrate"))} Мбит/с</dd></div><div><dt>Стандарт</dt><dd>${escapeHtml(xmlField(station, "mode"))} · ${escapeHtml(xmlField(station, "ht"))} МГц · MCS ${escapeHtml(xmlField(station, "mcs"))}</dd></div><div><dt>Трафик</dt><dd>↓ ${formatTraffic(xmlField(station, "rxbytes"))} / ↑ ${formatTraffic(xmlField(station, "txbytes"))}</dd></div><div><dt>В сети</dt><dd>${formatUptime(xmlField(station, "uptime"))}</dd></div><div><dt>Защита</dt><dd>${escapeHtml(xmlField(station, "security"))}</dd></div></dl></article>`;
    }).join("") || `<div class="empty-results">Подключённых Wi‑Fi-устройств нет.</div>`}</div></div>`;
}

function highlight(text, query) {
  text = decodeDisplayEntities(text);
  if (!query.trim()) return escapeHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).split(new RegExp(`(${escaped})`, "gi")).map((part, index) => index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
}

function renderCompare() {
  if (state.files.length < 2) {
    $("#compareView").innerHTML = `<div class="compare-empty"><div>⇄</div><h1>Добавьте второй файл</h1><p>Для сравнения нужны две диагностики.</p><button class="button button-primary" id="compareUpload">Добавить файл</button></div>`;
    return;
  }
  const left = state.files.find(f => f.id === state.compareLeft) || state.files[0];
  const right = state.files.find(f => f.id === state.compareRight) || state.files[1];
  if (state.compareMode === "semantic") { renderSemanticCompare(left, right); return; }
  const comparison = compareSections(left, right);
  const counts = Object.fromEntries(["same", "changed", "left-only", "right-only"].map(k => [k, comparison.filter(x => x.status === k).length]));
  const visible = comparison.filter(item => state.compareFilter === "all" || item.status === state.compareFilter);
  const selected = comparison.find(item => item.key === state.compareSection);
  $("#compareView").innerHTML = `
    ${renderCompareHeader(left, right)}
    <div class="summary-strip">
      <button data-filter="all" class="${state.compareFilter === "all" ? "active" : ""}"><b>${comparison.length}</b><span>Все секции</span></button>
      <button data-filter="changed" class="changed ${state.compareFilter === "changed" ? "active" : ""}"><b>${counts.changed}</b><span>Изменены</span></button>
      <button data-filter="left-only" class="removed ${state.compareFilter === "left-only" ? "active" : ""}"><b>${counts["left-only"]}</b><span>Только слева</span></button>
      <button data-filter="right-only" class="added ${state.compareFilter === "right-only" ? "active" : ""}"><b>${counts["right-only"]}</b><span>Только справа</span></button>
      <button data-filter="same" class="${state.compareFilter === "same" ? "active" : ""}"><b>${counts.same}</b><span>Совпадают</span></button>
    </div>
    ${selected ? renderDiff(selected, left, right) : `<div class="compare-table"><div class="compare-row compare-table-head"><span>Секция</span><span>Категория</span><span>Состояние</span><span></span></div>${visible.map(renderCompareRow).join("") || `<div class="empty-results">В этой группе нет секций.</div>`}</div>`}`;
}

function renderCompareHeader(left, right) {
  return `<div class="compare-head"><div><div class="eyebrow">Сравнение диагностик</div><h1>Что изменилось?</h1><div class="mode-switch"><button data-compare-mode="semantic" class="${state.compareMode === "semantic" ? "active" : ""}">Понятное сравнение</button><button data-compare-mode="raw" class="${state.compareMode === "raw" ? "active" : ""}">Сырые секции</button></div></div><div class="compare-selects">${renderSelect("leftSelect", left.id, "Диагностика слева")}<span>⇄</span>${renderSelect("rightSelect", right.id, "Диагностика справа")}</div></div>`;
}

function renderSemanticCompare(left, right) {
  const comparison = compareSemantic(left, right);
  const counts = Object.fromEntries(["same", "changed", "left-only", "right-only"].map(k => [k, comparison.filter(x => x.status === k).length]));
  const visible = comparison.filter(item => state.compareFilter === "all" || item.status === state.compareFilter);
  const selected = comparison.find(item => item.key === state.compareSection);
  const groups = visible.reduce((acc, item) => ((acc[item.category] ||= []).push(item), acc), {});
  $("#compareView").innerHTML = `${renderCompareHeader(left, right)}
    <div class="summary-strip semantic-summary">
      <button data-filter="all" class="${state.compareFilter === "all" ? "active" : ""}"><b>${comparison.length}</b><span>Все объекты</span></button>
      <button data-filter="changed" class="changed ${state.compareFilter === "changed" ? "active" : ""}"><b>${counts.changed}</b><span>Настройки отличаются</span></button>
      <button data-filter="left-only" class="removed ${state.compareFilter === "left-only" ? "active" : ""}"><b>${counts["left-only"]}</b><span>Есть только слева</span></button>
      <button data-filter="right-only" class="added ${state.compareFilter === "right-only" ? "active" : ""}"><b>${counts["right-only"]}</b><span>Есть только справа</span></button>
      <button data-filter="same" class="${state.compareFilter === "same" ? "active" : ""}"><b>${counts.same}</b><span>Полностью совпадают</span></button>
    </div>
    ${selected ? renderSemanticDetail(selected, left, right) : `<div class="semantic-groups">${Object.entries(groups).map(([category, items]) => `<section class="semantic-group"><div class="semantic-group-head"><h2>${escapeHtml(category)}</h2><span>${items.length}</span></div><div class="semantic-list">${items.map(item => renderSemanticRow(item, left, right)).join("")}</div></section>`).join("") || `<div class="empty-results">В этой группе нет объектов.</div>`}</div>`}`;
}

function presence(item, side) {
  const object = item[side];
  if (!object) return `<span class="presence no">Нет</span>`;
  const stateValue = object.fields["Состояние"];
  return `<span class="presence yes">Есть</span>${stateValue ? `<small>${escapeHtml(stateValue)}</small>` : ""}`;
}

function renderSemanticRow(item, left, right) {
  const labels = { same: "Совпадает", changed: "Есть отличия", "left-only": `Только ${left.meta.device}`, "right-only": `Только ${right.meta.device}` };
  const changes = item.fields.filter(field => field.changed).length;
  return `<button class="semantic-row" data-compare-key="${escapeHtml(item.key)}"><span class="semantic-icon">${item.icon}</span><span class="semantic-name"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span><span class="semantic-side">${presence(item, "left")}</span><span class="semantic-arrow">→</span><span class="semantic-side">${presence(item, "right")}</span><span class="semantic-result ${item.status}">${escapeHtml(labels[item.status])}${changes && item.status === "changed" ? `<small>${changes} ${plural(changes, "поле", "поля", "полей")}</small>` : ""}</span><span>›</span></button>`;
}

function renderSemanticDetail(item, left, right) {
  return `<div class="semantic-detail"><div class="detail-toolbar"><button class="back-button" id="backToCompare">← Все объекты</button><span class="semantic-icon">${item.icon}</span><div><span>${escapeHtml(item.category)}</span><h2>${escapeHtml(item.title)}</h2></div></div>
    <div class="semantic-device-head"><span>Параметр</span><b>${escapeHtml(left.meta.device)}<small>${escapeHtml(left.meta.model)}</small></b><b>${escapeHtml(right.meta.device)}<small>${escapeHtml(right.meta.model)}</small></b></div>
    <div class="field-comparison">${item.fields.map(field => `<div class="field-row ${field.changed ? "changed" : ""}"><span>${escapeHtml(field.name)}</span><code class="${!item.left ? "missing" : ""}">${escapeHtml(field.left)}</code><code class="${!item.right ? "missing" : ""}">${escapeHtml(field.right)}</code></div>`).join("")}</div>
    <details class="raw-details"><summary>Показать исходную конфигурацию</summary><div><pre tabindex="0" role="region" aria-label="Исходная конфигурация слева">${escapeHtml(item.left?.raw || "Объект отсутствует")}</pre><pre tabindex="0" role="region" aria-label="Исходная конфигурация справа">${escapeHtml(item.right?.raw || "Объект отсутствует")}</pre></div></details>
  </div>`;
}

function renderSelect(id, selected, label) {
  return `<select id="${id}" aria-label="${label}">${state.files.map(f => `<option value="${escapeHtml(f.id)}" ${f.id === selected ? "selected" : ""}>${escapeHtml(f.meta.device)} · ${escapeHtml(f.meta.version)} · ${escapeHtml(formatTimestamp(f.meta.timestamp))}</option>`).join("")}</select>`;
}

function renderCompareRow(item) {
  const labels = { same: "Совпадает", changed: "Изменена", "left-only": "Только слева", "right-only": "Только справа" };
  return `<button class="compare-row" data-compare-key="${escapeHtml(item.key)}"><span><b>${escapeHtml(item.name)}</b><small>${item.virtual ? "Собранная секция" : item.key.replace("raw:", "")}</small></span><span>${CATEGORY_INFO[item.category].title}</span><span><i class="status ${item.status}"></i>${labels[item.status]}</span><span>›</span></button>`;
}

function renderDiff(item, left, right) {
  const diff = lineDiff(item.left?.content, item.right?.content);
  let leftLine = 0, rightLine = 0;
  const rows = diff.map(row => {
    if (row.type !== "added") leftLine++; if (row.type !== "removed") rightLine++;
    return `<div class="diff-line ${row.type}"><span>${row.type === "added" ? "" : leftLine}</span><span>${row.type === "removed" ? "" : rightLine}</span><b>${row.type === "added" ? "+" : row.type === "removed" ? "−" : " "}</b><code>${escapeHtml(row.text) || " "}</code></div>`;
  }).join("");
  return `<div class="diff-detail"><div class="detail-toolbar"><button class="back-button" id="backToCompare">← Все секции</button><div><span>${CATEGORY_INFO[item.category].title}</span><h2>${escapeHtml(item.name)}</h2></div><div class="diff-legend"><span class="removed">− ${escapeHtml(left.meta.device)}</span><span class="added">+ ${escapeHtml(right.meta.device)}</span></div></div><div class="diff-view" tabindex="0" role="region" aria-label="Построчное сравнение секции ${escapeHtml(item.name)}">${rows}</div></div>`;
}

function showAllCategory(key) {
  const file = state.files.find(f => f.id === state.activeId); const groups = groupSections(file, state.query);
  const group = groups.find(([k]) => k === key); if (!group) return;
  const card = [...document.querySelectorAll(".category-card")].find(el => el.querySelector(`[data-category="${key}"]`));
  if (!card) return;
  card.querySelector(".section-list").innerHTML = group[1].map(renderSectionButton).join("");
  card.querySelector(".show-more")?.remove();
}

document.addEventListener("click", event => {
  const brand = event.target.closest("a.brand"); if (brand) { event.preventDefault(); state.tab = "explore"; state.activeCategory = "all"; state.activeSection = null; state.query = ""; $("#exploreView").classList.remove("hidden"); $("#compareView").classList.add("hidden"); render(); focusHeading(state.files.length ? "#exploreView h1" : "#emptyState h1"); return; }
  const upload = event.target.closest("#headerUpload,#sideUpload,#compareUpload"); if (upload) $("#fileInput").click();
  const tab = event.target.closest("[data-tab]"); if (tab) { state.tab = tab.dataset.tab; state.compareSection = null; document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab)); $("#exploreView").classList.toggle("hidden", state.tab !== "explore"); $("#compareView").classList.toggle("hidden", state.tab !== "compare"); render(); }
  const remove = event.target.closest("[data-remove-id]"); if (remove) {
    event.stopPropagation();
    const index = state.files.findIndex(file => file.id === remove.dataset.removeId);
    const removed = state.files[index];
    if (!removed) return;
    const previous = { activeId: state.activeId, compareLeft: state.compareLeft, compareRight: state.compareRight };
    state.files.splice(index, 1); state.activeId = state.files[0]?.id; state.compareLeft = state.files[0]?.id; state.compareRight = state.files[1]?.id || state.files[0]?.id; render();
    toast(`Диагностика ${removed.filename} удалена.`, false, { label: "Отменить", callback: () => { state.files.splice(index, 0, removed); state.activeId = previous.activeId; state.compareLeft = previous.compareLeft; state.compareRight = previous.compareRight; render(); toast("Диагностика восстановлена"); } });
    return;
  }
  const fileCard = event.target.closest("[data-file-id]"); if (fileCard) { state.activeId = fileCard.dataset.fileId; state.activeSection = null; state.tab = "explore"; document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "explore")); $("#exploreView").classList.remove("hidden"); $("#compareView").classList.add("hidden"); render(); }
  const navCategory = event.target.closest("[data-nav-category]"); if (navCategory) { state.activeCategory = navCategory.dataset.navCategory; state.activeSection = null; state.query = ""; state.tab = "explore"; $("#exploreView").classList.remove("hidden"); $("#compareView").classList.add("hidden"); render(); focusHeading("#exploreView h1"); }
  if (event.target.closest("[data-nav-compare]")) { state.tab = "compare"; state.compareSection = null; $("#exploreView").classList.add("hidden"); $("#compareView").classList.remove("hidden"); render(); focusHeading("#compareView h1"); }
  const section = event.target.closest("[data-section-key]"); if (section) { state.activeSection = section.dataset.sectionKey; renderExplore(); updateDocumentTitle(); focusHeading("#exploreView .section-detail h2"); }
  if (event.target.closest("#clearSearch,#emptySearchClear")) { clearTimeout(state.searchTimer); state.query = ""; state.activeSection = null; renderExplore(); $("#searchInput")?.focus(); }
  const searchSection = event.target.closest("[data-search-section]"); if (searchSection) { const file = state.files.find(f => f.id === state.activeId); const found = file.sections.find(s => s.key === searchSection.dataset.searchSection); if (found) { state.activeCategory = found.category; state.activeSection = found.key; render(); } }
  const more = event.target.closest("[data-category]"); if (more) showAllCategory(more.dataset.category);
  if (event.target.closest("#backToCategories")) { const previous = state.activeSection; state.activeSection = null; renderExplore(); requestAnimationFrame(() => document.querySelector(`[data-section-key="${CSS.escape(previous)}"]`)?.focus()); }
  if (event.target.closest("#copySection")) { const file = state.files.find(f => f.id === state.activeId); const sectionData = file.sections.find(s => s.key === state.activeSection); navigator.clipboard.writeText(sectionData.content).then(() => toast("Секция скопирована")).catch(() => toast("Не удалось скопировать секцию", true)); }
  const filter = event.target.closest("[data-filter]"); if (filter) { state.compareFilter = filter.dataset.filter; state.compareSection = null; renderCompare(); focusHeading("#compareView h1"); }
  const mode = event.target.closest("[data-compare-mode]"); if (mode) { state.compareMode = mode.dataset.compareMode; state.compareFilter = "all"; state.compareSection = null; renderCompare(); focusHeading("#compareView h1"); }
  const compare = event.target.closest("[data-compare-key]"); if (compare) { state.compareSection = compare.dataset.compareKey; renderCompare(); focusHeading("#compareView .detail-toolbar h2"); }
  if (event.target.closest("#backToCompare")) { state.compareSection = null; renderCompare(); focusHeading("#compareView h1"); }
});

$("#themeSelect").addEventListener("change", event => applyTheme(event.target.value));

document.addEventListener("input", event => {
  if (event.target.id === "searchInput") {
    const value = event.target.value, selectionStart = event.target.selectionStart, selectionEnd = event.target.selectionEnd;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => { state.query = value; state.activeSection = null; renderExplore(); const input = $("#searchInput"); input?.focus(); input?.setSelectionRange(selectionStart, selectionEnd); }, 160);
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "fileInput") { const files = Array.from(event.target.files); event.target.value = ""; loadFiles(files); }
  if (event.target.id === "globalFileSelect") { state.activeId = event.target.value; state.activeSection = null; render(); }
  if (event.target.id === "leftSelect") { state.compareLeft = event.target.value; state.compareSection = null; renderCompare(); }
  if (event.target.id === "rightSelect") { state.compareRight = event.target.value; state.compareSection = null; renderCompare(); }
});

document.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#searchInput")?.focus(); } });
document.body.addEventListener("dragover", event => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
document.body.addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
document.body.addEventListener("drop", event => { event.preventDefault(); $("#dropzone").classList.remove("dragging"); if (event.dataTransfer.files.length) loadFiles(Array.from(event.dataTransfer.files)); });
