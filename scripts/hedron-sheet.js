// Hedron UI — substitui o corpo da ItemSheet padrão quando o item é Hedron
const MODID = "hedron-interface";

// Compat v11–v13
const TextEditorImpl =
  (foundry?.applications?.ux?.TextEditor?.implementation) ?? window.TextEditor;
const renderTemplateImpl =
  (foundry?.applications?.handlebars?.renderTemplate) ?? renderTemplate;

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

async function renderHedronOnly(item, $html) {
  // Resolve dados
  const slots = getSlots(item);
  const context = {
    slots: {
      core: slots.core ? await fromUuid(slots.core) : null,
      fragments: await Promise.all((slots.fragments ?? [null, null]).map(f => f ? fromUuid(f) : null))
    }
  };

  // Seletores comuns de layout do PF2e
  const $nav = $html.find(".sheet-navigation, nav.sheet-tabs, .sheet-tabs");
  const $body = $html.find(".sheet-body, .sheet-content, section.sheet-body, form .sheet-body").first();

  // Some com a navegação/abas
  $nav.remove();

  // Zera o corpo e injeta só nossa UI
  const html = await renderTemplateImpl(`modules/${MODID}/templates/hedron-sheet.hbs`, context);
  $body.empty().append(html);

  // Liga listeners (drop/remove) via delegação
  $body.off(".hedron");

  $body.on("drop.hedron", ".slot", async (ev) => {
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
    if (slotKey?.startsWith("fragment") && emberType !== "fragment")
      return ui.notifications.error("Esse slot aceita apenas Ember Fragment.");

    const newSlots = foundry.utils.deepClone(getSlots(item));
    if (slotKey === "core") newSlots.core = uuid;
    else {
      const i = Number(slotKey.split("-")[1] ?? 0);
      newSlots.fragments[i] = uuid;
    }
    await setSlots(item, newSlots);
    // re-render
    await renderHedronOnly(item, $html);
  });

  $body.on("click.hedron", ".remove", async (ev) => {
    const uuid = ev.currentTarget.closest(".stone")?.dataset?.uuid;
    const newSlots = foundry.utils.deepClone(getSlots(item));
    if (newSlots.core === uuid) newSlots.core = null;
    newSlots.fragments = (newSlots.fragments ?? [null, null]).map(f => f === uuid ? null : f);
    await setSlots(item, newSlots);
    await renderHedronOnly(item, $html);
  });

    // Abrir a ficha da Ember (clique)
  $body.on("click.hedron", ".open-doc", async (ev) => {
    ev.preventDefault();
    const uuid = ev.currentTarget.dataset.uuid;
    try {
      const doc = await fromUuid(uuid);
      if (!doc) return ui.notifications.warn("Documento não encontrado.");
      doc.sheet?.render(true);
    } catch (e) {
      console.error(e);
      ui.notifications.error("Falha ao abrir o documento.");
    }
  });

  // Clique direito: copiar @UUID[...]
  $body.on("contextmenu.hedron", ".open-doc", async (ev) => {
    ev.preventDefault();
    const uuid = ev.currentTarget.dataset.uuid;
    const label = ev.currentTarget.textContent?.trim() || "link";
    const text = `@UUID[${uuid}]{${label}}`;
    try {
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Copiado: " + text);
    } catch {
      ui.notifications.warn("Não foi possível copiar para a área de transferência.");
    }
  });

}

// Intercepta o render de QUALQUER item; se for Hedron, mostra só a UI do Hedron
Hooks.on("renderItemSheet", async (app, htmlEl) => {
  try {
    const item = app.object ?? app.item;
    if (!isHedron(item)) return;
    const $html = htmlEl instanceof HTMLElement ? $(htmlEl) : htmlEl;
    await renderHedronOnly(item, $html);
  } catch (e) {
    console.error(`[${MODID}] Hedron render error`, e);
  }
});
