const TextEditorImpl = (foundry?.applications?.ux?.TextEditor?.implementation) ?? TextEditor;

class HedronSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["pf2e", "item", "sheet", "hedron-interface"],
      template: "modules/hedron-interface/templates/hedron-sheet.hbs",
      width: 400,
      height: 400
    });
  }

  async getData() {
    const data = await super.getData();
    const slots = this.item.getFlag("hedron", "slots") ?? { core: null, fragments: [null, null] };
    data.slots = {
      core: slots.core ? await fromUuid(slots.core) : null,
      fragments: await Promise.all(slots.fragments.map(f => f ? fromUuid(f) : null))
    };
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // drop handler
    html.find(".slot").on("drop", async ev => {
      ev.preventDefault();
      const data = TextEditorImpl.getDragEventData(ev);
      const uuid = data?.uuid ?? (data?.pack && data?.id ? `Compendium.${data.pack}.${data.id}` : null);
      if (!uuid) return ui.notifications.warn("Arraste um documento válido.");

      const doc = await fromUuid(uuid);
      if (!doc) return;

      const emberType = doc.getFlag("hedron", "type");
      const slot = ev.currentTarget.dataset.slot;

      if (slot === "core" && emberType !== "core")
        return ui.notifications.error("Esse slot aceita apenas Core Ember Stone.");
      if (slot.startsWith("fragment") && emberType !== "fragment")
        return ui.notifications.error("Esse slot aceita apenas Ember Fragment.");

      const slots = foundry.utils.deepClone(this.item.getFlag("hedron", "slots") ?? { core:null, fragments:[null,null] });
      if (slot === "core") slots.core = uuid;
      else {
        const i = Number(slot.split("-")[1]);
        slots.fragments[i] = uuid;
      }
      await this.item.setFlag("hedron", "slots", slots);
      this.render(false);
    });

    // remover
    html.find(".remove").on("click", async ev => {
      const uuid = ev.currentTarget.closest(".stone").dataset.uuid;
      let slots = foundry.utils.deepClone(this.item.getFlag("hedron", "slots") ?? { core:null, fragments:[null,null] });
      if (slots.core === uuid) slots.core = null;
      slots.fragments = slots.fragments.map(f => f === uuid ? null : f);
      await this.item.setFlag("hedron", "slots", slots);
      this.render(false);
    });
  }
}

// registra override da sheet
Hooks.once("init", () => {
  Items.registerSheet("pf2e", HedronSheet, { types: ["equipment"], makeDefault: false });
});
