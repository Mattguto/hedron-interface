const MODID = "anchor-links-pad"; // usamos o mesmo módulo

async function fromUuidSafe(uuid) {
  try { return await fromUuid(uuid); } catch { return null; }
}

function readHedronSlots(hedronItem) {
  const slots = hedronItem.getFlag("hedron", "slots") ?? { core: null, fragments: [null, null] };
  const arr = [];
  if (slots.core) arr.push(slots.core);
  for (const f of (slots.fragments ?? [])) if (f) arr.push(f);
  return arr;
}

function actorHedrons(actor) {
  return actor.items.filter(i =>
    i.type === "equipment" &&
    (i.slug === "hedron-interface" || i.getFlag("hedron", "isHedronInterface") === true)
  );
}

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

function readGrants(emberDoc) {
  const g = emberDoc.getFlag("hedron", "grant") ?? {};
  const effects = Array.isArray(g.effects) ? g.effects : [];
  const actions = Array.isArray(g.actions) ? g.actions : [];
  return { effects, actions };
}

async function syncActor(actor) {
  const hedrons = actorHedrons(actor);
  if (!hedrons.length) return;

  const emberUuids = [];
  for (const hed of hedrons) emberUuids.push(...readHedronSlots(hed));
  const embers = (await Promise.all(emberUuids.map(fromUuidSafe))).filter(Boolean);

  const wantEffects = new Set();
  const wantActions = new Set();
  for (const ember of embers) {
    const { effects, actions } = readGrants(ember);
    effects.forEach(u => wantEffects.add(u));
    actions.forEach(u => wantActions.add(u));
  }

  const granted = indexGranted(actor);

  // Criar faltantes (Effects)
  const toCreateEffects = [];
  for (const effUuid of wantEffects) {
    if (granted.effects.has(effUuid)) continue;
    const effDoc = await fromUuidSafe(effUuid);
    if (!effDoc) continue;
    const data = effDoc.toObject();
    data._id = undefined;
    data.flags ??= {};
    data.flags.hedron ??= {};
    data.flags.hedron.sourceUuid = effUuid;
    data.flags.hedron.grantKind = "effect";
    data.name = data.name ?? `Hedron Effect`;
    toCreateEffects.push(data);
  }
  if (toCreateEffects.length) await actor.createEmbeddedDocuments("Item", toCreateEffects);

  // Criar faltantes (Actions)
  const toCreateActions = [];
  for (const actUuid of wantActions) {
    if (granted.actions.has(actUuid)) continue;
    const actDoc = await fromUuidSafe(actUuid);
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
  if (toCreateActions.length) await actor.createEmbeddedDocuments("Item", toCreateActions);

  // Remover órfãos
  const toDeleteIds = [];
  for (const [src, item] of granted.effects.entries()) if (!wantEffects.has(src)) toDeleteIds.push(item.id);
  for (const [src, item] of granted.actions.entries()) if (!wantActions.has(src)) toDeleteIds.push(item.id);
  if (toDeleteIds.length) await actor.deleteEmbeddedDocuments("Item", toDeleteIds);
}

async function syncAllActors() {
  for (const a of game.actors.contents) await syncActor(a);
}

Hooks.once("ready", () => {
  // Sincroniza ao entrar
  syncAllActors();

  // Reage a mudanças em itens dentro de atores
  Hooks.on("updateItem", async (item, changes) => {
    try {
      const actor = item.actor; if (!actor) return;
      const flagChanged =
        foundry.utils.getProperty(changes, "flags.hedron.slots") !== undefined ||
        foundry.utils.getProperty(changes, "flags.hedron.isHedronInterface") !== undefined ||
        foundry.utils.getProperty(changes, "flags.hedron.grant") !== undefined ||
        foundry.utils.getProperty(changes, "flags.hedron.type") !== undefined ||
        item.slug === "hedron-interface";
      if (flagChanged) await syncActor(actor);
    } catch (e) { console.error(`[${MODID}] updateItem sync error`, e); }
  });

  Hooks.on("createItem", async item => item.actor && syncActor(item.actor));
  Hooks.on("deleteItem", async item => item.actor && syncActor(item.actor));

  Hooks.on("canvasReady", () => syncAllActors());
});
