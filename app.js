import { CATEGORY_INFO, compareSections, compareSemantic, groupSections, lineDiff, parseDiagnostic, searchDiagnostic } from "./parser.js";

const state = { files: [], activeId: null, activeSection: null, activeCategory: "all", query: "", tab: "explore", compareLeft: null, compareRight: null, compareFilter: "all", compareSection: null, compareMode: "semantic" };
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
const formatBytes = bytes => bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
const plural = (count, one, few, many) => count % 10 === 1 && count % 100 !== 11 ? one : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? few : many;

const NAV_GROUPS = [
  { title: "Статус", icon: "▦", categories: ["system", "hardware", "processes", "memory"] },
  { title: "Интернет", icon: "◎", categories: ["internet", "vpn"] },
  { title: "Мои сети и Wi‑Fi", icon: "⌁", categories: ["interfaces", "wifi", "mws", "dhcp"] },
  { title: "Сетевые правила", icon: "⬡", categories: ["routing", "security"] },
  { title: "Управление", icon: "⚙", categories: ["configuration", "services", "logs", "other"] },
];

const themeMedia = matchMedia("(prefers-color-scheme: dark)");
let themeMode = localStorage.getItem("diagdigger-theme") || "auto";
function applyTheme(mode) {
  themeMode = mode;
  localStorage.setItem("diagdigger-theme", mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === "auto" ? (themeMedia.matches ? "dark" : "light") : mode;
  document.querySelectorAll("[data-theme-choice]").forEach(button => {
    const active = button.dataset.themeChoice === mode;
    button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active));
  });
}
themeMedia.addEventListener("change", () => { if (themeMode === "auto") applyTheme("auto"); });
applyTheme(themeMode);

function toast(message, error = false) {
  const el = $("#toast"); el.textContent = message; el.classList.toggle("error", error); el.classList.remove("hidden");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add("hidden"), 3200);
}

