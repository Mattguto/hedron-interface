// ---------- Compat: TextEditor em v13+ mudou de namespace ----------
const TextEditorImpl =
  (foundry?.applications?.ux?.TextEditor?.implementation) ?? // v13+
  (window.TextEditor);

// ---------- Helpers ----------
const MODID = "hedron-interface";
function openPad() {
  if (game.anchorLinksPad?.rendered) return game.anchorLinksPad.bringToTop();
  game.anchorLinksPad.render(true);
}
function activeSceneKey() {
  return game.scenes?.active?.uuid ?? null;
}

// ---------- App ----------
class AnchorPad extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: MODID,
      title: "Anchor Links",
      template: `modules/${MODID}/templates/anchor-pad.hbs`,
      width: 420,
      height: 520,
      resizable: true
    });
  }

  // ----- Persistência -----
  async _getState() {
    // Estrutura:
    // { byScene: bool, active: "itens", collections: { key: {label, links: []} }, sceneMap?: {sceneUUID: {active, collections}} }
    const base = (await game.user.getFlag(MODID, "state")) ?? null;
    if (!base) {
      const def = {
        byScene: false,
        active: "itens",
        collections: {
          "itens": { label: "Itens", links: [] },
          "handouts": { label: "Handouts", links: [] },
          "macros": { label: "Macros", links: [] }
        },
        sceneMap: {}
      };
      await game.user.setFlag(MODID, "state", def);
      return def;
    }
    // se byScene, usamos mapa por cena
    if (base.byScene) {
      const key = activeSceneKey();
      if (!key) return base; // sem cena ativa, usa base mesmo
      base.sceneMap ||= {};
      base.sceneMap[key] ||= { active: "itens", collections: foundry.utils.duplicate(base.collections) };
      return base;
    }
    return base;
  }

  async _setState(state) {
    // quando byScene = true, precisa gravar no mapa da cena, não sobrescrever root
    const root = (await game.user.getFlag(MODID, "state")) ?? {};
    if (state.sceneMap || state.collections || state.active !== undefined || state.byScene !== undefined) {
      // merge superficial
      const merged = foundry.utils.mergeObject(root, state, { inplace: false, recursive: true });
      return game.user.setFlag(MODID, "state", merged);
    }
    return game.user.setFlag(MODID, "state", state);
  }

  _pickWorking(state) {
    if (state.byScene) {
      const k = activeSceneKey();
      if (k && state.sceneMap?.[k]) return state.sceneMap[k];
    }
    return state;
  }

  async getData() {
    const state = await this._getState();
    const working = this._pickWorking(state);
    const active = working.active;
    const collections = working.collections;

    const list = (collections[active]?.links ?? []);
    return { byScene: state.byScene, active, collections, list };
  }

  _safeLabelFromUuid(uuid) {
    const parts = String(uuid).split(".");
    return parts[parts.length - 1] || String(uuid);
  }

  // util guarda/recupera referência correta (root vs por cena)
  async _mutateWorking(mutator) {
    const state = await this._getState();
    const working = this._pickWorking(state);
    await mutator(working);
    return this._setState(state);
  }

  // ----- UI -----
  activateListeners(html) {
    super.activateListeners(html);

    // trocar aba
    html.on("click", ".tab", async ev => {
      const key = ev.currentTarget.dataset.col;
      await this._mutateWorking(w => { w.active = key; });
      this.render(true);
    });

    // toggle por cena
    html.find(".by-scene").on("change", async ev => {
      const checked = ev.currentTarget.checked;
      const state = await this._getState();
      state.byScene = checked;
      await this._setState(state);
      this.render(true);
    });

    // filtro simples (cliente)
    html.find(".filter").on("input", ev => {
      const q = ev.currentTarget.value?.toLowerCase() ?? "";
      html.find(".anchor-row").each((_, li) => {
        const label = $(li).find(".open-doc").text().toLowerCase();
        const uuid = $(li).find(".sub").text().toLowerCase();
        const show = label.includes(q) || uuid.includes(q);
        li.style.display = show ? "" : "none";
      });
    });

    // drag & drop de docs
    const dz = html.find(".dropzone")[0];
    if (dz) {
      dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("hover"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("hover"));
      dz.addEventListener("drop", async ev => {
        ev.preventDefault();
        dz.classList.remove("hover");
        let data;
        try { data = TextEditorImpl.getDragEventData(ev); }
        catch (e) { console.error(e); return ui.notifications.warn("Não reconheci o drop."); }

        let uuid = data?.uuid;
        if (!uuid && data?.pack && data?.id) uuid = `Compendium.${data.pack}.${data.id}`;
        if (!uuid && data?.type && data?.id) {
          try { uuid = game.collections.get(data.type)?.get(data.id)?.uuid ?? uuid; } catch {}
        }
        if (!uuid && typeof data === "string") {
          const m = data.match(/@UUID\[(.+?)\]/); if (m) uuid = m[1];
        }
        if (!uuid) return ui.notifications.warn("Não consegui identificar o documento ou UUID.");

        let label;
        try { label = (await fromUuid(uuid))?.name ?? data?.name ?? uuid; }
        catch { label = data?.name ?? uuid; }

        await this._mutateWorking(w => {
          const list = (w.collections[w.active].links ?? (w.collections[w.active].links = []));
          list.push({ uuid, label });
        });
        this.render(true);
      });
    }

    // adicionar manual
    html.find(".add-manual").on("click", async () => {
      const uuid = html.find('input[name="uuid"]').val()?.trim();
      if (!uuid) return ui.notifications.warn("Cole um UUID válido.");
      let label = html.find('input[name="label"]').val()?.trim();
      try { if (!label) label = (await fromUuid(uuid))?.name ?? uuid; } catch {}
      await this._mutateWorking(w => {
        w.collections[w.active].links.push({ uuid, label });
      });
      this.render(true);
    });

    // abrir doc
    html.on("click", ".open-doc", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const uuid = ev.currentTarget.dataset.uuid;
      try { (await fromUuid(uuid))?.sheet?.render(true); }
      catch (e) { console.error(e); ui.notifications.error("Falha ao abrir o documento."); }
    });

    // renomear inline
    html.on("change", ".label-edit", async ev => {
      const li = ev.currentTarget.closest(".anchor-row");
      const idx = Number(li?.dataset?.idx ?? -1);
      if (idx < 0) return;
      const newLabel = ev.currentTarget.value.trim();
      await this._mutateWorking(w => { w.collections[w.active].links[idx].label = newLabel || w.collections[w.active].links[idx].label; });
      this.render(true);
    });

    // copiar enricher
    html.on("click", ".copy-uuid", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const uuid = ev.currentTarget.dataset.uuid;
      const text = `@UUID[${uuid}]{${this._safeLabelFromUuid(uuid)}}`;
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Copiado: " + text);
    });

    // remover
    html.on("click", ".del", async ev => {
      ev.preventDefault(); ev.stopPropagation();
      const idx = Number(ev.currentTarget.closest(".anchor-row")?.dataset?.idx ?? -1);
      if (idx < 0) return;
      await this._mutateWorking(w => { w.collections[w.active].links.splice(idx, 1); });
      this.render(true);
    });

    // reordenar (drag handle)
    let dragIndex = null;
    html.on("dragstart", ".handle", ev => {
      const li = ev.currentTarget.closest(".anchor-row");
      dragIndex = Number(li?.dataset?.idx ?? -1);
      ev.originalEvent?.dataTransfer?.setData("text/plain", String(dragIndex));
    });
    html.on("dragover", ".anchor-row", ev => ev.preventDefault());
    html.on("drop", ".anchor-row", async ev => {
      ev.preventDefault();
      const targetIdx = Number(ev.currentTarget?.dataset?.idx ?? -1);
      const from = dragIndex; const to = targetIdx;
      dragIndex = null;
      if (from < 0 || to < 0 || from === to) return;
      await this._mutateWorking(w => {
        const arr = w.collections[w.active].links;
        const [m] = arr.splice(from, 1);
        arr.splice(to, 0, m);
      });
      this.render(true);
    });

    // exportar/importar
    html.find(".export-json").on("click", async () => {
      const state = await this._getState();
      const working = this._pickWorking(state);
      const payload = {
        active: working.active,
        collections: working.collections
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      saveDataToFile(blob, "anchor-links.json");
    });

    html.find(".import-json").on("click", async () => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "application/json";
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          await this._mutateWorking(w => {
            if (data.collections) w.collections = data.collections;
            if (data.active) w.active = data.active;
          });
          this.render(true);
        } catch {
          ui.notifications.error("JSON inválido.");
        }
      };
      input.click();
    });

    // criar nova aba
    html.find(".add-collection").on("click", async () => {
      const name = await Dialog.prompt({
        title: "Nova Aba",
        content: `<p>Nome da aba:</p><input type="text" name="n" style="width:100%">`,
        label: "Criar",
        callback: (html) => html.find('input[name="n"]').val()?.trim()
      });
      if (!name) return;
      const key = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
      await this._mutateWorking(w => {
        w.collections[key] = { label: name, links: [] };
        w.active = key;
      });
      this.render(true);
    });
  }
}

// ---------- Hooks ----------
// Botão extra na barra superior (cenas) — compat v13+
Hooks.on("renderSceneNavigation", (_app, htmlEl) => {
  const html = $(htmlEl);                     // <-- transforma em jQuery
  if (html.find(".anchor-links-button").length) return; // evita duplicar
  const $btn = $(
    `<a class="anchor-links-button" style="display:flex;align-items:center;gap:6px;">
       <i class="fas fa-link"></i> Anchor Links
     </a>`
  );
  $btn.on("click", () => openPad());
  html.find(".nav-controls").append($btn);
});

});
