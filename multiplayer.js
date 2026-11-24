/* СКАЛА — мод «Сетевая игра» v9 (P2P через WebRTC / PeerJS).
   Хост считает всю игру и шлёт второму игроку только данные: снимки мира ~20 раз в секунду и события (взрывы, трассеры).
   Второй игрок заменяет одного бота, рисует мир САМ своей видеокартой и отправляет хосту только команды и наводку.
   Видео больше нет. Нужен интернет у обоих. */
(function () {
  'use strict';
  const VERSION = '9';
  const PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  const $ = id => document.getElementById(id);
  const el = (tag, css, html) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; };
  const FONT = 'font:14px system-ui,Segoe UI,sans-serif;color:#e8dcc4;';
  const r2 = v => Math.round(v * 100) / 100;

  let peer = null, conn = null, role = null, lastPing = 0, wd = 0, lastPong = 0, gwd = 0;
  // хост
  let hostB = null, pending = null, snapTimer = 0, stTimer = 0, mgTimer = 0, evq = [], hooked = false, lastT = performance.now();
  const G = { mode: 'god', yaw: 0, pitch: .05, fire: false, mgCd: 0 };     // наводка второго игрока (приходит по сети)
  const RNG = { gun: { y: 1.2, p0: -1.4, p1: .5 }, mg: { y: 1.9, p0: -1.45, p1: -.3 } };   // те же пределы наводки, что у хоста
  const gunBase = () => -(hostB ? hostB.dir : 1) * Math.PI / 2, aimBase = () => G.mode === 'gun' ? gunBase() : Math.PI;
  // гость
  let gui = {}, gB = null, started = false, rtt = 0, snapN = 0, snapT = performance.now(), statT = 0;
  const gs = { mode: 'god', yaw: 0, pitch: .05, fire: false };           // что делает гость
  const fc = { yaw: 0, pitch: .3, dist: 130, tx: 0, ty: 18, free: false };   // свободная камера гостя (только у него)
  let hostGC = { y: 46, z: 118, rx: -.13 };
  let hideList = [], hideMode = '', hideF = -1;

  function loadPeer() {
    return new Promise((ok, no) => {
      if (window.Peer) return ok();
      const s = document.createElement('script'); s.src = PEER_URL; s.onload = ok;
      s.onerror = () => no(new Error('Не удалось загрузить PeerJS. Нужен интернет.'));
      document.head.appendChild(s);
    });
  }
  const send = m => { try { if (conn && conn.open) conn.send(m); } catch (e) {} };

  /* ---------- меню ---------- */
  const btn = el('button', 'position:fixed;left:10px;bottom:10px;z-index:60;padding:8px 14px;background:#201d19;color:#d9b27a;border:2px solid #6b4a2a;border-radius:3px;cursor:pointer;' + FONT, 'Сетевая игра v' + VERSION);
  const panel = el('div', 'position:fixed;left:10px;bottom:52px;z-index:60;width:300px;background:#14110e;border:2px solid #6b4a2a;border-radius:4px;padding:12px;display:none;' + FONT);
  document.body.append(btn, panel);
  btn.onclick = () => { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; if (!role) drawMenu(); else if (role === 'host' && conn && conn.open) drawConnected(); };
  const mkb = (t, f) => { const b = el('button', 'display:block;width:100%;margin:6px 0;padding:8px;background:#2a2622;color:#e8dcc4;border:1px solid #6b4a2a;border-radius:3px;cursor:pointer;font:inherit;', t); b.onclick = f; return b; };
  function drawMenu(msg) {
    panel.innerHTML = '';
    panel.append(el('div', 'margin-bottom:6px;', '<b>Сетевая игра для двоих</b>'));
    panel.append(mkb('Создать игру (я хост)', hostStart));
    const inp = el('input', 'width:100%;box-sizing:border-box;padding:7px;margin-top:6px;background:#000;color:#fff;border:1px solid #6b4a2a;text-transform:uppercase;font:inherit;');
    inp.placeholder = 'Код от хоста, например K7P2Q';
    panel.append(inp, mkb('Присоединиться', () => guestStart(inp.value)));
    panel.append(el('div', 'margin-top:8px;border-top:1px solid #444;padding-top:6px;color:#9a8a70;font-size:12px;', 'Если сервер недоступен (ошибка server-error) — режим без сервера, коды копируются вручную:'), mkb('Создать игру вручную', manualHost), mkb('Присоединиться вручную', manualGuest));
    if (msg) panel.append(el('div', 'color:#e88;margin-top:6px;', msg));
  }

  /* ---------- ХОСТ ---------- */
  function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += a[Math.random() * a.length | 0]; return c; }
  function hostStart() {
    panel.innerHTML = 'Подключаюсь к сети…';
    loadPeer().then(() => {
      role = 'host'; const code = genCode();
      peer = new Peer('skala-' + code);
      peer.on('open', () => {
        panel.innerHTML = '';
        panel.append(el('div', '', 'Код для второго игрока:'), el('div', 'font:bold 34px monospace;letter-spacing:4px;color:#ffd27a;margin:6px 0;user-select:all;', code),
          el('div', 'color:#9a8a70;font-size:12px;', 'Настрой лобби как обычно (боты нужных стран), нажми старт. Второй игрок сам выберет, кого заменить.'));
        const st = el('div', 'margin-top:8px;', 'Ожидание игрока…'); st.id = 'mpStatus'; panel.append(st);
      });
      peer.on('connection', c => hostAttach(c));
      peer.on('error', e => status('Нет связи с сервером PeerJS (' + e.type + '). Попробуй режим «вручную».'));
    }).catch(e => drawMenu(e.message));
  }

  function drawConnected() {
    panel.innerHTML = ''; panel.style.width = '300px';
    panel.append(el('div', '', '<b>Игрок 2 подключён</b>'), el('div', 'color:#9a8a70;font-size:12px;margin:4px 0;', 'Он рисует картинку у себя на компьютере, ты играешь как обычно.'));
    const st = el('div', 'margin-top:6px;', ''); st.id = 'mpStatus'; panel.append(st);
  }
  function hostAttach(c) {
    if (conn && conn.open) { c.close(); return; }
    conn = c;
    c.on('open', () => { drawConnected(); panel.style.display = 'none'; lastPing = performance.now(); clearInterval(wd); let tk = performance.now(); wd = setInterval(() => { const n = performance.now(), late = n - tk > 3500; tk = n; if (!late && n - lastPing > 20000) { clearInterval(wd); guestLeft(); } }, 2000); status('Игрок подключился'); sendSlots(); });
    c.on('data', onHostData); c.on('close', guestLeft); c.on('error', guestLeft);
  }
  /* ---------- режим без сервера: обмен кодами вручную ---------- */
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.services.mozilla.com' }] };
  function wrapDC(dc) {
    const o = { open: false, peer: 'manual', dataChannel: dc, _h: {}, on(e, f) { this._h[e] = f; }, send(m) { dc.send(JSON.stringify(m)); }, close() { dc.close(); } };
    dc.onopen = () => { o.open = true; o._h.open && o._h.open(); };
    dc.onmessage = e => { try { o._h.data && o._h.data(JSON.parse(e.data)); } catch (x) {} };
    dc.onclose = () => { o.open = false; o._h.close && o._h.close(); };
    if (dc.readyState === 'open') setTimeout(() => dc.onopen(), 0);
    return o;
  }
  function waitIce(pc) { return new Promise(ok => { if (pc.iceGatheringState === 'complete') return ok(); const t = setTimeout(ok, 6000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); ok(); } }; }); }
  async function pack(sd) {
    const j = JSON.stringify({ t: sd.type, s: sd.sdp });
    if (window.CompressionStream) { try { const cs = new CompressionStream('gzip'), w = cs.writable.getWriter(); w.write(new TextEncoder().encode(j)); w.close(); const b = new Uint8Array(await new Response(cs.readable).arrayBuffer()); let s = ''; b.forEach(x => s += String.fromCharCode(x)); return 'Z' + btoa(s); } catch (e) {} }
    return 'R' + btoa(unescape(encodeURIComponent(j)));
  }
  async function unpack(str) {
    str = (str || '').trim().replace(/\s+/g, ''); const k = str[0], b = atob(str.slice(1));
    if (k === 'Z') { const u = Uint8Array.from(b, c => c.charCodeAt(0)), ds = new DecompressionStream('gzip'), w = ds.writable.getWriter(); w.write(u); w.close(); return JSON.parse(await new Response(ds.readable).text()); }
    return JSON.parse(decodeURIComponent(escape(b)));
  }
  const ta = (ro, rows) => { const t = el('textarea', 'width:100%;box-sizing:border-box;height:' + (rows || 70) + 'px;background:#000;color:#8fd48f;border:1px solid #6b4a2a;font:11px monospace;resize:none;'); t.readOnly = !!ro; if (ro) t.onclick = () => t.select(); return t; };
  async function manualHost() {
    if (!window.RTCPeerConnection) return drawMenu('В этом браузере нет WebRTC.');
    panel.innerHTML = 'Готовлю код…'; role = 'host';
    const pc = new RTCPeerConnection(ICE), dc = pc.createDataChannel('g');
    hostAttach(wrapDC(dc));
    await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc);
    const code = await pack(pc.localDescription), mine = ta(true), theirs = ta(false);
    mine.value = code;
    panel.innerHTML = ''; panel.style.width = '380px';
    panel.append(el('div', '', '<b>Шаг 1.</b> Отправь этот код второму игроку (клик — выделить, Ctrl+C):'), mine,
      el('div', 'margin-top:6px;', '<b>Шаг 2.</b> Вставь сюда его ответный код:'), theirs,
      mkb('Соединить', async () => { try { const a = await unpack(theirs.value); await pc.setRemoteDescription({ type: a.t, sdp: a.s }); status('Соединяюсь…'); } catch (e) { status('Неверный код ответа'); } }));
    const st2 = el('div', 'margin-top:6px;', ''); st2.id = 'mpStatus'; panel.append(st2);
  }
  function manualGuest() {
    if (!window.RTCPeerConnection) return drawMenu('В этом браузере нет WebRTC.');
    panel.innerHTML = ''; panel.style.width = '380px';
    const inp = ta(false);
    panel.append(el('div', '', 'Вставь код от хоста:'), inp, mkb('Продолжить', async () => {
      try {
        const o = await unpack(inp.value); role = 'guest'; buildOverlay();
        const pc = new RTCPeerConnection(ICE);
        pc.ondatachannel = e => guestAttach(wrapDC(e.channel));
        await pc.setRemoteDescription({ type: o.t, sdp: o.s });
        await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc);
        const mine = ta(true, 90); mine.value = await pack(pc.localDescription);
        gui.pick.innerHTML = ''; gui.pick.style.display = 'block'; gui.pick.style.width = '380px';
        gui.pick.append(el('div', 'margin-bottom:6px;', 'Отправь этот ответный код хосту и жди соединения:'), mine);
      } catch (e) { role = null; const ov = gui.ov; if (ov) ov.remove(); panel.style.display = 'block'; btn.style.display = ''; drawMenu('Неверный код: ' + e.message); }
    }));
  }
  function guestAttach(c) {
    conn = c;
    c.on('open', () => { gui.pick.style.display = 'none'; setInfo('Подключено. Жду данные от хоста…'); send({ t: 'hello', v: VERSION }); lastPong = performance.now(); clearInterval(gwd); let gtk = performance.now(); gwd = setInterval(() => { send({ t: 'ping', ts: performance.now() }); const n = performance.now(), late = n - gtk > 3500; gtk = n; if (!late && n - lastPong > 20000) { setInfo('Связь с хостом потеряна.'); SK.toast('Связь с хостом потеряна'); clearInterval(gwd); } }, 2000); });
    c.on('data', onGuestData); c.on('close', () => setInfo('Хост отключился.')); c.on('error', e => setInfo('Ошибка: ' + e.type));
  }
  function status(t) { const s = $('mpStatus'); if (s) s.textContent = t; if (window.SK) SK.toast(t); }

  function guestLeft() {
    clearInterval(wd); delete window.SK_mpms; try { if (conn) conn.close(); } catch (e) {}
    if (hostB) { hostB.human = false; if (hostB.oldName) hostB.name = hostB.oldName; }
    hostB = null; pending = null; conn = null; try { SK.renderLobby && SK.renderLobby(); } catch (e) {}
    clearInterval(snapTimer); clearInterval(stTimer); clearInterval(mgTimer); unhook();
    G.mode = 'god'; G.fire = false;
    status('Второй игрок отключился (бот снова играет сам)');
  }

  function slotList() {
    const SKx = window.SK, f = i => (SKx.FAC[i] && SKx.FAC[i].n) || ('Игрок ' + i);
    if (SKx.BOTS.length) return SKx.BOTS.filter(b => b.alive).map(b => ({ i: b.fid, n: b.name, team: b.team }));
    return SKx.LOB.map((s, i) => ({ i, s })).filter(o => o.i > 0 && o.s.type !== 'off').map(o => ({ i: o.i, n: f(o.i), team: o.s.team }));
  }
  function sendSlots() { send({ t: 'slots', list: slotList(), taken: pending != null || !!hostB }); }
  function attach(i) {
    const B = SK.BOTS.find(b => b.fid === i);
    if (!B) return;
    B.human = true; hostB = B; B.oldName = B.name; B.name = 'Игрок 2';
    try { const f = B.G.children.find(c => c.geometry && c.geometry.type === 'PlaneGeometry' && c.geometry.parameters && c.geometry.parameters.width === 4 && c.geometry.parameters.height === 2.5 && c.material && c.material.map); if (f) { const src = SK.flagCanvas(0), cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const x = cv.getContext('2d'); x.drawImage(src, 0, 0); x.fillStyle = '#fff'; x.font = 'bold ' + (cv.height * .5 | 0) + 'px sans-serif'; x.textAlign = 'center'; x.fillText('2', cv.width / 2, cv.height * .72); f.material.map = new THREE.CanvasTexture(cv); f.material.needsUpdate = true; } } catch (e) {}
    SK.toast('Игрок 2 управляет базой: ' + B.oldName);
    G.yaw = 0; G.pitch = .05; G.mode = 'god'; G.fire = false; G.mgCd = 0;
    const gc = SK.GC || { y: 46, z: 118, rx: -.13 }; send({ t: 'picked', n: B.oldName, bx: B.x, dir: B.dir, gc: { y: gc.y, z: gc.z, rx: gc.rx } });
    startFeed(i);
  }
  // с этого момента хост шлёт гостю данные мира
  function startFeed(fid) {
    if (!window.SKM) { status('В index.html нет сетевого режима v' + VERSION + '. Замени index.html на новый.'); return; }
    hook();
    send(Object.assign({ t: 'init', fid }, SKM.cfg()));
    clearInterval(stTimer); stTimer = setInterval(sendState, 300);
    clearInterval(snapTimer); snapTimer = setInterval(sendSnap, 50);
    clearInterval(mgTimer); lastT = performance.now(); mgTimer = setInterval(mgTick, 25);
  }
  window.SK_lobby = L => {
    if (pending == null || !L.children[pending]) return;
    const r = L.children[pending], fn = r.querySelector('.fn'), fl = r.querySelector('.fl'), bt = r.querySelectorAll('button')[0];
    if (fn) fn.textContent = 'Игрок 2 (по сети)'; if (bt) bt.textContent = 'Игрок 2 заменяет бота';
    try { const src = SK.flagCanvas(0), cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const x = cv.getContext('2d'); x.drawImage(src, 0, 0); x.fillStyle = '#fff'; x.font = 'bold ' + (cv.height * .5 | 0) + 'px sans-serif'; x.textAlign = 'center'; x.fillText('2', cv.width / 2, cv.height * .72); if (fl) fl.style.background = 'url(' + cv.toDataURL() + ') center/cover'; } catch (e) {}
  };
  window.SK_start = () => { if (role !== 'host') return; if (pending != null) { attach(pending); pending = null; } else if (conn) sendSlots(); };

  function setAim(m) {
    if (typeof m.yaw !== 'number' || typeof m.pitch !== 'number' || !isFinite(m.yaw) || !isFinite(m.pitch)) return;
    const R = RNG[m.m || G.mode];
    G.yaw = R ? Math.max(-R.y, Math.min(R.y, m.yaw)) : m.yaw; G.pitch = R ? Math.max(R.p0, Math.min(R.p1, m.pitch)) : m.pitch;
  }
  function onHostData(m) {
    if (!m) return;
    lastPing = performance.now();
    if (m.t === 'ping') { send({ t: 'pong', ts: m.ts }); return; }
    if (m.t === 'hello') { send({ t: 'ver', v: VERSION }); if (m.v !== VERSION) status('ВНИМАНИЕ: у второго игрока версия мода ' + m.v + ', у тебя ' + VERSION + '. Скопируй ему актуальные index.html и multiplayer.js из одного архива.'); }
    else if (m.t === 'slots?') sendSlots();
    else if (m.t === 'pick') {
      if (hostB || pending != null) return;
      if (SK.BOTS.length) attach(m.i); else { pending = m.i; send({ t: 'picked', n: SK.FAC[m.i].n + ' (начнётся со стартом матча)', dir: 1, bx: 0 }); status('Игрок 2 выбрал: ' + SK.FAC[m.i].n); try { SK.renderLobby(); } catch (e) {} }
    }
    else if (m.t === 'in') { G.mode = m.m === 'gun' || m.m === 'mg' ? m.m : 'god'; setAim(m); G.fire = !!m.fire; }
    else if (m.t === 'shoot') { setAim(m); cannonShot(); }
    else if (m.t === 'cmd') runCmd(m.c);
  }

  // точка, откуда стреляет игрок 2 (там же стоит его камера у него на компьютере)
  function eyePos(B, mode) { return mode === 'gun' ? new THREE.Vector3(B.x + B.dir * 5.8, 37.6 + B.y0, 7.4) : new THREE.Vector3(B.x, 29.4 + B.y0, 4); }
  function aimDir() { const th = aimBase() + G.yaw, cp = Math.cos(G.pitch); return new THREE.Vector3(-cp * Math.sin(th), Math.sin(G.pitch), -cp * Math.cos(th)).normalize(); }
  function cannonShot() {
    const B = hostB, S = SK.S;
    if (!B || G.mode !== 'gun' || S.over || !B.alive || !B.built || B.shells < 1 || B.fireT > 0) return;
    const d = aimDir(), mm = SK.makeShell(0x4a3028);
    mm.position.copy(eyePos(B, 'gun')).addScaledVector(d, 3); SK.scene.add(mm);
    SK.projs.push({ m: mm, v: d.clone().multiplyScalar(75), t: 0, team: B.team });
    B.shells--; B.fireT = 2.2; SK.playCannon(.5);
  }
  function mgShot() {
    const B = hostB, S = SK.S; if (!B || S.over || !B.alive) return;
    G.mgCd = .09;
    const r = () => (Math.random() - .5) * .024, d = aimDir().add(new THREE.Vector3(r(), r(), r())).normalize(), pos = eyePos(B, 'mg');
    const rc = new THREE.Raycaster(pos, d, 0, 200), hit = rc.intersectObjects(B.muts.map(k => k.m), true)[0];
    let end;
    if (hit) { const k = B.muts.find(k => { let o = hit.object; while (o) { if (o === k.m) return true; o = o.parent; } return false; }); if (k) { k.hp--; if (k.hp <= 0) SK.killMut(k); } end = hit.point; }
    else end = d.y < -.01 ? pos.clone().add(d.clone().multiplyScalar(-pos.y / d.y)) : pos.clone().add(d.clone().multiplyScalar(60));
    if (Math.random() < .065) { const hs = SK.hostileSquads(B.team).filter(o => o.s.m.position.y < 3); if (hs.length) { const o = hs[0 | Math.random() * hs.length]; o.s.hp -= .6; if (o.s.hp <= 0) o.kill(o.s); end = o.s.m.position.clone(); } }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pos.clone().add(new THREE.Vector3(0, -.5, 0)), end]), new THREE.LineBasicMaterial({ color: 0xffd27a }));
    SK.scene.add(l); SK.fx.push({ m: l, t: 0, ttl: .06, line: true });
  }
  function mgTick() {
    const n = performance.now(), dt = Math.min(.1, (n - lastT) / 1000); lastT = n;
    if (!hostB) return;
    G.mgCd -= dt; if (G.mode === 'mg' && G.fire && G.mgCd <= 0) mgShot();
  }
  function runCmd(c) {
    const B = hostB, S = SK.S;
    if (!B || S.over || !B.alive) return;
    const arm = () => SK.armor(B.x, B.fort, B.y0);
    switch (c) {
      case 'lower': if (B.sq === 'home' && B.cool <= 0) SK.botLower(B); break;
      case 'up': if (B.sq === 'ground') { B.sq = 'up'; B.t = 0; B.squad.forEach(s => s.dly = undefined); } break;
      case 'build': if (!B.built && !B.bt && B.metal >= 100) { B.metal -= 100; B.bt = 3; B.cn.visible = true; B.cn.scale.setScalar(.2); } break;
      case 'craft': if (B.built && B.metal >= 10) { B.metal -= 10; B.shells++; } break;
      case 'repair': if (B.hp < 100 && B.metal >= 60) { B.metal -= 60; B.hp = Math.min(100, B.hp + 30); } break;
      case 'fort': if (B.fort < 3 && B.metal >= 70) { B.metal -= 70; B.fort++; B.parts.push(...arm()); } break;
      case 'wh': if (B.wh < 3 && B.metal >= 80) { B.metal -= 80; B.wh++; } break;
      case 'upg': if (!B.lvl && B.metal >= 50) { B.metal -= 50; B.lvl = 1; SK.toast(B.name + ': разведчики улучшены'); } break;
    }
  }
  function sendState() {
    const B = hostB; if (!B) return; const S = SK.S;
    send({ t: 'st', n: B.name, metal: B.metal | 0, shells: B.shells, hp: B.hp | 0, fort: B.fort, wh: B.wh, built: B.built, bt: B.bt, sq: B.sq,
      fireT: Math.max(0, B.fireT), cool: Math.max(0, B.cool), lvl: B.lvl | 0, over: !!S.over, alive: B.alive, team: B.team,
      others: [{ n: 'Хост', hp: S.pHp | 0, team: S.team }].concat(SK.BOTS.filter(b => b !== B).map(b => ({ n: b.name, hp: b.hp | 0, team: b.team }))) });
  }

  /* ---------- данные мира для гостя ---------- */
  // перехватываем появление вспышек и трассеров в игре хоста, чтобы переслать их гостю событиями
  function fxEv(f) {
    if (!f || !f.m) return;
    if (f.line) { const a = f.m.geometry.attributes.position.array; evq.push({ k: 'ln', a: [r2(a[0]), r2(a[1]), r2(a[2])], b: [r2(a[3]), r2(a[4]), r2(a[5])] }); }
    else if (f.R !== undefined) { const p = f.m.position; evq.push({ k: 'ex', p: [r2(p.x), r2(p.y), r2(p.z)], R: f.R }); }
    if (evq.length > 300) evq.splice(0, evq.length - 300);
  }
  function hook() {
    if (hooked) return; hooked = true; evq = [];
    SK.fx.push = function () { for (let i = 0; i < arguments.length; i++) { try { fxEv(arguments[i]); } catch (e) {} } return Array.prototype.push.apply(this, arguments); };
    window.SK_ev = e => { evq.push(e); if (evq.length > 300) evq.splice(0, evq.length - 300); };
  }
  function unhook() { if (!hooked) return; hooked = false; try { delete SK.fx.push; } catch (e) {} window.SK_ev = null; evq = []; }
  function sendSnap() {
    if (!hostB || !conn || !conn.open || !window.SKM) return;
    try { const dc = conn.dataChannel; if (dc && dc.bufferedAmount > 150000) return; } catch (e) {}   // канал не успевает — пропускаем кадр, не копим очередь
    const s = SKM.snap(); s.t = 'w'; s.ev = evq; evq = []; send(s);
  }

  /* ---------- ГОСТЬ ---------- */
  function guestStart(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length < 4) return drawMenu('Введи код от хоста.');
    panel.innerHTML = 'Подключаюсь…';
    loadPeer().then(() => {
      role = 'guest'; buildOverlay();
      peer = new Peer();
      peer.on('open', () => {
        guestAttach(peer.connect('skala-' + code, { reliable: true }));
        setTimeout(() => { if (!conn.open) setInfo('Не удаётся подключиться. Проверь код и что хост создал игру.'); }, 15000);
      });
      peer.on('error', e => setInfo(e.type === 'peer-unavailable' ? 'Неверный код или хост не создал игру.' : 'Нет связи с сервером PeerJS (' + e.type + ').\nЗакрой игру и используй «Присоединиться вручную».'));
    }).catch(e => { role = null; drawMenu(e.message); });
  }
  function setInfo(t) { if (gui.info) gui.info.textContent = t; }
  const $$ = id => document.getElementById(id);
  function gmode(md) {
    gs.mode = md; gs.fire = false;
    const aim = md !== 'god';
    if (md === 'gun') { gs.yaw = 0; gs.pitch = .08; } else if (md === 'mg') { gs.yaw = 0; gs.pitch = -.9; }
    if (!aim && fc.free) fc.free = false;
    $$('bExit').style.display = aim ? '' : 'none';
    if (!aim) { try { document.exitPointerLock(); } catch (e) {} }
    if (window.SKM && SKM.on) SKM.view(md);
    if (aim) SK.toast(md === 'gun' ? 'ПУШКА: кликни по экрану, води мышью для наводки. ЛКМ — выстрел. Esc — выход.' : 'ПУЛЕМЁТ: кликни по экрану, води мышью. Держи ЛКМ — огонь. Esc — выход.');
    sendIn();
  }
  let lastIn = '';
  function sendIn() { const k = gs.mode + gs.yaw.toFixed(3) + gs.pitch.toFixed(3) + gs.fire; if (k !== lastIn) { lastIn = k; send({ t: 'in', m: gs.mode, yaw: gs.yaw, pitch: gs.pitch, fire: gs.fire }); } }
  function statTick() {
    if (!gui.stat) return;
    const n = performance.now(), rate = Math.round(snapN * 1000 / Math.max(1, n - snapT)); snapN = 0; snapT = n;
    gui.stat.textContent = 'связь с хостом: ' + (rtt ? Math.round(rtt) + ' мс' : '…') + ' · данных ' + rate + '/с';
  }
  function freeCam() { if (fc.free) return; const dy = hostGC.y - 18, d = Math.hypot(hostGC.z, dy); fc.free = true; fc.tx = 0; fc.ty = 18; fc.dist = d; fc.pitch = Math.asin(dy / d); fc.yaw = 0; }
  // прячем (только у гостя) крепление пулемёта / корпус пушки у самой камеры, чтобы они не закрывали обзор
  function restoreHide() { hideList.forEach(o => o.visible = true); hideList = []; }
  function computeHide(B, c) {
    hideList = []; const cp = c.position, sz = new THREE.Vector3(), seen = new Set();
    [B.cn].concat(B.parts || [], B.G ? B.G.children : []).forEach(o => {
      if (!o || seen.has(o)) return; seen.add(o);
      try {
        if (o === B.cn && gs.mode === 'gun') { hideList.push(o); return; }
        const bb = new THREE.Box3().setFromObject(o); bb.getSize(sz);
        if (bb.distanceToPoint(cp) < 3 && Math.max(sz.x, sz.y, sz.z) < 7) hideList.push(o);
      } catch (e) {}
    });
  }
  // камера гостя: вызывается из игры на каждом кадре перед отрисовкой
  window.SK_mcam = c => {
    const B = gB; c.rotation.order = 'YXZ';
    if (B && gs.mode !== 'god') {
      const gun = gs.mode === 'gun';
      if (gun) c.position.set(B.x + B.dir * 5.8, 37.6 + B.y0, 7.4); else c.position.set(B.x, 29.4 + B.y0, 4);
      c.rotation.set(gs.pitch, (gun ? -B.dir * Math.PI / 2 : Math.PI) + gs.yaw, 0);
      if (hideMode !== gs.mode || hideF !== B.fort) { restoreHide(); hideMode = gs.mode; hideF = B.fort; computeHide(B, c); }
      hideList.forEach(o => o.visible = false);
    } else {
      if (hideMode) { restoreHide(); hideMode = ''; hideF = -1; }
      const GC = SK.GC;
      if (!fc.free && GC) { c.position.set(0, GC.y, GC.z); c.rotation.set(GC.rx, 0, 0); }
      else { const cp = Math.cos(fc.pitch); c.position.set(fc.tx + Math.sin(fc.yaw) * cp * fc.dist, fc.ty + Math.sin(fc.pitch) * fc.dist, Math.cos(fc.yaw) * cp * fc.dist); c.lookAt(fc.tx, fc.ty, 0); }
    }
  };
  function startWorld(m) {
    if (started) return;
    if (!window.SKM) { setInfo('ОШИБКА: у тебя старый index.html (нет сетевого режима v' + VERSION + '). Замени файлы из одного архива.'); return; }
    started = true;
    try { SKM.start(m); } catch (e) { started = false; console.error(e); setInfo('Не удалось собрать мир: ' + e.message); return; }
    gB = SK.BOTS.find(b => b.fid === m.fid) || null;
    if (!gB) { setInfo('Не найдена твоя база в мире. Проверь, что у обоих одинаковые файлы игры.'); return; }
    gmode('god'); setInfo(''); gui.info.style.display = 'none';
  }
  function buildOverlay() {
    ['menu', 'msg', 'port', 'hudx', 'ic_bMount', 'ic_bFlip', 'ic_bMenu'].forEach(i => { const e = $$(i); if (e) e.style.display = 'none'; });
    const ov = el('div', 'position:fixed;inset:0;z-index:2;' + FONT);
    gui.info = el('div', 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:#000a;padding:8px 14px;border:1px solid #6b4a2a;max-width:560px;text-align:center;white-space:pre-line;', 'Подключение…');
    gui.pick = el('div', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#14110e;border:2px solid #6b4a2a;padding:16px;min-width:300px;text-align:center;display:none;z-index:5;');
    gui.stat = el('div', 'position:absolute;left:8px;bottom:6px;font:11px monospace;color:#9a8a70;background:#0008;padding:2px 6px;', '');
    ov.append(gui.info, gui.pick, gui.stat); document.body.append(ov); gui.ov = ov;
    clearInterval(statT); statT = setInterval(statTick, 1500);
    panel.style.display = 'none'; btn.style.display = 'none';
    const cmd = c => () => send({ t: 'cmd', c });
    const H = { bGun: () => gmode('gun'), bMg: () => gmode('mg'), bExit: () => gmode('god'), bDown: cmd('lower'), bUp: cmd('up'), bUpg: cmd('upg'), bCraft: cmd('craft'), bRepair: cmd('repair'), bFort: cmd('fort'), bWh: cmd('wh'), bBuild: cmd('build') };
    for (const id in H) { const b = $$(id); if (b) { b.disabled = false; b.onclick = H[id]; } }
    const KEY = { Digit1: 'bGun', Digit2: 'bMg', Digit3: 'bDown', Digit4: 'bUp', Digit5: 'bCraft', Digit6: 'bRepair', Digit7: 'bFort', Digit8: 'bWh', Digit9: 'bUpg', KeyB: 'bBuild', Escape: 'bExit' };
    addEventListener('keydown', e => {
      if (role !== 'guest' || e.repeat) return;
      if (e.code === 'KeyM' || e.code === 'KeyF') { e.stopImmediatePropagation(); e.preventDefault(); return; }   // кнопки хоста (место и сторона пушки) гостю не нужны
      const id = KEY[e.code]; if (id) { e.stopImmediatePropagation(); e.preventDefault(); const b = $$('ic_' + id) || $$(id); if (!b.disabled && b.style.display !== 'none') H[id](); }
    }, true);
    let drag = 0, lx = 0, ly = 0;
    ov.addEventListener('contextmenu', e => e.preventDefault());
    ov.addEventListener('mousedown', e => {
      if (e.target && e.target.closest && e.target.closest('button,textarea,input,select')) return;
      if (gs.mode !== 'god') {
        if (document.pointerLockElement !== ov) { ov.requestPointerLock(); return; }
        if (e.button === 0) { if (gs.mode === 'mg') { gs.fire = true; sendIn(); } else send({ t: 'shoot', m: gs.mode, yaw: gs.yaw, pitch: gs.pitch }); }
      } else { freeCam(); drag = e.button === 2 ? 2 : 1; lx = e.clientX; ly = e.clientY; }
    });
    addEventListener('mouseup', () => { drag = 0; if (gs.fire) { gs.fire = false; sendIn(); } });
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== ov && gs.fire) { gs.fire = false; sendIn(); } });
    addEventListener('mousemove', e => {
      if (role !== 'guest') return;
      if (gs.mode !== 'god') {
        if (document.pointerLockElement !== ov) return;
        const sl = $$(gs.mode === 'gun' ? 'gs3' : 'ms3'), k = (.3 + (sl ? +sl.value : 50) / 50) * (gs.mode === 'gun' ? .0016 : .0022);
        const R = RNG[gs.mode]; gs.yaw = Math.max(-R.y, Math.min(R.y, gs.yaw - e.movementX * k)); gs.pitch = Math.max(R.p0, Math.min(R.p1, gs.pitch - e.movementY * k)); sendIn(); return;
      }
      if (!drag) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (drag === 1) { fc.yaw = Math.max(-1.3, Math.min(1.3, fc.yaw - dx * .005)); fc.pitch = Math.max(.02, Math.min(1.4, fc.pitch + dy * .005)); }
      else { fc.tx = Math.max(-90, Math.min(90, fc.tx - dx * .15 * fc.dist / 100)); fc.ty = Math.max(0, Math.min(60, fc.ty + dy * .1)); }
    });
    ov.addEventListener('wheel', e => { if (gs.mode !== 'god') return; freeCam(); fc.dist = Math.max(20, Math.min(220, fc.dist * (e.deltaY > 0 ? 1.08 : .93))); e.preventDefault(); }, { passive: false });
    setInterval(() => { if (role === 'guest') sendIn(); }, 200);
    gmode('god');
  }
  function onGuestData(m) {
    if (!m) return;
    lastPong = performance.now();
    if (m.t === 'w') { snapN++; if (window.SKM && SKM.on) SKM.apply(m); return; }
    if (m.t === 'pong') { if (m.ts) rtt = performance.now() - m.ts; return; }
    if (m.t === 'init') { startWorld(m); return; }
    if (m.t === 'slots') {
      const p = gui.pick; p.innerHTML = '<div style="margin-bottom:8px"><b>Кого заменить?</b></div>';
      if (m.taken) { p.style.display = 'none'; return; }
      p.style.display = 'block';
      if (!m.list.length) p.append(el('div', 'color:#e88;', 'Хост ещё не добавил ботов в лобби.'));
      m.list.forEach(o => { const b = el('button', 'display:block;width:100%;margin:5px 0;padding:8px;background:#2a2622;color:#e8dcc4;border:1px solid #6b4a2a;cursor:pointer;font:inherit;', o.n + ' (команда ' + o.team + ')'); b.onclick = () => { send({ t: 'pick', i: o.i }); p.style.display = 'none'; }; p.append(b); });
      const r = el('button', 'margin-top:6px;padding:6px 10px;background:none;color:#9a8a70;border:1px solid #444;cursor:pointer;font:inherit;', 'Обновить список'); r.onclick = () => send({ t: 'slots?' }); p.append(r);
    } else if (m.t === 'ver') { if (m.v !== VERSION) { gui.warn = 'ВЕРСИИ МОДА РАЗНЫЕ: у хоста ' + m.v + ', у тебя ' + VERSION + '. Обнови файлы.'; SK.toast(gui.warn); } else gui.warn = '';
    } else if (m.t === 'picked') { setInfo('Ты играешь за: ' + m.n); gui.pick.style.display = 'none'; if (m.gc) hostGC = m.gc; fc.free = false; }
    else if (m.t === 'st') {
      const sq = { home: 'в базе', down: 'спускается', ground: 'внизу', up: 'поднимается' }[m.sq] || m.sq;
      gui.info.textContent = m.over ? 'ИГРА ОКОНЧЕНА' : (m.alive ? '' : 'Твоя база пала'); gui.info.style.display = gui.info.textContent ? '' : 'none';
      $$('pstat').innerHTML = '<b>' + m.n + '</b> <b>Металл ' + m.metal + '</b> <b>Снаряды ' + m.shells + '</b> <b>База ' + m.hp + '%</b> <span style="opacity:.7">укр. ' + m.fort + '/3 · склад ' + m.wh + '/3</span> <b>Отряд ' + sq + (m.lvl ? ' (спецназ)' : '') + '</b> <b>Пушка: ' + (m.built ? (m.fireT > 0 ? 'перезарядка ' + m.fireT.toFixed(1) : 'готова') : (m.bt > 0 ? 'строится' : 'нет')) + '</b>';
      $$('hud').innerHTML = m.others.map(o => o.n + ': ' + o.hp + '%').join('<br>');
      const d = (id, v) => { const b = $$('ic_' + id); if (b) b.disabled = !!v; const o = $$(id); if (o) o.disabled = !!v; };
      d('bGun', !m.built); d('bMg', 0); d('bDown', m.sq !== 'home' || m.cool > 0); d('bUp', m.sq !== 'ground'); d('bBuild', m.built || m.bt > 0 || m.metal < 100);
      d('bCraft', !m.built || m.metal < 10); d('bRepair', m.hp >= 100 || m.metal < 60); d('bFort', m.fort >= 3 || m.metal < 70); d('bWh', m.wh >= 3 || m.metal < 80); d('bUpg', m.lvl || m.metal < 50);
      ['bGun', 'bMg'].forEach(id => { const b = $$('ic_' + id); if (b) b.classList.toggle('on', gs.mode === (id === 'bGun' ? 'gun' : 'mg')); });
      if ($$('ic_bExit')) $$('ic_bExit').style.display = gs.mode === 'god' ? 'none' : '';
      if (m.over && gs.mode !== 'god') gmode('god');
    }
  }
})();
