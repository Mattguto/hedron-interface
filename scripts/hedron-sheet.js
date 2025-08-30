// Hedron UI — injeta a aba "Hedron" em qualquer ItemSheet
const MODID = "hedron-interface";

// Compat v11–v13: TextEditor e renderTemplate namespaced
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

function bindAllTabsControllers(app, $html) {
  const tabs = app._tabs ?? [];
  for (const t of tabs) { try { t.bind($html); } catch (_) {} }
}

/** ativa a aba via controller; se não rolar, faz manual */
function activateHedronTab(app, $btn, $section, dataGroup) {
  let usedController = false;
  const ctrls = app._tabs ?? [];
  for (const t of ctrls) {
    try {
      const sameGroup = !dataGroup || t.options?.group === dataGroup || t.group === dataGroup;
      if (sameGroup && (t.tabs?.includes?.("hedron-tab") || t.callback || true)) {
        t.activate?.("hedron-tab");
        usedController = true;
      }
    } catch (_) {}
  }
  if (!usedController) {
    const $nav = $btn.closest(".sheet-navigation, nav.sheet-tabs, .sheet-tabs, .tabs");
    const $container = $section.closest(".sheet-body, .sheet-content, section.sheet-body, form .sheet-body");

    // marca botão ativo
    $nav.find('[data-tab]').removeClass("active");
    $btn.addClass("active");

    // mostra/oculta seções do mesmo grupo
    const selector = dataGroup ? `section.tab[data-group="${dataGroup}"]` : `section.tab`;
    $container.find(selector).removeClass("active").hide();
    $section.addClass("active").show();
  }
}

/** (re)liga listeners internos da aba (drop/remove) */
function wireHedronInner($root, item, $section) {
  // Evita duplicar
  $root.off("drop.hedron");
  $root.off("click.hedronRemove");

  // Drop handler
  $root.on("drop.hedron", ".slot", async (ev) => {
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
    $section.html(html);
    // re-wire dentro da aba recém-renderizada
    wireHedronInner($section, item, $section);
  });

  // Remover
  $root.on("click.hedronRemove", ".remove", async (ev) => {
    const uuid = ev.currentTarget.closest(".stone")?.dataset?.uuid;
    const slots = foundry.utils.deepClone(getSlots(item));
    if (slots.core === uuid) slots.core = null;
    slots.fragments = (slots.fragments ?? [null, null]).map(f => f === uuid ? null : f);
    await setSlots(item, slots);

    const html = await renderHedronTab(item);
    $section.html(html);
    wireHedronInner($section, item, $section);
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
    const $nav = $html.find(".sheet-navigation .item-list, .sheet-tabs .item-list, .sheet-tabs.buttons, nav.sheet-tabs, .tabs .item-list").first();
    if (!$nav.length) return;

    // 2) Descobre grupo e um botão “modelo” para clonar (mantém classes/espacamento)
    const $protoBtn = $nav.find("[data-tab]").first();
    const dataGroup = $protoBtn.attr("data-group");

    let $btn = $nav.find('[data-tab="hedron-tab"]');
    if (!$btn.length) {
      if ($protoBtn.length) {
        $btn = $protoBtn.clone();
        $btn.attr("data-tab", "hedron-tab");
        if (dataGroup) $btn.attr("data-group", dataGroup);
        $btn.removeClass("active"); // começa inativa
        // se o proto tinha ícone + texto, mantemos estrutura e só trocamos label
        if ($btn.text()?.trim()) $btn.text("Hedron");
        else $btn.append(document.createTextNode("Hedron"));
        // remove ícone se quiser simples:
        // $btn.find("i, svg").remove();
      } else {
        $btn = $(`<a class="item" data-tab="hedron-tab">Hedron</a>`);
        if (dataGroup) $btn.attr("data-group", dataGroup);
      }
      $nav.append($btn);
    }

    // 3) Container da aba
    const $body = $html.find(".sheet-body, .sheet-content, section.sheet-body, form .sheet-body").first();
    if (!$body.length) return;

    let $section = $html.find('section.tab[data-tab="hedron-tab"]');
    if (!$section.length) {
      const groupAttr = dataGroup ? ` data-group="${dataGroup}"` : "";
      $section = $(`<section class="tab hedron-tab" data-tab="hedron-tab"${groupAttr} style="display:none;"></section>`);
      $body.append($section);
    }

    // 4) Renderiza conteúdo
    const tabHtml = await renderHedronTab(item);
    $section.html(tabHtml);

    // 5) Re-binda controllers das abas (se existirem)
    bindAllTabsControllers(app, $html);

    // 6) Delegação de clique no container da NAV (não perde ao re-renderizar)
    $nav.off("click.hedron").on("click.hedron", '[data-tab="hedron-tab"]', (ev) => {
      ev.preventDefault();
      activateHedronTab(app, $btn, $section, dataGroup);
    });

    // 7) Liga os listeners internos da aba (drop/remove) com delegação
    wireHedronInner($section, item, $section);

  } catch (e) {
    console.error(`[${MODID}] Failed to inject Hedron tab`, e);
  }
});
