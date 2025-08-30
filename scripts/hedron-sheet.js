// Compat: TextEditor em v13+
const TextEditorImpl2 =
  (foundry?.applications?.ux?.TextEditor?.implementation) ?? TextEditor;

class HedronSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["pf2e", "item", "sheet", "hedron-interface"],
      template: "modules/hedron-interface/templates/hedron-sheet.hbs",
      width: 420,
      height: 420
    });
  }

  async getData() {
    const data = await super.getData();
    const slots = this.item.getFlag("hedron-interface", "slots") ?? { core: null, fragments: [null, null] };
    data.slots = {
      core: slots.core ? await fromUuid(slots.core) : null,
      fragments: await Promise.all((slots.fragments ?? [null, null]).map(f => f ? fromUuid(f) : null))
    };
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Drop de Ember (Core/Fragment)
    html.find(".slot").on("drop", async ev => {
      ev.preventDefault();
      const d = TextEditorImpl2.getDragEventData(ev);
      const uuid = d?.uuid ?? (d?.pack && d?.id ? `Compendium.${d.pack}.${d.id}` : null);
      if (!uuid) return ui.notifications.warn("Arraste um documento válido.");

      const doc = await fromUuid(uuid);
      if (!doc) return;

      const emberType = doc.getFlag("hedron-interface", "type"); // "core" | "fragment"
      const slotKey = ev.currentTarget.dataset.slot;

      if (slotKey === "core" && emberType !== "core")
        return ui.notifications.error("Esse slot aceita apenas Core Ember Stone.");
      if (slotKey.startsWith("fragment") && emberType !== "fragment")
        return ui.notifications.error("Esse slot aceita apenas Ember Fragment.");

      const slots = foundry.utils.deepClone(this.item.getFlag("hedron-interface", "slots") ?? { core:null, fragments:[null,null] });
      if (slotKey === "core") slots.core = uuid;
      else {
        const i = Number(slotKey.split("-")[1] ?? 0);
        slots.fragments[i] = uuid;
      }
      await this.item.setFlag("hedron-interface", "slots", slots);
      this.render(false);
    });

    // Remover item do slot
    html.find(".remove").on("click", async ev => {
      const uuid = ev.currentTarget.closest(".stone")?.dataset?.uuid;
      const slots = foundry.utils.deepClone(this.item.getFlag("hedron-interface", "slots") ?? { core:null, fragments:[null,null] });
      if (slots.core === uuid) slots.core = null;
      slots.fragments = (slots.fragments ?? [null, null]).map(f => f === uuid ? null : f);
      await this.item.setFlag("hedron-interface", "slots", slots);
      this.render(false);
    });
  }
}

// Registrar “selector” de sheet para PF2e (equipment)
Hooks.once("init", () => {
  const OriginalEquipmentSheet = game.system.applications?.item?.ItemSheetPF2e ?? ItemSheet;
  class HedronSheetSelector extends OriginalEquipmentSheet {
    get template() {
      const isHedron =
        this.item.slug === "hedron-interface" ||
        this.item.getFlag("hedron-interface", "isHedronInterface") === true;
      return isHedron
        ? "modules/hedron-interface/templates/hedron-sheet.hbs"
        : super.template;
    }
    async getData(options) {
      const isHedron =
        this.item.slug === "hedron-interface" ||
        this.item.getFlag("hedron-interface", "isHedronInterface") === true;
      if (!isHedron) return await super.getData(options);
      const tmp = new HedronSheet(this.item, {});
      tmp.options = this.options;
      return await tmp.getData();
    }
    activateListeners(html) {
      super.activateListeners(html);
      const isHedron =
        this.item.slug === "hedron-interface" ||
        this.item.getFlag("hedron-interface", "isHedronInterface") === true;
      if (!isHedron) return;
      const tmp = new HedronSheet(this.item, {});
      tmp.activateListeners(html);
    }
  }

  // Define como default de equipment (PF2e)
  if (game.system.id === "pf2e") {
    Items.unregisterSheet("pf2e", game.system.applications.item.ItemSheetPF2e);
    Items.registerSheet("pf2e", HedronSheetSelector, { types: ["equipment"], makeDefault: true });
  } else {
    // fallback se não for PF2e
    Items.registerSheet("core", HedronSheet, { types: ["equipment"], makeDefault: false });
  }
});