async function loadFiles(fileList) {
  for (const file of Array.from(fileList)) {
    try {
      const text = await file.text();
      const diagnostic = parseDiagnostic(file.name, text);
      if (state.files.some(item => item.filename === diagnostic.filename && item.size === diagnostic.size && item.text === diagnostic.text)) continue;
      state.files.push(diagnostic); state.activeId ||= diagnostic.id;
    } catch (error) { toast(`${file.name}: ${error.message}`, true); }
  }
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
  if (state.tab === "explore") renderExplore(); else renderCompare();
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
      return overview || items ? `<section class="nav-group"><div class="nav-group-title"><span class="nav-group-icon">${group.icon}</span><span>${group.title}</span></div>${overview}${items}</section>` : "";
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
      <div><div class="eyebrow">${escapeHtml(file.meta.model)} · ${escapeHtml(file.meta.device)}</div><h2>${categoryInfo ? escapeHtml(categoryInfo.title) : "Обзор диагностики"}</h2><p>${escapeHtml(file.filename)}</p></div>
      <div class="meta-grid">
        <div><span>Устройство · HW ID</span><b>${escapeHtml(file.meta.device)} · ${escapeHtml(file.meta.hwId)}</b></div>
        <div><span>Прошивка · релиз</span><b>${escapeHtml(file.meta.firmware)} · ${escapeHtml(file.meta.release)}</b></div><div><span>Размер</span><b>${formatBytes(file.size)}</b></div>
        <div><span>Регион</span><b>${escapeHtml(file.meta.region)}</b></div>
        <div><span>Sandbox</span><b>${escapeHtml(file.meta.sandbox)}</b></div>
        <div><span>NDM exact</span><b>${escapeHtml(file.meta.ndmExact)}</b><small>${escapeHtml(file.meta.ndmCdate)}</small></div><div><span>BSP exact</span><b>${escapeHtml(file.meta.bspExact)}</b><small>${escapeHtml(file.meta.bspCdate)}</small></div>
        ${file.meta.temperatures.length ? `<div class="temperature-meta"><span>Температуры</span>${file.meta.temperatures.map(sensor => `<b>${escapeHtml(sensor.id)} · ${escapeHtml(sensor.value)} °C</b>`).join("")}</div>` : ""}
      </div>
    </div>
    <div class="search-wrap"><span>⌕</span><input id="searchInput" value="${escapeHtml(state.query)}" placeholder="Поиск по секциям и содержимому…" aria-label="Поиск по секциям и содержимому" />${state.query ? `<button class="search-clear" id="clearSearch" aria-label="Очистить поиск" title="Очистить поиск">×</button>` : ""}</div>
    ${selected ? renderSectionDetail(selected) : state.query.trim() ? renderSearchResults(file, state.query) : `
      <div class="category-grid ${state.activeCategory !== "all" ? "single" : ""}">
        ${groups.map(([key, sections]) => renderCategory(key, sections, state.query, state.activeCategory !== "all")).join("") || `<div class="empty-results">Ничего не найдено. Попробуйте изменить запрос.</div>`}
      </div>`}`;
}

function renderSearchResults(file, query) {
  const hits = searchDiagnostic(file, query);
  const grouped = hits.reduce((map, hit) => { if (!map.has(hit.section)) map.set(hit.section, []); map.get(hit.section).push(hit); return map; }, new Map());
  const sectionLink = name => file.sections.find(section => section.key === `raw:${name}` || section.name === name);
  return `<section class="search-results">
    <div class="search-results-head"><div><span>Результаты поиска</span><h3>${hits.length} ${plural(hits.length, "упоминание", "упоминания", "упоминаний")} в ${grouped.size} ${plural(grouped.size, "разделе", "разделах", "разделах")}</h3></div><code>${escapeHtml(query)}</code></div>
    ${hits.length ? [...grouped].map(([name, items]) => {
      const linked = sectionLink(name);
      return `<article class="search-result-group"><div class="search-result-group-head"><div><span>${items[0].sectionType === "file" ? "Секция диагностики" : items[0].sectionType === "interface" ? "XML-интерфейс" : items[0].sectionType === "derived" ? "Производные данные" : "XML диагностики"}</span><h3>${escapeHtml(name)}</h3></div><b>${items.length}</b>${linked ? `<button data-search-section="${escapeHtml(linked.key)}">Открыть секцию</button>` : ""}</div><div class="search-hit-list">${items.map(hit => renderSearchHit(hit, query)).join("")}</div></article>`;
    }).join("") : `<div class="empty-results">Совпадений во всём файле диагностики нет.</div>`}
  </section>`;
}

function renderSearchHit(hit, query) {
  const location = [hit.line ? `строка файла ${hit.line}` : null, hit.sectionLine ? `строка раздела ${hit.sectionLine}` : null, `столбец ${hit.column}`].filter(Boolean).join(" · ");
  return `<div class="search-hit"><div class="search-hit-location">${location}</div><pre>${hit.before ? `<span>${escapeHtml(hit.before)}</span>\n` : ""}<mark>${highlight(hit.text, query)}</mark>${hit.after ? `\n<span>${escapeHtml(hit.after)}</span>` : ""}</pre></div>`;
}

function renderCategory(key, sections, query, expanded = false) {
  const info = CATEGORY_INFO[key];
  const limit = expanded ? sections.length : query ? 30 : 7;
  return `<article class="category-card">
    <div class="category-head"><span class="category-icon">${info.icon}</span><div><h3>${info.title}</h3><small>${sections.length} ${plural(sections.length, "секция", "секции", "секций")}</small></div></div>
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
  return `<div class="section-detail">
    <div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>${CATEGORY_INFO[section.category].title}</span><h3>${escapeHtml(section.name)}</h3></div><button class="copy-button" id="copySection">Копировать</button></div>
    <pre class="code-view"><code>${highlight(section.content, state.query)}</code></pre>
  </div>`;
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
  return `<div class="section-detail wifi-associations"><div class="detail-toolbar"><button class="back-button" id="backToCategories">← Все категории</button><div><span>Wi‑Fi</span><h3>Подключённые устройства</h3></div><button class="copy-button" id="copySection">Копировать</button></div>
    <p class="association-summary">${stations.length} ${plural(stations.length, "устройство", "устройства", "устройств")} подключено к точкам доступа.</p>
    <div class="association-grid">${stations.map(station => {
      const authenticated = xmlField(station, "authenticated") === "yes";
      return `<article class="association-card"><div><code>${escapeHtml(xmlField(station, "mac"))}</code><span class="association-status ${authenticated ? "online" : "offline"}">${authenticated ? "Подключено" : "Не авторизовано"}</span></div><small>${escapeHtml(xmlField(station, "ap"))}</small><strong>${escapeHtml(xmlField(station, "rssi"))} dBm</strong><dl><div><dt>Скорость</dt><dd>↓ ${escapeHtml(xmlField(station, "rxrate"))} / ↑ ${escapeHtml(xmlField(station, "txrate"))} Мбит/с</dd></div><div><dt>Стандарт</dt><dd>${escapeHtml(xmlField(station, "mode"))} · ${escapeHtml(xmlField(station, "ht"))} МГц · MCS ${escapeHtml(xmlField(station, "mcs"))}</dd></div><div><dt>Трафик</dt><dd>↓ ${formatTraffic(xmlField(station, "rxbytes"))} / ↑ ${formatTraffic(xmlField(station, "txbytes"))}</dd></div><div><dt>В сети</dt><dd>${formatUptime(xmlField(station, "uptime"))}</dd></div><div><dt>Защита</dt><dd>${escapeHtml(xmlField(station, "security"))}</dd></div></dl></article>`;
    }).join("") || `<div class="empty-results">Подключённых Wi‑Fi-устройств нет.</div>`}</div></div>`;
}

