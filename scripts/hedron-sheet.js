// Hedron UI — injeta a aba "Hedron" em qualquer ItemSheet (sem trocar a sheet do PF2e)
const MODID = "hedron-interface";

// Compat v11–v13+: TextEditor e renderTemplate namespaced
const TextEditorImpl =
  (foundry?.applications?.ux?.TextEditor?.implementation) ?? window.TextEditor;
const renderTemplateImpl =
  (foundry?.applications?.handlebars?.renderTemplate) ?? renderTemplate;

/** utils */
function isHedron(item) {
  if (!item) return false;
  const bySlug = (item.system?.slug ?? item.slug) === "hedron-interface";
  const byFlag = item.getFlag(MODID, "isHedronInterface") === true;
  return item.type === "equipment" && (bySlug || byFlag);
}
function getSlots(item) {
  return item.getFlag(MODID, "slots") ?? { core: null, fragments: [null, null] };
}
async function setSlots(item, slots) {
  return item.setFlag(MODID, "slots", slots);
}
async function renderHedronTab(item) {
  const slots = getSlots(item);
  const ctx = {
    slots: {
      core: slots.core ? await fromUuid(slots.core) : null,
      fragments: await Promise.all((slots.fragments ?? [null, null]).map(f => f ? fromUuid(f) : null))
    }
  };
  return await renderTemplateImpl(`modules/${MODID}/templates/hedron-sheet.hbs`, ctx);
}

function bindTabSystemTabs(app, $html) {
  const tabs = app._tabs ?? [];
  for (const t of tabs) {
    try { t.bind($html); } catch (_) {}
  }
}

/** listeners da aba */
function activateHedronTabListeners($root, item) {
  // Drop handler
  $root.find(".slot").on("drop", async (ev) => {
    ev.preventDefault();
    const data = TextEditorImpl.getDragEventData(ev.originalEvent ?? ev);
    const uuid = data?.uuid ?? (data?.pack && data?.id ? `Compendium.${data.pack}.${data.id}` : null);
    if (!uuid) return ui.notifications.warn("Arraste um documento válido.");

    const doc = await fromUuid(uuid);
    if (!doc) return;

    const emberType = doc.getFlag(MODID, "type"); // "core" | "fragment"
    const slotKey = ev.currentTarget.dataset.slot;

    if (slotKey === "core" && emberType !== "core")
      return ui.notifications.error("Esse slot aceita apenas Core Ember Stone.");
    if (slotKey.startsWith("fragment") && emberType !== "fragment")
      return ui.notifications.error("Esse slot aceita apenas Ember Fragment.");

    const slots = foundry.utils.deepClone(getSlots(item));
    if (slotKey === "core") slots.core = uuid;
    else {
      const i = Number(slotKey.split("-")[1] ?? 0);
      slots.fragments[i] = uuid;
    }
    await setSlots(item, slots);

    const html = await renderHedronTab(item);
    $root.find('section.tab[data-tab="hedron-tab"]').html(html);
    activateHedronTabListeners($root, item);
  });

  // Remover
  $root.find(".remove").on("click", async (ev) => {
    const uuid = ev.currentTarget.closest(".stone")?.dataset?.uuid;
    const slots = foundry.utils.deepClone(getSlots(item));
    if (slots.core === uuid) slots.core = null;
    slots.fragments = (slots.fragments ?? [null, null]).map(f => f === uuid ? null : f);
    await setSlots(item, slots);

    const html = await renderHedronTab(item);
    $root.find('section.tab[data-tab="hedron-tab"]').html(html);
    activateHedronTabListeners($root, item);
  });
}

/** injeta a aba ao renderizar QUALQUER sheet de item */
Hooks.on("renderItemSheet", async (app, htmlEl) => {
  try {
    const item = app.object ?? app.item;
    if (!isHedron(item)) return;

    // v13+: htmlEl é HTMLElement; embrulha como jQuery
    const $html = htmlEl instanceof HTMLElement ? $(htmlEl) : htmlEl;

    // 1) Navegação de abas (várias possibilidades por versão/tema)
    const $nav = $html.find(".sheet-navigation .item-list, .sheet-tabs.buttons, nav.sheet-tabs, .tabs .item-list").first();
    if (!$nav.length) return;

    // Descobre o data-group das abas existentes
    const $anyTabBtn = $nav.find("[data-tab]").first();
    const dataGroup = $anyTabBtn.attr("data-group");

    // 2) Botão da aba (se ainda não existir)
    if (!$nav.find('[data-tab="hedron-tab"]').length) {
      const $btn = $(`<a class="item" data-tab="hedron-tab">Hedron</a>`);
      if (dataGroup) $btn.attr("data-group", dataGroup);
      $nav.append($btn);
    }

    // 3) Área das abas (conteúdo)
    const $body = $html.find(".sheet-body, .sheet-content, section.sheet-body, form .sheet-body").first();
    if (!$body.length) return;

    // 4) Container da aba (se ainda não existir)
    if (!$html.find('section.tab[data-tab="hedron-tab"]').length) {
      const groupAttr = dataGroup ? ` data-group="${dataGroup}"` : "";
      $body.append(`<section class="tab hedron-tab" data-tab="hedron-tab"${groupAttr}></section>`);
    }

    // 5) Renderiza conteúdo
    const tabHtml = await renderHedronTab(item);
    $html.find('section.tab[data-tab="hedron-tab"]').html(tabHtml);

    // 6) Liga listeners
    activateHedronTabListeners($html, item);

    // 7) Re-binda controladores de abas
    bindTabSystemTabs(app, $html);

  } catch (e) {
    console.error(`[${MODID}] Failed to inject Hedron tab`, e);
  }
});
