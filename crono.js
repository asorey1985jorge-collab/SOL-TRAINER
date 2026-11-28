/* Cronómetro de descanso del alumno.
   - Cuenta con la hora de fin (no con "segundos restantes"), así sigue bien aunque el celular bloquee la pantalla,
     se cambie de app o se recargue la página (queda guardado en este celular).
   - Sugiere el descanso del ejercicio: el que cargó el profe en la rutina, o uno según las repeticiones.
   - Al terminar: sonido + vibración (Android) + aviso del celular si la app quedó en segundo plano.
   - Lleva la cuenta de series hechas de cada ejercicio durante el día. */
(function(){
  const KEY = "st-crono", KEY_SERIES = "st-crono-series", KEY_ULT = "st-crono-ult";
  const RAPIDOS = [30, 45, 60, 90, 120, 180];
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; };
  const leer = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; } };
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const mmss = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
  const corto = s => s % 60 === 0 && s >= 60 ? `${s/60} min` : s > 60 ? mmss(s) : `${s} s`;

  /* "90", "90s", "90 seg", "1:30", "2 min", "1.5 min" → segundos */
  function aSegundos(v){
    const t = String(v ?? "").trim().toLowerCase().replace(",", ".");
    if (!t) return null;
    let m = t.match(/^(\d+):(\d{1,2})$/); if (m) return +m[1]*60 + +m[2];
    m = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutos?|')$/); if (m) return Math.round(+m[1]*60);
    m = t.match(/^(\d+)\s*(s|seg|segs|segundos?|")?$/); if (m) return +m[1];
    return null;
  }
  /* Sugerencia según el tipo de serie: pocas reps (fuerza) = más descanso; muchas reps = menos. */
  function sugerido(x){
    const p = aSegundos(x && x.descanso); if (p) return { s: Math.min(p, 600), deProfe: true };
    const reps = String((x && x.reps) || "").toLowerCase();
    if (/seg|min|"|'/.test(reps)) return { s: 45, deProfe: false };
    const n = parseInt(reps, 10);
    if (!n) return { s: leer(KEY_ULT, 60), deProfe: false };
    return { s: n <= 5 ? 180 : n <= 8 ? 120 : n <= 12 ? 90 : 60, deProfe: false };
  }

  /* ---------- series hechas (se reinician cada día) ---------- */
  function series(){ const v = leer(KEY_SERIES, {}); return v.dia === hoy() ? v : { dia: hoy(), c: {} }; }
  const hechas = k => series().c[k] || 0;
  function sumarSerie(k){ const v = series(); v.c[k] = (v.c[k] || 0) + 1; guardar(KEY_SERIES, v); return v.c[k]; }
  function reiniciarSerie(k){ const v = series(); delete v.c[k]; guardar(KEY_SERIES, v); }

  /* ---------- estado ---------- */
  // st: { fin (ms), total (s), pausa (s restantes si está en pausa), etiqueta, sub, k }
  let st = leer(KEY, null), abierto = false, tic = null, wake = null, audio = null, ultimoBip = null, visible = false;
  const restante = () => !st ? 0 : st.pausa != null ? st.pausa : (st.fin - Date.now()) / 1000;
  const corriendo = () => !!st && st.pausa == null && restante() > 0;

  function sonido(tipo){
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const notas = tipo === "fin" ? [[880,0,.18],[880,.25,.18],[1320,.5,.5]] : tipo === "ok" ? [[660,0,.06]] : [[740,0,.09]];
      notas.forEach(([f, t, d]) => {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + t;
        o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(tipo === "fin" ? .6 : .35, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
        o.start(t0); o.stop(t0 + d + .05);
      });
    } catch {}
  }
  const vibrar = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  async function pantallaPrendida(si){
    try {
      if (si && !wake && navigator.wakeLock && document.visibilityState === "visible") { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); }
      if (!si && wake) { await wake.release(); wake = null; }
    } catch { wake = null; }
  }
  async function avisoCelular(){
    try {
      if (!("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) reg.showNotification("⏱ ¡Terminó el descanso!", { body: st && st.etiqueta ? `Seguí con ${st.etiqueta}` : "A la próxima serie 💪", tag: "crono", renotify: true, vibrate: [400,150,400,150,600], icon: "icons/icon-192.png" });
    } catch {}
  }

  function empezar(seg, info){
    seg = Math.max(5, Math.min(600, Math.round(seg)));
    st = { fin: Date.now() + seg*1000, total: seg, pausa: null, etiqueta: info && info.etiqueta || "", sub: info && info.sub || "", k: info && info.k || null };
    guardar(KEY, st); guardar(KEY_ULT, seg); ultimoBip = null;
    sonido("ok"); vibrar(40); pantallaPrendida(true); arrancarTic(); pintar();
  }
  function terminar(natural){
    if (natural) { sonido("fin"); vibrar([400,150,400,150,600]); if (document.visibilityState !== "visible") avisoCelular(); }
    const ult = st; st = null; guardar(KEY, null); pantallaPrendida(false); parar();
    if (natural) { abierto = true; pintar(ult); } else pintar();
  }
  function sumar(d){
    if (!st) return;
    if (st.pausa != null) st.pausa = Math.max(1, st.pausa + d); else st.fin = Math.max(Date.now() + 1000, st.fin + d*1000);
    st.total = Math.max(st.total, Math.ceil(restante())); guardar(KEY, st); pintar();
  }
  function pausar(){
    if (!st) return;
    if (st.pausa == null) { st.pausa = restante(); pantallaPrendida(false); }
    else { st.fin = Date.now() + st.pausa*1000; st.pausa = null; pantallaPrendida(true); }
    guardar(KEY, st); pintar();
  }
  function arrancarTic(){ if (!tic) tic = setInterval(paso, 250); }
  function parar(){ clearInterval(tic); tic = null; }
  function paso(){
    if (!st) return parar();
    const r = restante();
    if (st.pausa == null && r <= 0) return terminar(true);
    const s = Math.ceil(r);
    if (st.pausa == null && s <= 3 && s !== ultimoBip) { ultimoBip = s; sonido("bip"); vibrar(60); }
    pintarTiempo();
  }

  /* ---------- pantalla ---------- */
  let root;
  function asegurarRoot(){
    if (root) return root;
    root = document.createElement("div"); root.id = "crono-root"; document.body.appendChild(root);
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-cr]"); if (!b) { if (e.target.classList.contains("cr-bg")) { abierto = false; pintar(); } return; }
      const a = b.dataset.cr;
      if (a === "abrir") { abierto = true; pintar(); }
      else if (a === "cerrar") { abierto = false; pintar(); }
      else if (a === "t") empezar(+b.dataset.s, st ? { etiqueta: st.etiqueta, sub: st.sub, k: st.k } : null);
      else if (a === "mas") sumar(15);
      else if (a === "menos") sumar(-15);
      else if (a === "pausa") pausar();
      else if (a === "fin") terminar(false);
    });
    return root;
  }
  const R = 92, LARGO = 2 * Math.PI * R;
  function pintarTiempo(){
    if (!root) return;
    const r = restante(), frac = st ? Math.max(0, Math.min(1, r / st.total)) : 1, txt = st ? mmss(r) : "";
    const t = root.querySelector(".cr-time"); if (t && st) t.textContent = txt;
    const arc = root.querySelector(".cr-arc"); if (arc) arc.style.strokeDashoffset = String(LARGO * (1 - frac));
    const fab = root.querySelector(".cr-fab .cr-fab-t"); if (fab) fab.textContent = st ? txt : "Descanso";
    root.querySelector(".cr-fab")?.classList.toggle("activo", !!st);
    root.querySelector(".cr-panel")?.classList.toggle("ultimos", corriendo() && r <= 3.2);
  }
  function pintar(fin){
    if (!visible) { if (root) root.innerHTML = ""; return; }
    asegurarRoot();
    const ult = leer(KEY_ULT, 60);
    const chips = RAPIDOS.map(s => `<button class="cr-chip${st && st.total === s ? " on" : ""}" data-cr="t" data-s="${s}">${corto(s)}</button>`).join("");
    const fab = `<button class="cr-fab" data-cr="abrir" aria-label="Cronómetro de descanso"><span aria-hidden="true">⏱</span><span class="cr-fab-t num">Descanso</span></button>`;
    if (!abierto) { root.innerHTML = fab; pintarTiempo(); return; }
    const cab = st ? `<div class="cr-et">${st.etiqueta ? `Descanso · <b>${h(st.etiqueta)}</b>` : "Descanso"}</div>${st.sub ? `<div class="cr-sub">${h(st.sub)}</div>` : ""}`
      : fin ? `<div class="cr-et"><b>¡Terminó el descanso!</b></div><div class="cr-sub">${fin.etiqueta ? `Seguí con ${h(fin.etiqueta)} 💪` : "A la próxima serie 💪"}</div>`
      : `<div class="cr-et">Cronómetro de descanso</div><div class="cr-sub">Elegí cuánto querés descansar, o tocá ⏱ en un ejercicio de tu rutina.</div>`;
    const centro = st ? `<div class="cr-time num">${mmss(restante())}</div><div class="cr-de">${st.pausa != null ? "En pausa" : `de ${corto(st.total)}`}</div>`
      : `<div class="cr-time num${fin ? " listo" : ""}">${fin ? "¡Ya!" : mmss(ult)}</div><div class="cr-de">${fin ? "" : "tocá un tiempo"}</div>`;
    const ctrl = st ? `<div class="cr-ctrl"><button class="btn cr-b" data-cr="menos" aria-label="Restar 15 segundos">−15 s</button><button class="btn primary cr-b" data-cr="pausa">${st.pausa != null ? "Seguir" : "Pausa"}</button><button class="btn cr-b" data-cr="mas" aria-label="Sumar 15 segundos">+15 s</button></div>
        <div class="cr-ctrl"><button class="btn cr-b" data-cr="fin">Terminar ya</button><button class="btn cr-b" data-cr="cerrar">Ocultar</button></div>`
      : `<div class="cr-ctrl"><button class="btn primary cr-b" data-cr="t" data-s="${ult}">Empezar ${corto(ult)}</button><button class="btn cr-b" data-cr="cerrar">Cerrar</button></div>`;
    root.innerHTML = `${fab}<div class="cr-bg"><div class="cr-panel${fin ? " fin" : ""}" role="dialog" aria-label="Cronómetro de descanso">
      ${cab}
      <div class="cr-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle class="cr-track" cx="100" cy="100" r="${R}"/><circle class="cr-arc" cx="100" cy="100" r="${R}" stroke-dasharray="${LARGO}" stroke-dashoffset="0"/></svg><div class="cr-c">${centro}</div></div>
      <div class="cr-chips">${chips}</div>
      ${ctrl}</div></div>`;
    pintarTiempo();
  }

  /* ---------- botón ⏱ de cada ejercicio en la rutina del alumno ---------- */
  function boton(x, k){
    const sg = sugerido(x), n = parseInt(x && x.series, 10) || 0, hc = hechas(k);
    const estado = n && hc >= n ? `<span class="cr-ok">✓ ${n}/${n}</span>` : hc ? `<span>Serie ${hc}${n ? `/${n}` : ""} ✓</span>` : "";
    return `<button class="cr-ex${n && hc >= n ? " todo" : ""}" data-crono="${h(k)}" data-s="${sg.s}" data-n="${n}" data-nombre="${h(x && x.nombre)}" aria-label="Terminé una serie de ${h(x && x.nombre)}: descansar ${corto(sg.s)}">
      <span class="cr-ex-t">⏱ ${corto(sg.s)}</span>${estado}</button>`;
  }
  function actualizarBoton(btn){
    const k = btn.dataset.crono, n = +btn.dataset.n, hc = hechas(k), s = +btn.dataset.s;
    btn.classList.toggle("todo", !!(n && hc >= n));
    btn.innerHTML = `<span class="cr-ex-t">⏱ ${corto(s)}</span>${n && hc >= n ? `<span class="cr-ok">✓ ${n}/${n}</span>` : hc ? `<span>Serie ${hc}${n ? `/${n}` : ""} ✓</span>` : ""}`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-crono]"); if (!b) return;
    e.preventDefault();
    const k = b.dataset.crono, n = +b.dataset.n, nombre = b.dataset.nombre;
    if (n && hechas(k) >= n) { reiniciarSerie(k); actualizarBoton(b); if (typeof toast === "function") toast(`${nombre}: series en cero`); return; }
    const hc = sumarSerie(k); actualizarBoton(b);
    const sub = n ? (hc >= n ? `¡Terminaste las ${n} series! Descansá y pasá al próximo ejercicio.` : `Hiciste la serie ${hc} de ${n}`) : `Serie ${hc} hecha`;
    abierto = true; empezar(+b.dataset.s, { etiqueta: nombre, sub, k });
  });

  /* Al volver a la app (o desbloquear la pantalla) se pone al día al instante. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (st && st.pausa == null && restante() <= 0) terminar(true);
    else if (corriendo()) { pantallaPrendida(true); arrancarTic(); pintarTiempo(); }
  });
  if (st && st.pausa == null && restante() <= 0) { st = null; guardar(KEY, null); }
  else if (st) arrancarTic();

  window.Crono = {
    mostrar(si){ si = !!si; if (si === visible) return; visible = si; if (!si) abierto = false; pintar(); },
    boton, sugerido, aSegundos, corto
  };
})();
