/* Revendo — synchronisation des données (toutes les données de l'appli) sur un compte utilisateur.
   Stockage : Supabase (gratuit) — table user_data (user_id, key, value, updated_at).
   Chaque clé enregistrée dans le téléphone (articles, achats, porte-monnaie, historique des scans, recherches, réglages…)
   est copiée sur le compte ; à chaque retour sur le site, on récupère la dernière version. */
(() => {
  const CFG = 'revendo-sync-config';
  const META = 'revendo-sync-meta';            // { key: updated_at_iso }
  const SKIP = k => !k || k === CFG || k === META || k === 'revendo-api-key' || k === 'revendo-model' || k.startsWith('sb-') || k.startsWith('supabase');
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  let cfg = {}; try { cfg = JSON.parse(get(CFG) || '{}'); } catch {}
  let meta = {}; try { meta = JSON.parse(get(META) || '{}'); } catch {}
  let client = null, user = null, pushTimer = null, muted = false;
  const dirty = new Set();
  const ui = {};

  // ---- persistance locale renforcée ----
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}

  // ---- interception des écritures locales (cette page) ----
  const origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === localStorage && !muted && !SKIP(k)) queue(k); };
  Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === localStorage && !muted && !SKIP(k)) queue(k); };
  // écritures faites par l'onglet « Mon espace » (autre fenêtre, même site)
  addEventListener('storage', e => { if (e.storageArea === localStorage && !SKIP(e.key)) queue(e.key); });

  function queue(k) { dirty.add(k); clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); status(); }

  // ---- Supabase ----
  function connect() {
    if (!cfg.url || !cfg.key || !window.supabase) return null;
    try { client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); } catch { client = null; }
    return client;
  }
  async function session() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    user = data?.session?.user || null; return user;
  }
  async function push() {
    if (!client || !user || !dirty.size) return;
    const keys = [...dirty]; dirty.clear();
    const now = new Date().toISOString();
    const rows = keys.map(k => { const raw = get(k); return { user_id: user.id, key: k, value: raw === null ? null : { raw }, updated_at: now }; });
    const { error } = await client.from('user_data').upsert(rows, { onConflict: 'user_id,key' });
    if (error) { keys.forEach(k => dirty.add(k)); status('Erreur de synchronisation : ' + error.message); return; }
    keys.forEach(k => { meta[k] = now; }); set(META, JSON.stringify(meta)); status();
  }
  async function pull() {
    if (!client || !user) return false;
    const { data, error } = await client.from('user_data').select('key,value,updated_at').eq('user_id', user.id);
    if (error) { status('Erreur de lecture : ' + error.message); return false; }
    let changed = false; muted = true;
    for (const r of data || []) {
      const local = meta[r.key];
      if (local && local >= r.updated_at) continue;                  // la version du téléphone est plus récente ou identique
      const raw = r.value && typeof r.value === 'object' ? r.value.raw : null;
      if (raw === null || raw === undefined) { try { origRemove.call(localStorage, r.key); } catch {} }
      else origSet.call(localStorage, r.key, raw);
      meta[r.key] = r.updated_at; changed = true;
    }
    muted = false; set(META, JSON.stringify(meta));
    // tout ce que le téléphone a et que le compte n'a pas encore → envoi
    const remoteKeys = new Set((data || []).map(r => r.key));
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!SKIP(k) && !remoteKeys.has(k)) dirty.add(k); }
    if (dirty.size) await push();
    return changed;
  }

  // ---- interface (section Réglages) ----
  function status(msg) {
    if (!ui.status) return;
    if (msg) { ui.status.textContent = msg; return; }
    if (!cfg.url) ui.status.textContent = 'Sauvegarde en ligne non configurée : les données restent dans cet appareil.';
    else if (!user) ui.status.textContent = 'Non connecté : les données restent dans cet appareil tant que tu n\'es pas connecté.';
    else ui.status.textContent = dirty.size ? 'Enregistrement…' : 'Connecté : ' + (user.email || user.id) + ' · tout est sauvegardé en ligne.';
  }
  function build() {
    const host = document.getElementById('settings'); if (!host) return;
    const sec = document.createElement('div'); sec.style.marginTop = '14px';
    sec.innerHTML = `
      <div class="eyebrow">Sauvegarde en ligne (compte)</div>
      <p class="note" style="margin:4px 0 10px">Avec un compte, toutes les données (articles, achats, porte-monnaie, scans, recherches, réglages) sont sauvegardées et retrouvées à chaque visite, sur tous tes appareils. Voir LISEZ-MOI pour créer le projet Supabase (gratuit).</p>
      <div class="grid">
        <label class="f">URL du projet Supabase <input id="sync-url" placeholder="https://xxxx.supabase.co"></label>
        <label class="f">Clé publique (anon key) <input id="sync-key" type="password" autocomplete="off" placeholder="eyJ…"></label>
        <label class="f">Ton e-mail <input id="sync-email" type="email" autocomplete="email" placeholder="toi@exemple.fr"></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost" id="sync-save" type="button">Enregistrer la configuration</button>
        <button class="btn ghost" id="sync-login" type="button">Recevoir le lien de connexion</button>
        <button class="btn ghost" id="sync-now" type="button">Synchroniser maintenant</button>
        <button class="btn ghost" id="sync-logout" type="button">Se déconnecter</button>
      </div>
      <p class="status" id="sync-status" style="margin-top:6px"></p>`;
    host.append(sec);
    ui.status = sec.querySelector('#sync-status');
    const url = sec.querySelector('#sync-url'), key = sec.querySelector('#sync-key'), email = sec.querySelector('#sync-email');
    url.value = cfg.url || ''; key.value = cfg.key || ''; email.value = cfg.email || '';
    sec.querySelector('#sync-save').onclick = async () => {
      cfg = { url: url.value.trim().replace(/\/$/, ''), key: key.value.trim(), email: email.value.trim() };
      set(CFG, JSON.stringify(cfg)); connect(); await session(); status(cfg.url ? 'Configuration enregistrée.' : 'Configuration effacée.'); setTimeout(status, 2000);
    };
    sec.querySelector('#sync-login').onclick = async () => {
      if (!connect()) { status('Renseigne d\'abord l\'URL et la clé, puis enregistre.'); return; }
      const em = email.value.trim(); if (!em) { status('Indique ton e-mail.'); return; }
      cfg.email = em; set(CFG, JSON.stringify(cfg));
      const { error } = await client.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
      status(error ? 'Envoi impossible : ' + error.message : 'Lien envoyé à ' + em + '. Ouvre-le sur cet appareil pour te connecter.');
    };
    sec.querySelector('#sync-now').onclick = async () => { if (!client) connect(); await session(); if (!user) { status(); return; } status('Synchronisation…'); const ch = await pull(); if (ch) location.reload(); else status(); };
    sec.querySelector('#sync-logout').onclick = async () => { if (client) await client.auth.signOut(); user = null; status(); };
    status();
  }

  addEventListener('DOMContentLoaded', async () => {
    build();
    if (!connect()) return;
    await session();
    client.auth.onAuthStateChange(async (ev, s) => { user = s?.user || null; status(); if (ev === 'SIGNED_IN') { const ch = await pull(); if (ch) location.reload(); } });
    if (user) { const ch = await pull(); if (ch) location.reload(); }
    status();
  });
  addEventListener('pagehide', () => { if (dirty.size) push(); });
})();
