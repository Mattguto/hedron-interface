const MODID = "hedron-interface";

class HedronItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "hedron-interface-sheet",
      classes: ["pf2e", "sheet", "item"],
      template: `modules/${MODID}/templates/hedron-sheet.hbs`,
      width: 400,
      height: 500,
      resizable: true
    });
  }

  /** Foundry v13+: só aplica a Hedron */
  static isApplicable(item, options) {
    const bySlug = (item.system?.slug ?? item.slug) === "hedron-interface";
    const byFlag = item.getFlag(MODID, "isHedronInterface") === true;
    return item.type === "equipment" && (bySlug || byFlag);
  }

  async getData(options) {
    const ctx = await super.getData(options);
    const slots = this.item.getFlag(MODID, "slots") ?? { core: null, fragments: [null, null] };
    ctx.slots = {
      core: slots.core ? await fromUuid(slots.core) : null,
      fragments: await Promise.all(
        (slots.fragments ?? [null, null]).map(f => f ? fromUuid(f) : null)
      )
    };
    return ctx;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const item = this.item;

    html.find(".slot").on("drop", async ev => {
      ev.preventDefault();
      const data = TextEditor.getDragEventData(ev.originalEvent ?? ev);
      const uuid = data?.uuid ?? (data?.pack && data?.id ? `Compendium.${data.pack}.${data.id}` : null);
      if (!uuid) return;

      const doc = await fromUuid(uuid);
      if (!doc) return;

      const emberType = doc.getFlag(MODID, "type");
      const slotKey = ev.currentTarget.dataset.slot;

      if (slotKey === "core" && emberType !== "core")
        return ui.notifications.error("Esse slot aceita apenas Core Ember Stone.");
      if (slotKey.startsWith("fragment") && emberType !== "fragment")
        return ui.notifications.error("Esse slot aceita apenas Ember Fragment.");

      const slots = foundry.utils.deepClone(item.getFlag(MODID, "slots") ?? { core: null, fragments: [null, null] });
      if (slotKey === "core") slots.core = uuid;
      else {
        const i = Number(slotKey.split("-")[1] ?? 0);
        slots.fragments[i] = uuid;
      }
      await item.setFlag(MODID, "slots", slots);
      this.render();
    });

    html.find(".remove").on("click", async ev => {
      const uuid = ev.currentTarget.closest(".stone")?.dataset?.uuid;
      const slots = foundry.utils.deepClone(item.getFlag(MODID, "slots") ?? { core: null, fragments: [null, null] });
      if (slots.core === uuid) slots.core = null;
      slots.fragments = (slots.fragments ?? [null, null]).map(f => f === uuid ? null : f);
      await item.setFlag(MODID, "slots", slots);
      this.render();
    });
  }
}

Hooks.once("ready", () => {
  Items.registerSheet("pf2e", HedronItemSheet, {
    types: ["equipment"],
    makeDefault: false,  // só aplica se isApplicable() retornar true
    label: "Hedron Interface Sheet"
  });
});
