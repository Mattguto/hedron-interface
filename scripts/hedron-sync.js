const MODID = "hedron-interface";

/** Resolve safe a partir de UUID de Compêndio ou do Mundo */
async function loadFromUuid(uuid) {
  try { return await fromUuid(uuid); } catch { return null; }
}

/** Lê os slots do Hedron */
function readHedronSlots(hedronItem) {
  const slots = hedronItem.getFlag("hedron", "slots") ?? { core: null, fragments: [null, null] };
  const arr = [];
  if (slots.core) arr.push(slots.core);
  for (const f of (slots.fragments ?? [])) if (f) arr.push(f);
  return arr;
}

/** Coleta todos os Hedrons do ator (você pode filtrar por slug ou por flag) */
function actorHedrons(actor) {
  return actor.items.filter(i =>
    i.type === "equipment" &&
    (i.slug === "hedron-interface" || i.getFlag("hedron", "isHedronInterface") === true)
  );
}

/** Retorna map {effectUUID: EffectItem, actionUUID: ActionItem} já existentes no ator, para não duplicar */
function indexGranted(actor) {
  const bySource = { effects: new Map(), actions: new Map() };
  for (const it of actor.items) {
    const src = it.getFlag("hedron", "sourceUuid");
    const kind = it.getFlag("hedron", "grantKind"); // "effect" | "action"
    if (src && kind === "effect") bySource.effects.set(src, it);
    if (src && kind === "action") bySource.actions.set(src, it);
  }
  return bySource;
}

/** Lê o “pacote” de grants que um Ember entrega (das flags) */
function readGrants(emberDoc) {
  const g = emberDoc.getFlag("hedron", "grant") ?? {};
  const effects = Array.isArray(g.effects) ? g.effects : [];
  const actions = Array.isArray(g.actions) ? g.actions : [];
  return { effects, actions };
}

/** Sincroniza UM ator */
async function syncActor(actor) {
  const hedrons = actorHedrons(actor);
  if (!hedrons.length) return;

  // UUIDs de Ember equipados (dos slots)
  const emberUuids = [];
  for (const hed of hedrons) emberUuids.push(...readHedronSlots(hed));

  // Carrega os docs Ember
  const embers = (await Promise.all(emberUuids.map(loadFromUuid))).filter(Boolean);

  // Coleta grants desejados
  const wantEffects = new Set();
  const wantActions = new Set();
  for (const ember of embers) {
    const { effects, actions } = readGrants(ember);
    effects.forEach(u => wantEffects.add(u));
    actions.forEach(u => wantActions.add(u));
  }

  // Indexa o que já existe no ator
  const granted = indexGranted(actor);

  // CRIAR faltantes (Effects)
  const toCreateEffects = [];
  for (const effUuid of wantEffects) {
    if (granted.effects.has(effUuid)) continue;
    const effDoc = await loadFromUuid(effUuid);
    if (!effDoc) continue;
    const data = effDoc.toObject();
    // Normaliza como Item embutido no ator
    data._id = undefined;
    data.system ??= {};
    // Duração: respeita a origem; se quiser infinito, garanta no effect origem
    data.flags ??= {};
    data.flags.hedron ??= {};
    data.flags.hedron.sourceUuid = effUuid;
    data.flags.hedron.grantKind = "effect";
    // Garanta nome útil
    data.name = data.name ?? `Hedron Effect`;
    toCreateEffects.push(data);
  }
  if (toCreateEffects.length) {
    await actor.createEmbeddedDocuments("Item", toCreateEffects);
  }

  // CRIAR faltantes (Actions)
  const toCreateActions = [];
  for (const actUuid of wantActions) {
    if (granted.actions.has(actUuid)) continue;
    const actDoc = await loadFromUuid(actUuid);
    if (!actDoc) continue;
    const data = actDoc.toObject();
    data._id = undefined;
    data.flags ??= {};
    data.flags.hedron ??= {};
    data.flags.hedron.sourceUuid = actUuid;
    data.flags.hedron.grantKind = "action";
    data.name = data.name ?? `Hedron Action`;
    toCreateActions.push(data);
  }
  if (toCreateActions.length) {
    await actor.createEmbeddedDocuments("Item", toCreateActions);
  }

  // REMOVER órfãos (o que está no ator mas não está mais desejado)
  const toDeleteIds = [];
  for (const [src, item] of granted.effects.entries()) {
    if (!wantEffects.has(src)) toDeleteIds.push(item.id);
  }
  for (const [src, item] of granted.actions.entries()) {
    if (!wantActions.has(src)) toDeleteIds.push(item.id);
  }
  if (toDeleteIds.length) {
    await actor.deleteEmbeddedDocuments("Item", toDeleteIds);
  }
}

/** Sincroniza TODOS os atores visíveis (útil ao conectar/recarregar mundo) */
async function syncAllActors() {
  for (const actor of game.actors.contents) {
    await syncActor(actor);
  }
}

/** Hooks */
Hooks.once("ready", () => {
  // 1) Ao logar, sincroniza
  syncAllActors();

  // 2) Quando mudar algo em um Item dentro de um ator (ex.: Hedron atualizou flags)
  Hooks.on("updateItem", async (item, changes, _opts, _id) => {
    try {
      // Só nos interessa se o item estiver embutido em um ator
      const actor = item.actor;
      if (!actor) return;

      // Mudou flags do Hedron slots? sincroniza esse ator
      const flagsChanged = foundry.utils.getProperty(changes, "flags.hedron.slots") !== undefined
        || foundry.utils.getProperty(changes, "flags.hedron.isHedronInterface") !== undefined
        || foundry.utils.getProperty(changes, "flags.hedron") !== undefined;

      // Ou se o item EM si é um Ember que teve grants alterados
      const emberGrantsChanged =
        foundry.utils.getProperty(changes, "flags.hedron.grant") !== undefined ||
        foundry.utils.getProperty(changes, "flags.hedron.type") !== undefined;

      if (flagsChanged || emberGrantsChanged || item.slug === "hedron-interface") {
        await syncActor(actor);
      }
    } catch (e) {
      console.error(`[${MODID}] updateItem sync error`, e);
    }
  });

  // 3) Quando adicionar/remover itens em um ator
  Hooks.on("createItem", async (item) => item.actor && syncActor(item.actor));
  Hooks.on("deleteItem", async (item) => item.actor && syncActor(item.actor));

  // 4) Quando trocar de cena (se você usa “por cena” para qualquer efeito futuro)
  Hooks.on("canvasReady", () => syncAllActors());
});
