/*
 * Standalone runtime for the Solution Delivery Queue.
 *
 * Inside Claude, the page gets its shared storage and the viewer's identity from the
 * artifact platform through `claude.use('db')` and `claude.use('user')`. This file
 * provides the same two calls backed by Supabase, so index.html runs unchanged on any
 * static host. With no Supabase settings in config.js, `use()` resolves null and the
 * page falls back to its built-in example data.
 *
 * Roles live in the `profiles` table (it_admin, process_owner, viewer) and are enforced
 * by row-level security in supabase/schema.sql, not just hidden in the page.
 */
(function () {
  const cfg = window.SDQ_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR_/.test(cfg.supabaseUrl + cfg.supabaseAnonKey);
  if (!configured || !window.supabase) {
    if (configured) console.error('Supabase library failed to load; showing example data.');
    window.claude = { use: async () => null };
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const TABLE = 'documents';
  let session = null;
  let profile = null;

  /* ---------- sign-in ---------- */
  function signInScreen() {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML =
        '<form class="card form" style="margin:0" novalidate>' +
        '<h2>Sign in to the Solution Delivery Queue</h2>' +
        '<p class="muted" style="margin:0">Enter your work email. We will send you a sign-in link.</p>' +
        '<label for="sdq-email"><span>Work email</span><input id="sdq-email" type="email" autocomplete="email" required></label>' +
        '<div class="actions" style="margin:0"><button class="btn primary" type="submit">Send sign-in link</button></div>' +
        '<p id="sdq-msg" class="small muted" style="margin:0" role="status"></p>' +
        '</form>';
      document.body.appendChild(wrap);
      const form = wrap.querySelector('form');
      const msg = wrap.querySelector('#sdq-msg');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = wrap.querySelector('#sdq-email').value.trim();
        if (!email) { msg.textContent = 'Enter your work email.'; return; }
        msg.textContent = 'Sending…';
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
        msg.textContent = error ? 'Could not send the link: ' + error.message : 'Check your inbox for a sign-in link from us, then open it in this browser.';
      });
      sb.auth.onAuthStateChange((event, s) => {
        if (s && !session) { wrap.remove(); resolve(s); }
      });
    });
  }

  function addSignOut() {
    const bar = document.querySelector('.head-actions');
    if (!bar) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = 'Sign out';
    b.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    bar.appendChild(b);
  }

  const ready = (async () => {
    const { data } = await sb.auth.getSession();
    session = data.session || await signInScreen();
    const { data: p, error } = await sb.from('profiles').select('user_id, email, full_name, role').eq('user_id', session.user.id).maybeSingle();
    if (error) console.error(error);
    profile = p || { user_id: session.user.id, role: 'viewer' };
    addSignOut();
  })();

  /* ---------- db ---------- */
  const fail = error => {
    const denied = /row-level security|permission denied|42501/i.test((error.message || '') + ' ' + (error.code || ''));
    throw { code: denied ? 'invalid_argument' : 'unavailable', message: error.message || String(error) };
  };
  const refused = () => { throw { code: 'invalid_argument', message: 'Your role does not allow this change.' }; };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const snapDoc = row => ({ id: row.id, exists: true, data: () => row.data, metadata: { fromCache: false, hasPendingWrites: false } });
  const split = path => { const i = path.lastIndexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; };

  const listeners = {};
  const timers = {};
  async function load(coll) {
    const { data, error } = await sb.from(TABLE).select('id, data').eq('collection', coll).limit(10000);
    if (error) throw error;
    const docs = data.map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function refresh(coll) {
    clearTimeout(timers[coll]);
    timers[coll] = setTimeout(async () => {
      const set = listeners[coll];
      if (!set || !set.size) return;
      try { const snap = await load(coll); set.forEach(l => l.next(snap)); } catch (e) { console.error(e); }
    }, 120);
  }
  let channel = null;
  function watch() {
    if (channel) return;
    channel = sb.channel('sdq-documents')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, payload => {
        const coll = (payload.new && payload.new.collection) || (payload.old && payload.old.collection);
        if (coll) refresh(coll); else Object.keys(listeners).forEach(refresh);
      })
      .subscribe();
    // Safety net if the realtime connection drops.
    setInterval(() => { if (document.visibilityState === 'visible') Object.keys(listeners).forEach(refresh); }, 60000);
  }

  function docRef(path) {
    const [coll, id] = split(path);
    const match = q => q.eq('collection', coll).eq('id', id);
    return {
      id, path,
      async get() {
        const { data, error } = await match(sb.from(TABLE).select('id, data')).maybeSingle();
        if (error) fail(error);
        return data ? snapDoc(data) : { id, exists: false, data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } };
      },
      async set(body) {
        const { error } = await sb.from(TABLE).upsert({ collection: coll, id, data: body });
        if (error) fail(error);
        refresh(coll);
      },
      async update(patch) {
        const { data, error } = await match(sb.from(TABLE).select('data')).maybeSingle();
        if (error) fail(error);
        if (!data) throw { code: 'invalid_argument', message: 'That record no longer exists.' };
        const res = await match(sb.from(TABLE).update({ data: { ...data.data, ...patch } }, { count: 'exact' }));
        if (res.error) fail(res.error);
        if (res.count === 0) refused();
        refresh(coll);
      },
      async delete() {
        const res = await match(sb.from(TABLE).delete({ count: 'exact' }));
        if (res.error) fail(res.error);
        if (res.count === 0) refused();
        refresh(coll);
      },
    };
  }
  function collectionRef(coll) {
    return {
      path: coll,
      doc: id => docRef(coll + '/' + (id || newId())),
      async add(body) { const ref = docRef(coll + '/' + newId()); await ref.set(body); return ref; },
      onSnapshot(next, error) {
        const l = { next, error };
        (listeners[coll] = listeners[coll] || new Set()).add(l);
        watch();
        load(coll).then(next).catch(e => error && error({ code: 'unavailable', message: e.message }));
        return () => listeners[coll].delete(l);
      },
    };
  }
  const db = { doc: docRef, collection: collectionRef };

  /* ---------- user ---------- */
  const isAdmin = () => profile.role === 'it_admin';
  const user = {
    isOwner: async () => false,
    canEdit: async () => isAdmin(),
    can: async name => name === 'data.write' ? profile.role !== 'viewer'
      : (name === 'files.write' || name === 'assets.write') ? isAdmin() : false,
    id: async () => session.user.id,
    name: async () => profile.full_name || '',
    email: async () => session.user.email || null,
    avatarUrl: async () => null,
    me: async () => ({ id: session.user.id, name: profile.full_name || '', avatarUrl: '', color: '', email: session.user.email || null, isOwner: false, canEdit: isAdmin() }),
    async profiles(ids) {
      const list = [...new Set([].concat(ids || []).filter(Boolean))];
      const out = {};
      list.forEach(i => { out[i] = { id: i, name: '', avatarUrl: '', color: '', email: null, isMe: i === session.user.id, guest: false }; });
      const uuids = list.filter(i => /^[0-9a-f-]{36}$/i.test(i));
      if (uuids.length) {
        const { data } = await sb.from('profiles').select('user_id, full_name, email').in('user_id', uuids);
        (data || []).forEach(p => { out[p.user_id].name = p.full_name || p.email || ''; });
      }
      return out;
    },
    search: async () => [],
  };

  window.claude = {
    async use(name) {
      try { await ready; } catch (e) { console.error(e); return null; }
      return name === 'db' ? db : name === 'user' ? user : null;
    },
  };
})();