function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query.trim()) return safe;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

function renderCompare() {
  if (state.files.length < 2) {
    $("#compareView").innerHTML = `<div class="compare-empty"><div>⇄</div><h2>Добавьте второй файл</h2><p>Для сравнения нужны две диагностики.</p><button class="button button-primary" id="compareUpload">Добавить файл</button></div>`;
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
  return `<div class="compare-head"><div><div class="eyebrow">Сравнение диагностик</div><h2>Что изменилось?</h2><div class="mode-switch"><button data-compare-mode="semantic" class="${state.compareMode === "semantic" ? "active" : ""}">Понятное сравнение</button><button data-compare-mode="raw" class="${state.compareMode === "raw" ? "active" : ""}">Сырые секции</button></div></div><div class="compare-selects">${renderSelect("leftSelect", left.id)}<span>⇄</span>${renderSelect("rightSelect", right.id)}</div></div>`;
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
    ${selected ? renderSemanticDetail(selected, left, right) : `<div class="semantic-groups">${Object.entries(groups).map(([category, items]) => `<section class="semantic-group"><div class="semantic-group-head"><h3>${escapeHtml(category)}</h3><span>${items.length}</span></div><div class="semantic-list">${items.map(item => renderSemanticRow(item, left, right)).join("")}</div></section>`).join("") || `<div class="empty-results">В этой группе нет объектов.</div>`}</div>`}`;
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
  return `<button class="semantic-row" data-compare-key="${escapeHtml(item.key)}"><span class="semantic-icon">${item.icon}</span><span class="semantic-name"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle)}</small></span><span class="semantic-side">${presence(item, "left")}</span><span class="semantic-arrow">→</span><span class="semantic-side">${presence(item, "right")}</span><span class="semantic-result ${item.status}">${escapeHtml(labels[item.status])}${changes && item.status === "changed" ? `<small>${changes} полей</small>` : ""}</span><span>›</span></button>`;
}

function renderSemanticDetail(item, left, right) {
  return `<div class="semantic-detail"><div class="detail-toolbar"><button class="back-button" id="backToCompare">← Все объекты</button><span class="semantic-icon">${item.icon}</span><div><span>${escapeHtml(item.category)}</span><h3>${escapeHtml(item.title)}</h3></div></div>
    <div class="semantic-device-head"><span>Параметр</span><b>${escapeHtml(left.meta.device)}<small>${escapeHtml(left.meta.model)}</small></b><b>${escapeHtml(right.meta.device)}<small>${escapeHtml(right.meta.model)}</small></b></div>
    <div class="field-comparison">${item.fields.map(field => `<div class="field-row ${field.changed ? "changed" : ""}"><span>${escapeHtml(field.name)}</span><code class="${!item.left ? "missing" : ""}">${escapeHtml(field.left)}</code><code class="${!item.right ? "missing" : ""}">${escapeHtml(field.right)}</code></div>`).join("")}</div>
    <details class="raw-details"><summary>Показать исходную конфигурацию</summary><div><pre>${escapeHtml(item.left?.raw || "Объект отсутствует")}</pre><pre>${escapeHtml(item.right?.raw || "Объект отсутствует")}</pre></div></details>
  </div>`;
}

function renderSelect(id, selected) {
  return `<select id="${id}">${state.files.map(f => `<option value="${escapeHtml(f.id)}" ${f.id === selected ? "selected" : ""}>${escapeHtml(f.meta.device)} · ${escapeHtml(f.meta.version)} · ${escapeHtml(f.meta.timestamp)}</option>`).join("")}</select>`;
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
  return `<div class="diff-detail"><div class="detail-toolbar"><button class="back-button" id="backToCompare">← Все секции</button><div><span>${CATEGORY_INFO[item.category].title}</span><h3>${escapeHtml(item.name)}</h3></div><div class="diff-legend"><span class="removed">− ${escapeHtml(left.meta.device)}</span><span class="added">+ ${escapeHtml(right.meta.device)}</span></div></div><div class="diff-view">${rows}</div></div>`;
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
  const themeChoice = event.target.closest("[data-theme-choice]"); if (themeChoice) applyTheme(themeChoice.dataset.themeChoice);
  const upload = event.target.closest("#headerUpload,#sideUpload,#compareUpload"); if (upload) $("#fileInput").click();
  const tab = event.target.closest("[data-tab]"); if (tab) { state.tab = tab.dataset.tab; state.compareSection = null; document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab)); $("#exploreView").classList.toggle("hidden", state.tab !== "explore"); $("#compareView").classList.toggle("hidden", state.tab !== "compare"); render(); }
  const remove = event.target.closest("[data-remove-id]"); if (remove) { event.stopPropagation(); state.files = state.files.filter(f => f.id !== remove.dataset.removeId); state.activeId = state.files[0]?.id; state.compareLeft = state.files[0]?.id; state.compareRight = state.files[1]?.id || state.files[0]?.id; render(); return; }
  const fileCard = event.target.closest("[data-file-id]"); if (fileCard) { state.activeId = fileCard.dataset.fileId; state.activeSection = null; state.tab = "explore"; document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "explore")); $("#exploreView").classList.remove("hidden"); $("#compareView").classList.add("hidden"); render(); }
  const navCategory = event.target.closest("[data-nav-category]"); if (navCategory) { state.activeCategory = navCategory.dataset.navCategory; state.activeSection = null; state.tab = "explore"; $("#exploreView").classList.remove("hidden"); $("#compareView").classList.add("hidden"); render(); }
  if (event.target.closest("[data-nav-compare]")) { state.tab = "compare"; state.compareSection = null; $("#exploreView").classList.add("hidden"); $("#compareView").classList.remove("hidden"); render(); }
  const section = event.target.closest("[data-section-key]"); if (section) { state.activeSection = section.dataset.sectionKey; renderExplore(); }
  if (event.target.closest("#clearSearch")) { clearTimeout(state.searchTimer); state.query = ""; state.activeSection = null; renderExplore(); $("#searchInput")?.focus(); }
  const searchSection = event.target.closest("[data-search-section]"); if (searchSection) { const file = state.files.find(f => f.id === state.activeId); const found = file.sections.find(s => s.key === searchSection.dataset.searchSection); if (found) { state.activeCategory = found.category; state.activeSection = found.key; render(); } }
  const more = event.target.closest("[data-category]"); if (more) showAllCategory(more.dataset.category);
  if (event.target.closest("#backToCategories")) { state.activeSection = null; renderExplore(); }
  if (event.target.closest("#copySection")) { const file = state.files.find(f => f.id === state.activeId); const sectionData = file.sections.find(s => s.key === state.activeSection); navigator.clipboard.writeText(sectionData.content).then(() => toast("Секция скопирована")).catch(() => toast("Не удалось скопировать секцию", true)); }
  const filter = event.target.closest("[data-filter]"); if (filter) { state.compareFilter = filter.dataset.filter; state.compareSection = null; renderCompare(); }
  const mode = event.target.closest("[data-compare-mode]"); if (mode) { state.compareMode = mode.dataset.compareMode; state.compareFilter = "all"; state.compareSection = null; renderCompare(); }
  const compare = event.target.closest("[data-compare-key]"); if (compare) { state.compareSection = compare.dataset.compareKey; renderCompare(); }
  if (event.target.closest("#backToCompare")) { state.compareSection = null; renderCompare(); }
});

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
