(() => {
const CFG = window.SOL_CONFIG || {};
const PLANES = [["3 veces por semana","precio_3"],["4 veces por semana","precio_4"],["5 veces por semana","precio_5"]];
const GYM = CFG.GYM_NOMBRE || "Sol Trainer";
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const TODAY = iso(new Date());
const addMonths = (s, n) => { const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+n); const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); d.setDate(Math.min(day,last)); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const money = n => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n||0);
const fdate = s => s ? parse(s).toLocaleDateString("es-AR",{day:"numeric",month:"short"}) : "—";
const fdateLong = s => s ? parse(s).toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"}) : "";
const initials = n => (n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("");
const RECOVERY = /type=recovery/.test(location.hash);
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, "");
$("#today").textContent = fdateLong(TODAY);

if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("TU-PROYECTO")) {
  $("#view").innerHTML = `<div class="notice err">Falta configurar la conexión con la base de datos (archivo config.js).</div>`;
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const S = { medic:[], cargas:[], biblio:[], progEj:{}, config:{}, role:null, alumnos:new Map(), pagos:[], asist:new Map(), filter:"todos", q:"", draft:null, editRutina:false, asistFecha:null, ficha:null };

function estado(a){
  if (a.activo === false) return {k:"off", t:"Inactivo", d:null};
  if (!a.vence) return {k:"bad", t:"Sin pagos", d:null};
  const d = daysBetween(TODAY, a.vence);
  if (d < 0) return {k:"bad", t:`Vencido hace ${-d} d`, d};
  if (d <= 5) return {k:"warn", t: d===0 ? "Vence hoy" : `Vence en ${d} d`, d};
  return {k:"ok", t:"Al día", d};
}
const activos = () => [...S.alumnos.values()].filter(a => a.activo !== false).sort((x,y)=>x.nombre.localeCompare(y.nombre,"es"));

function toast(msg){ const t = document.createElement("div"); t.className="toast"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
async function copy(text){ try{ await navigator.clipboard.writeText(text); toast("Copiado"); }catch{ openSheet("Copiá el texto", `<textarea id="cp" style="min-height:180px">${esc(text)}</textarea>`); setTimeout(()=>{const c=$("#cp"); c&&c.select();},50); } }
function waLink(tel, text){ let d=(tel||"").replace(/\D/g,""); if(!d) return null; if(!d.startsWith("54")) d="549"+d.replace(/^0/,""); return `https://wa.me/${d}?text=${encodeURIComponent(text)}`; }
const errMsg = e => (e && (e.message || e.error_description)) || "error desconocido";

async function run(fn, okMsg){
  try { const r = await fn(); if (r && r.error) throw r.error; if (okMsg) toast(okMsg); await cargarAdmin(); return true; }
  catch(e){ toast("No se pudo guardar: " + errMsg(e)); return false; }
}

/* ---------- Sheet ---------- */
function openSheet(title, body, onMount){
  $("#sheet-root").innerHTML = `<div class="sheet-bg" id="sbg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h3>${esc(title)}</h3><button class="btn sm" id="sclose">Cerrar</button></div>${body}</div></div>`;
  $("#sclose").onclick = closeSheet;
  $("#sbg").addEventListener("click", e => { if (e.target.id==="sbg") closeSheet(); });
  onMount && onMount();
}
function closeSheet(){ $("#sheet-root").innerHTML=""; }
document.addEventListener("keydown", e => { if (e.key==="Escape") closeSheet(); });

/* =================== Archivos =================== */
const TIPOS = { dieta:"Dieta", rutina:"Rutina", otro:"Otro" };
const kb = n => n > 1048576 ? (n/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(n/1024))+" KB";
function archivosLista(lista, admin){
  if (!lista.length) return `<div class="empty">${admin ? "Todavía no subiste archivos para este alumno." : "Tu profe todavía no te subió archivos."}</div>`;
  return lista.map(f => `<div class="row"><div class="avatar" style="font-size:12px">${f.tipo==="dieta"?"DIE":f.tipo==="rutina"?"RUT":"DOC"}</div><div class="main"><div class="name">${esc(f.nombre)}</div><div class="muted small">${!admin && daysBetween(f.created_at.slice(0,10), TODAY) <= 7 ? '<span class="pill ok">Nuevo</span> ' : ""}${esc(TIPOS[f.tipo]||"Otro")} · ${fdate(f.created_at.slice(0,10))}${f.tamano?` · ${kb(f.tamano)}`:""}</div></div><div class="actions"><button class="btn sm" data-abrir="${esc(f.path)}">Abrir</button>${admin?`<button class="btn sm danger" data-act="arch-del" data-id="${esc(f.id)}" aria-label="Borrar archivo">✕</button>`:""}</div></div>`).join("");
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-abrir]"); if (!b) return;
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("archivos").createSignedUrl(b.dataset.abrir, 3600);
  if (error || !data) { if (w) w.close(); return toast("No se pudo abrir el archivo"); }
  if (w) w.location.href = data.signedUrl; else location.href = data.signedUrl;
});
async function subirArchivo(alumnoId){
  const input = $("#arch-file"), tipo = $("#arch-tipo").value;
  const files = [...(input.files||[])]; if (!files.length) return toast("Elegí un archivo primero");
  const btn = $("#arch-subir"); btn.disabled = true; btn.textContent = "Subiendo…";
  let ok = 0;
  for (const f of files) {
    if (f.size > 20*1048576) { toast(`${f.name} pesa más de 20 MB`); continue; }
    const limpio = f.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9._-]+/g,"_");
    const path = `${alumnoId}/${Date.now()}-${limpio}`;
    const up = await sb.storage.from("archivos").upload(path, f, { contentType: f.type || undefined });
    if (up.error) { toast("No se pudo subir: " + errMsg(up.error)); continue; }
    const ins = await sb.from("archivos").insert({ alumno_id:alumnoId, tipo, nombre:f.name, path, tamano:f.size }).select("id").single();
    if (!ins.error) sb.functions.invoke("avisos-cuota", { body:{ archivo_id: ins.data.id } }).catch(() => {}); // notificación al alumno
    if (ins.error) { await sb.storage.from("archivos").remove([path]); toast("No se pudo guardar: " + errMsg(ins.error)); continue; }
    ok++;
  }
  if (ok) toast((ok===1 ? "Archivo subido" : `${ok} archivos subidos`) + ". Le avisamos al alumno.");
  await cargarAdmin();
}

/* =================== LOGIN =================== */
function vLogin(modo = "entrar", aviso = ""){
  $("#top").hidden = true; $("#tabs").hidden = true;
  const titulos = { entrar:"Ingresar", crear:"Crear cuenta", olvido:"Recuperar contraseña", nueva:"Elegí una contraseña nueva" };
  $("#view").innerHTML = `<form class="login card" id="flog">
    <div class="brand">Sol <span>Trainer</span></div>
    <div class="sub">${esc(titulos[modo])}</div>
    ${aviso ? `<div class="notice">${aviso}</div>` : ""}
    ${modo!=="nueva" ? `<label class="f">Email<input id="l-email" type="email" autocomplete="email" required></label>` : ""}
    ${modo!=="olvido" ? `<label class="f">Contraseña<input id="l-pass" type="password" minlength="6" autocomplete="${modo==="entrar"?"current-password":"new-password"}" required></label>` : ""}
    <button class="btn primary" type="submit" style="justify-content:center">${esc(titulos[modo])}</button>
    <div class="small muted" style="text-align:center;display:flex;flex-direction:column;gap:6px">
      ${modo==="entrar" ? `<span>¿Primera vez? <button type="button" class="linkbtn" data-m="crear">Crear cuenta</button></span><button type="button" class="linkbtn" data-m="olvido">Me olvidé la contraseña</button>` : modo!=="nueva" ? `<button type="button" class="linkbtn" data-m="entrar">Volver a ingresar</button>` : ""}
    </div>
    ${modo==="crear" ? `<p class="small muted" style="margin:0">Usá el mismo email que le diste al gimnasio, así ves tu rutina y tu cuota.</p>` : ""}
  </form>`;
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => vLogin(b.dataset.m));
  $("#flog").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    const email = $("#l-email")?.value.trim(), password = $("#l-pass")?.value;
    let r;
    if (modo==="entrar") r = await sb.auth.signInWithPassword({ email, password });
    else if (modo==="crear") r = await sb.auth.signUp({ email, password, options:{ emailRedirectTo: APP_URL } });
    else if (modo==="olvido") r = await sb.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
    else r = await sb.auth.updateUser({ password });
    btn.disabled = false;
    if (r.error) {
      const m = /Invalid login/i.test(r.error.message) ? "Email o contraseña incorrectos." : /confirm/i.test(r.error.message) ? "Todavía no confirmaste tu email. Revisá tu correo (también en spam)." : r.error.message;
      return vLogin(modo, esc(m));
    }
    if (modo==="crear" && !r.data.session) return vLogin("entrar", "Te mandamos un email para confirmar la cuenta. Tocá el link y después ingresá acá.");
    if (modo==="olvido") return vLogin("entrar", "Si ese email tiene cuenta, te llegó un link para elegir una contraseña nueva.");
    if (modo==="nueva") toast("Contraseña actualizada");
    iniciar();
  };
}

/* =================== Datos para transferir =================== */
async function cargarConfig(){ const { data } = await sb.from("config").select("*").eq("id",1).maybeSingle(); S.config = data || {}; }
function comoPagar(f){
  const c = S.config || {};
  if (!c.alias && !c.cvu) return "";
  const aviso = c.whatsapp ? waLink(c.whatsapp, `Hola! Soy ${f.nombre}. Te transferí la cuota, te adjunto el comprobante. Cuota de ${GYM}.`) : null;
  return `<div class="card stack" style="margin-top:10px"><b>Cómo pagar tu cuota</b>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div style="min-width:0"><div class="small muted">Alias para transferir</div><div style="font-family:var(--font-display);font-size:24px;font-weight:700;word-break:break-all">${esc(c.alias||"")}</div>${c.banco?`<div class="small"><b>${esc(c.banco)}</b></div>`:""}${c.titular?`<div class="small muted">A nombre de ${esc(c.titular)}</div>`:""}${c.cvu?`<div class="small muted num">CVU/CBU ${esc(c.cvu)}</div>`:""}</div>
    ${c.alias?`<button class="btn" id="copiar-alias">Copiar alias</button>`:""}</div>
    ${c.nota?`<div class="small">${esc(c.nota)}</div>`:""}
    ${c.whatsapp?`<div class="notice" style="margin-top:0"><span><b>Importante:</b> al pagar, enviá el comprobante por WhatsApp al <b class="num">${esc(c.whatsapp)}</b>.</span></div>`:""}
    ${aviso?`<a class="btn primary" href="${esc(aviso)}" target="_blank" rel="noopener" style="justify-content:center">Enviar comprobante por WhatsApp</a>`:""}
    <span class="small muted">Cuando el profe confirma tu pago, tu cuota se actualiza acá.</span></div>`;
}

/* =================== VISTA DEL ALUMNO =================== */
async function cargarAlumno(){
  const [{ data, error }, arch] = await Promise.all([sb.rpc("mi_ficha"), sb.from("archivos").select("*").order("created_at",{ascending:false}), cargarConfig(), cargarExtras()]);
  S.misArchivos = arch.data || [];
  if (error) { $("#view").innerHTML = `<div class="notice err">No pudimos cargar tus datos: ${esc(errMsg(error))}</div>`; return; }
  S.ficha = data; renderAlumno();
}
function renderAlumno(){
  $("#top").hidden = false; $("#tabs").hidden = true;
  const f = S.ficha;
  if (!f) { $("#view").innerHTML = `<div class="card" style="margin-top:16px"><h3>Tu cuenta está lista</h3><p>Todavía no está asociada a tu ficha del gimnasio. Pedile al profe que cargue este email en tu ficha:</p><p><b>${esc(S.email)}</b></p><button class="btn" id="reint">Ya me agregó, volver a cargar</button></div>`; $("#reint").onclick = cargarAlumno; return; }
  const e = estado(f);
  const big = e.d==null ? "—" : e.d<0 ? `${-e.d}` : `${e.d}`;
  const label = e.d==null ? "Todavía no hay pagos registrados" : e.d<0 ? `días de atraso · venció el ${fdate(f.vence)}` : e.d===0 ? "Tu cuota vence hoy" : `días hasta tu próximo pago (${fdate(f.vence)})`;
  const dias = (f.rutina && f.rutina.dias) || [];
  const alerta = e.k==="bad" && e.d!=null ? `<div class="notice err"><span><b>Tu cuota está vencida.</b> Acercate al gimnasio para regularizarla.</span></div>`
    : e.k==="warn" ? `<div class="notice"><span><b>${e.d===0 ? "Tu cuota vence hoy." : `Tu cuota vence en ${e.d} ${e.d===1?"día":"días"}.`}</b> Podés abonar en el gym o por transferencia.</span></div>` : "";
  const cumple = esCumple(f.nacimiento) ? `<div class="notice" style="font-size:16px"><span>🎉 <b>¡Feliz cumpleaños, ${esc((f.nombre||"").split(" ")[0])}!</b> Todo el equipo de ${esc(GYM)} te desea un gran día.</span></div>` : "";
  $("#view").innerHTML = `${cumple}${alerta}<div id="push-box" style="margin-top:10px"></div>
  <h2>Hola, ${esc((f.nombre||"").split(" ")[0])}</h2>
  <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><div class="hero-days ${e.k}">${big}</div><div class="muted">${esc(label)}</div></div>
    <div style="text-align:right"><span class="pill ${e.k}">${esc(e.t)}</span><div class="small muted" style="margin-top:6px">${esc(f.plan||"")}<br>Cuota ${money(f.cuota)}</div></div>
  </div>
  ${comoPagar(f)}
  <div class="band"><div class="cell"><small>Viniste en los últimos 30 días</small><b>${f.asistencias_30 ?? 0} veces</b></div></div>
  <h2>Tu rutina</h2>
  ${dias.length ? rutinaView({rutina:f.rutina}) + (f.rutina_actualizada ? `<p class="small muted">Actualizada el ${fdate(f.rutina_actualizada)}</p>` : "") : `<div class="empty card">Tu profe todavía no cargó tu rutina.</div>`}
  <h2>Tu progreso</h2>
  ${f.id ? progresoView(f.id, false) : ""}
  <h2>Tus archivos</h2>
  <div class="list">${archivosLista(S.misArchivos||[], false)}</div>
  ${(f.ultimos_pagos||[]).length ? `<h2>Tus pagos</h2><div class="list">${f.ultimos_pagos.map(p=>`<div class="row"><div class="main"><div class="name num">${money(p.monto)}</div><div class="muted small">${fdate(p.fecha)} · cubre hasta ${fdate(p.hasta)}</div></div></div>`).join("")}</div>` : ""}`;
  pintarPush();
  const ca = $("#copiar-alias"); if (ca) ca.onclick = () => copy(S.config.alias);
}

/* =================== ADMIN: datos =================== */
async function cargarExtras(){
  const [m, c, b] = await Promise.all([
    sb.from("mediciones").select("*").order("fecha"),
    sb.from("cargas").select("*").order("fecha"),
    sb.from("ejercicios").select("*")
  ]);
  S.medic = m.data || []; S.cargas = c.data || []; S.biblio = b.data || [];
}
async function cargarAdmin(){
  const desde = iso(new Date(Date.now()-120*86400000));
  const [a, p, s, f] = await Promise.all([
    sb.from("alumnos").select("*"),
    sb.from("pagos").select("*").order("fecha",{ascending:false}).order("created_at",{ascending:false}).limit(1000),
    sb.from("asistencias").select("*").gte("fecha", desde),
    sb.from("archivos").select("*").order("created_at",{ascending:false}),
    cargarConfig(), cargarExtras()
  ]);
  const err = a.error || p.error || s.error || f.error;
  S.archivos = f.data || [];
  if (err) { $("#status").innerHTML = `<div class="notice err">No pudimos cargar los datos: ${esc(errMsg(err))}</div>`; return; }
  $("#status").innerHTML = "";
  S.alumnos = new Map(a.data.map(x=>[x.id,x]));
  const nom = id => (S.alumnos.get(id)||{}).nombre || "Alumno borrado";
  S.pagos = p.data.map(x=>({...x, nombre:nom(x.alumno_id)}));
  S.asist = new Map(); s.data.forEach(r => { if(!S.asist.has(r.fecha)) S.asist.set(r.fecha,{fecha:r.fecha,ids:[]}); S.asist.get(r.fecha).ids.push(r.alumno_id); });
  render();
}

/* =================== ADMIN: formularios =================== */
function alumnoForm(a){
  const n = !a; a = a || {nombre:"",email:"",telefono:"",plan:"3 veces por semana",cuota:"",notas:"",activo:true,objetivo:""};
  openSheet(n ? "Nuevo alumno" : "Editar alumno", `
  <form id="fa" class="stack">
    <label class="f">Nombre y apellido<input id="fa-nombre" required value="${esc(a.nombre)}" autocomplete="off"></label>
    <label class="f">Email del alumno (con este entra a la app)<input id="fa-email" type="email" value="${esc(a.email)}" autocomplete="off"></label>
    <div class="grid2">
      <label class="f">Teléfono (WhatsApp)<input id="fa-tel" inputmode="tel" value="${esc(a.telefono)}" placeholder="11 2345 6789"></label>
      <label class="f">Objetivo<input id="fa-obj" value="${esc(a.objetivo)}" placeholder="Hipertrofia, bajar peso…"></label>
      <label class="f">Fecha de nacimiento<input id="fa-nac" type="date" value="${esc(a.nacimiento||"")}"></label>
      <label class="f">Plan<select id="fa-plan">${[...PLANES.map(x=>x[0]), ...(a.plan && !PLANES.some(x=>x[0]===a.plan) ? [a.plan] : [])].map(pl=>`<option ${pl===a.plan?"selected":""}>${esc(pl)}</option>`).join("")}</select></label>
      <label class="f">Cuota mensual ($)<input id="fa-cuota" inputmode="numeric" value="${esc(a.cuota)}" placeholder="25000"></label>
    </div>
    ${n ? `<div class="card stack small"><label style="display:flex;gap:8px;align-items:center;font-size:15px"><input type="checkbox" id="fa-pago" style="width:auto" checked> Ya pagó la primera cuota</label>
      <div class="grid2"><label class="f">Medio de pago<select id="fa-medio"><option>Efectivo</option><option>Transferencia</option></select></label>
      <label class="f">La cuota vence el<input id="fa-vence" type="date" value="${addMonths(TODAY,1)}"></label></div>
      <span class="muted">Se registra el pago de hoy y la cuota vence en un mes. Si no pagó todavía, destildá la casilla.</span></div>` : ""}
    <label class="f">Notas privadas (lesiones, apto médico). El alumno no las ve.<textarea id="fa-notas">${esc(a.notas)}</textarea></label>
    ${n ? "" : `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="fa-activo" style="width:auto" ${a.activo!==false?"checked":""}> Alumno activo</label>`}
    <div class="actions"><button class="btn primary" type="submit">${n?"Agregar alumno":"Guardar cambios"}</button>${n?"":`<button class="btn danger" type="button" id="fa-del">Borrar alumno</button>`}</div>
  </form>`, () => {
    const precioPlan = () => { const x = PLANES.find(x=>x[0]===$("#fa-plan").value); const v = x && S.config && S.config[x[1]]; if (v) $("#fa-cuota").value = v; };
    $("#fa-plan").onchange = precioPlan;
    if (n) precioPlan();
    $("#fa").onsubmit = async e => {
      e.preventDefault();
      const data = { nombre:$("#fa-nombre").value.trim(), email:$("#fa-email").value.trim().toLowerCase()||null, telefono:$("#fa-tel").value.trim(), objetivo:$("#fa-obj").value.trim(), nacimiento:$("#fa-nac").value||null, plan:$("#fa-plan").value.trim(), cuota:Number($("#fa-cuota").value.replace(/\D/g,""))||0, notas:$("#fa-notas").value.trim() };
      if (!data.nombre) return;
      if (n) {
        const pagoYa = $("#fa-pago").checked;
        data.vence = pagoYa ? null : ($("#fa-vence").value || null);
        const { data: ins, error } = await sb.from("alumnos").insert(data).select("id").single();
        if (!error && pagoYa) {
          const r = await sb.rpc("registrar_pago", { p_alumno:ins.id, p_monto:data.cuota, p_fecha:TODAY, p_medio:$("#fa-medio").value, p_meses:1 });
          if (r.error) toast("El alumno se guardó, pero no se pudo registrar el pago: " + errMsg(r.error));
        }
        if (error) return toast("No se pudo guardar: " + (/duplicate/i.test(error.message) ? "ese email ya lo tiene otro alumno" : error.message));
        toast("Alumno agregado"); closeSheet(); await cargarAdmin(); location.hash = "alumno-" + ins.id;
      } else {
        data.activo = $("#fa-activo").checked;
        if (await run(() => sb.from("alumnos").update(data).eq("id", a.id), "Cambios guardados")) closeSheet();
      }
    };
    if (!n) $("#fa-del").onclick = () => openSheet("Borrar alumno", `<p>Se borra <b>${esc(a.nombre)}</b> con todos sus pagos y su asistencia. No se puede deshacer. Si solo dejó de venir, mejor marcalo como inactivo.</p><div class="actions"><button class="btn danger" id="del-ok">Borrar definitivamente</button></div>`, () => {
      $("#del-ok").onclick = async () => { if (await run(() => sb.from("alumnos").delete().eq("id", a.id), "Alumno borrado")) { closeSheet(); location.hash = "alumnos"; } };
    });
  });
}

function pagoForm(alumnoId){
  const lista = activos();
  if (!lista.length) { toast("Primero agregá un alumno"); return; }
  const sel = alumnoId || lista[0].id;
  openSheet("Registrar pago", `
  <form id="fp" class="stack">
    <label class="f">Alumno<select id="fp-al">${lista.map(a=>`<option value="${esc(a.id)}" ${a.id===sel?"selected":""}>${esc(a.nombre)}</option>`).join("")}</select></label>
    <div class="grid2">
      <label class="f">Meses que paga<select id="fp-meses"><option value="1">1 mes</option><option value="2">2 meses</option><option value="3">3 meses</option><option value="6">6 meses</option></select></label>
      <label class="f">Monto ($)<input id="fp-monto" inputmode="numeric"></label>
      <label class="f">Fecha de pago<input id="fp-fecha" type="date" value="${TODAY}"></label>
      <label class="f">Medio<select id="fp-medio"><option>Efectivo</option><option>Transferencia</option><option>Mercado Pago</option><option>Tarjeta</option></select></label>
    </div>
    <div class="card small" id="fp-info"></div>
    <div class="actions"><button class="btn primary" type="submit">Registrar pago</button></div>
  </form>`, () => {
    const upd = (resetMonto) => {
      const a = S.alumnos.get($("#fp-al").value); const m = Number($("#fp-meses").value); const f = $("#fp-fecha").value || TODAY;
      if (resetMonto) $("#fp-monto").value = (a.cuota||0) * m || "";
      const base = a.vence && a.vence >= f ? a.vence : f;
      $("#fp-info").innerHTML = `Cubre desde <b>${fdate(base)}</b> hasta <b>${fdate(addMonths(base,m))}</b>. ${a.vence ? `Antes estaba pago hasta ${fdate(a.vence)}.` : "Es su primer pago."}`;
    };
    $("#fp-al").onchange = () => upd(true); $("#fp-meses").onchange = () => upd(true); $("#fp-fecha").onchange = () => upd(false);
    upd(true);
    $("#fp").onsubmit = async e => {
      e.preventDefault();
      const a = S.alumnos.get($("#fp-al").value);
      const ok = await run(() => sb.rpc("registrar_pago", { p_alumno:a.id, p_monto:Number($("#fp-monto").value.replace(/\D/g,""))||0, p_fecha:$("#fp-fecha").value||TODAY, p_medio:$("#fp-medio").value, p_meses:Number($("#fp-meses").value) }), `Pago de ${a.nombre} registrado`);
      if (ok) closeSheet();
    };
  });
}

function anularPago(p){
  openSheet("Anular pago", `<p>¿Anular el pago de <b>${esc(p.nombre)}</b> por ${money(p.monto)} del ${fdate(p.fecha)}?</p><p class="muted small">Si fue su último pago, su vencimiento vuelve al ${p.vence_anterior ? fdate(p.vence_anterior) : "estado sin pagos"}.</p><div class="actions"><button class="btn danger" id="an-ok">Anular pago</button></div>`, () => {
    $("#an-ok").onclick = async () => { if (await run(() => sb.rpc("anular_pago", { p_pago:p.id }), "Pago anulado")) closeSheet(); };
  });
}

function recordatorio(a){
  const e = estado(a);
  return `Hola ${a.nombre.split(" ")[0]}! Te escribo de ${GYM}. ${e.d!=null && e.d>=0 ? `Tu cuota vence el ${fdate(a.vence)}.` : `Tu cuota está vencida${a.vence?` desde el ${fdate(a.vence)}`:""}.`} El valor es ${money(a.cuota)}. Podés abonar en el gym${S.config && S.config.alias ? ` o transferir al alias ${S.config.alias}` : " o por transferencia"}. ¡Gracias!`;
}
function invitacion(a){
  return `Hola ${a.nombre.split(" ")[0]}! Ya podés ver tu rutina y tu cuota en la app de ${GYM}: ${APP_URL}\nTocá "Crear cuenta" con este email: ${a.email}\nTip: en el celular, abrí el menú del navegador y elegí "Agregar a pantalla de inicio" para tenerla como app.`;
}

/* =================== ADMIN: vistas =================== */
function vInicio(){
  const al = activos(); const est = al.map(a=>[a,estado(a)]);
  const c = k => est.filter(([,e])=>e.k===k).length;
  const mes = TODAY.slice(0,7);
  const cobradoMes = S.pagos.filter(p=>p.fecha.startsWith(mes)).reduce((s,p)=>s+(p.monto||0),0);
  const hoy = (S.asist.get(TODAY)||{ids:[]}).ids.length;
  const cobrar = est.filter(([,e])=>e.k!=="ok").sort((x,y)=>(x[1].d??-999)-(y[1].d??-999));
  const pronto = est.filter(([,e])=>e.k==="warn").length, venc = est.filter(([,e])=>e.k==="bad").length;
  const alerta = (pronto||venc) ? `<div class="notice ${venc?"err":""}" style="cursor:pointer" data-go="alumnos" data-f="${venc?"bad":"warn"}"><span><b>Atención:</b> ${[pronto?`${pronto} ${pronto===1?"cuota vence":"cuotas vencen"} en los próximos 5 días`:"", venc?`${venc} ${venc===1?"está vencida":"están vencidas"}`:""].filter(Boolean).join(" y ")}.</span><span class="small">Ver →</span></div>` : "";
  return `${alerta}<div id="push-box" style="margin-top:10px"></div>
  <h2>Resumen</h2>
  <div class="kpis">
    <button class="kpi" data-go="alumnos" data-f="todos"><small>Alumnos activos</small><b>${al.length}</b></button>
    <button class="kpi ok" data-go="alumnos" data-f="ok"><small>Al día</small><b>${c("ok")}</b></button>
    <button class="kpi warn" data-go="alumnos" data-f="warn"><small>Por vencer</small><b>${c("warn")}</b></button>
    <button class="kpi bad" data-go="alumnos" data-f="bad"><small>Vencidos</small><b>${c("bad")}</b></button>
  </div>
  <div class="band">
    <div class="cell"><small>Cobrado en ${parse(TODAY).toLocaleDateString("es-AR",{month:"long"})}</small><b>${money(cobradoMes)}</b></div>
    <div class="cell"><small>Vinieron hoy</small><b>${hoy} <span style="font-size:16px;opacity:.75">de ${al.length}</span></b></div>
  </div>
  <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="pago">Registrar pago</button><button class="btn" data-act="nuevo">Nuevo alumno</button><a class="btn" href="#asistencia">Tomar asistencia</a></div>
  <h2>Para cobrar</h2>
  <div class="list">${cobrar.length ? cobrar.map(([a,e])=>{
    const wa = waLink(a.telefono, recordatorio(a));
    return `<div class="row"><div class="avatar">${esc(initials(a.nombre))}</div><div class="main"><div class="name">${esc(a.nombre)}</div><span class="pill ${e.k}">${esc(e.t)}</span> <span class="muted small num">${money(a.cuota)}</span></div>
    <div class="actions">${wa?`<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Avisar</a>`:`<button class="btn sm" data-act="copiar-rec" data-id="${esc(a.id)}">Aviso</button>`}<button class="btn sm primary" data-act="pago" data-id="${esc(a.id)}">Cobrar</button></div></div>`}).join("")
    : `<div class="empty">${al.length ? "Nadie debe la cuota. Todos tus alumnos están al día." : "Empezá cargando tus alumnos con <b>Nuevo alumno</b>."}</div>`}</div>
  ${cumplesInicio()}`;
}

function vAlumnos(){
  const q = S.q.toLowerCase();
  const todos = [...S.alumnos.values()].sort((x,y)=>x.nombre.localeCompare(y.nombre,"es"));
  const list = todos.filter(a => { const e=estado(a); if (S.filter==="todos" ? e.k==="off" : S.filter!==e.k) return false; return !q || a.nombre.toLowerCase().includes(q) || (a.telefono||"").includes(q) || (a.email||"").includes(q); });
  const chip = (k,t) => `<button class="chip" data-f="${k}" aria-pressed="${S.filter===k}">${t}</button>`;
  return `<h2>Alumnos</h2>
  <div class="toolbar"><input id="buscar" type="search" placeholder="Buscar por nombre, teléfono o email" value="${esc(S.q)}"><button class="btn primary" data-act="nuevo">Nuevo alumno</button></div>
  <div class="chips" style="margin-bottom:10px">${chip("todos","Activos")}${chip("ok","Al día")}${chip("warn","Por vencer")}${chip("bad","Vencidos")}${chip("off","Inactivos")}</div>
  <div class="list" id="al-list">${list.length ? list.map(a=>{const e=estado(a); return `<div class="row link" data-go="alumno-${esc(a.id)}" tabindex="0"><div class="avatar">${esc(initials(a.nombre))}</div><div class="main"><div class="name">${esc(a.nombre)}</div><div class="muted small">${esc(a.plan||"")}${a.vence?` · pagado hasta ${fdate(a.vence)}`:""}</div></div><span class="pill ${e.k}">${esc(e.t)}</span></div>`}).join("")
   : `<div class="empty">${S.alumnos.size ? "Ningún alumno coincide con el filtro." : "Todavía no cargaste alumnos. Tocá <b>Nuevo alumno</b> para empezar."}</div>`}</div>`;
}

function rutinaView(a){
  const dias = (a.rutina && a.rutina.dias) || [];
  if (!dias.length) return `<div class="empty">Sin rutina cargada. Tocá <b>Editar rutina</b> para armarla.</div>`;
  return `<div class="stack rt-view">${dias.map(d=>`<div class="day"><div class="day-head"><h3>${esc(d.nombre||"Día")}</h3></div><div style="overflow-x:auto"><table><thead><tr><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Carga / desc.</th></tr></thead><tbody>${(d.ejercicios||[]).map(x=>`<tr><td>${esc(x.nombre)}${videoDe(x.nombre)}</td><td class="num">${esc(x.series)}</td><td class="num">${esc(x.reps)}</td><td>${esc(x.carga)}</td></tr>`).join("")}</tbody></table></div></div>`).join("")}</div>`;
}
function rutinaEditor(){
  const d = S.draft;
  return `${datalistEjercicios()}<div class="stack">${d.dias.map((dia,i)=>`<div class="day"><div class="day-head"><input data-r="dia" data-i="${i}" value="${esc(dia.nombre)}" placeholder="Día ${i+1}" aria-label="Nombre del día"><button class="btn sm danger" data-act="rt-deldia" data-i="${i}">Quitar día</button></div>
    <div class="ex-labels"><span class="exn">Ejercicio</span><span>Series</span><span>Reps</span><span>Carga</span><span></span></div>
    ${dia.ejercicios.map((x,j)=>`<div class="ex"><input class="exn" data-r="nombre" data-i="${i}" data-j="${j}" value="${esc(x.nombre)}" placeholder="Ejercicio" aria-label="Ejercicio" list="ej-lib"><input data-r="series" data-i="${i}" data-j="${j}" value="${esc(x.series)}" placeholder="4" aria-label="Series"><input data-r="reps" data-i="${i}" data-j="${j}" value="${esc(x.reps)}" placeholder="10" aria-label="Repeticiones"><input data-r="carga" data-i="${i}" data-j="${j}" value="${esc(x.carga)}" placeholder="20 kg" aria-label="Carga"><button class="btn sm" data-act="rt-delex" data-i="${i}" data-j="${j}" aria-label="Quitar ejercicio">✕</button></div>`).join("")}
    <div style="padding:8px 10px"><button class="btn sm" data-act="rt-addex" data-i="${i}">+ Ejercicio</button></div></div>`).join("")}
    <div class="actions"><button class="btn" data-act="rt-adddia">+ Agregar día</button><button class="btn primary" data-act="rt-save">Guardar rutina</button><button class="btn" data-act="rt-cancel">Cancelar</button></div></div>`;
}
function rutinaTexto(a){
  const dias = (a.rutina&&a.rutina.dias)||[]; const e = estado(a);
  const cuota = e.d==null ? "Cuota: sin pagos registrados." : e.d<0 ? `Cuota: vencida desde el ${fdate(a.vence)}.` : `Cuota: al día hasta el ${fdate(a.vence)} (te quedan ${e.d} días).`;
  return `Rutina de ${a.nombre} – ${GYM}\n${cuota}\n` + dias.map(d=>`\n*${d.nombre}*\n`+(d.ejercicios||[]).map(x=>`• ${x.nombre}: ${x.series}x${x.reps}${x.carga?` (${x.carga})`:""}`).join("\n")).join("\n");
}

function vAlumno(id){
  const a = S.alumnos.get(id);
  if (!a) return `<div class="empty">No encontré ese alumno. <a href="#alumnos">Volver a la lista</a></div>`;
  const e = estado(a);
  const pagos = S.pagos.filter(p=>p.alumno_id===id);
  const desde30 = iso(new Date(Date.now()-30*86400000));
  const vino = [...S.asist.values()].filter(x=>x.fecha>=desde30 && x.ids.includes(id)).length;
  const wa = waLink(a.telefono, recordatorio(a));
  const waInv = a.email ? waLink(a.telefono, invitacion(a)) : null;
  return `<p style="margin:10px 0 0"><a href="#alumnos" class="muted small">← Alumnos</a></p>
  <div style="display:flex;gap:12px;align-items:center;margin-top:8px"><div class="avatar" style="width:52px;height:52px;font-size:22px">${esc(initials(a.nombre))}</div><div style="min-width:0"><h2 style="margin:0">${esc(a.nombre)}</h2><span class="pill ${e.k}">${esc(e.t)}</span></div></div>
  <div class="card" style="margin-top:12px"><div class="grid2 small">
    <div><span class="muted">Plan</span><br>${esc(a.plan||"—")}</div><div><span class="muted">Cuota</span><br><span class="num">${money(a.cuota)}</span></div>
    <div><span class="muted">Pagado hasta</span><br>${a.vence?fdate(a.vence):"Sin pagos"}</div><div><span class="muted">Asistencias (30 días)</span><br><span class="num">${vino}</span></div>
    <div><span class="muted">Teléfono</span><br>${esc(a.telefono||"—")}</div><div><span class="muted">Objetivo</span><br>${esc(a.objetivo||"—")}</div>
    <div><span class="muted">Cumpleaños</span><br>${a.nacimiento?`${fdate(a.nacimiento)} · ${edad(a.nacimiento)} años${esCumple(a.nacimiento)?" 🎂 ¡hoy!":""}`:"—"}</div>
  </div>${a.notas?`<p class="small" style="margin:10px 0 0"><span class="muted">Notas privadas:</span> ${esc(a.notas)}</p>`:""}
  <div class="actions" style="margin-top:12px"><button class="btn primary" data-act="pago" data-id="${esc(id)}">Registrar pago</button>${wa?`<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Recordar cuota</a>`:""}<button class="btn" data-act="editar" data-id="${esc(id)}">Editar datos</button></div></div>
  <div class="card small" style="margin-top:10px">${a.email
    ? `<b>Acceso a la app:</b> ${esc(a.email)}. Con ese email el alumno crea su cuenta y ve su rutina y sus días de cuota.<div class="actions" style="margin-top:8px">${waInv?`<a class="btn sm" href="${esc(waInv)}" target="_blank" rel="noopener">Invitar por WhatsApp</a>`:""}<button class="btn sm" data-act="copiar-inv" data-id="${esc(id)}">Copiar invitación</button></div>`
    : `<b>Sin acceso a la app.</b> Cargale un email en <button class="linkbtn" data-act="editar" data-id="${esc(id)}">Editar datos</button> para que pueda ver su rutina desde el celular.`}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Rutina</h2>${S.editRutina?"":`<div class="actions"><button class="btn sm" data-act="rt-copy" data-id="${esc(id)}">Copiar para WhatsApp</button><button class="btn sm primary" data-act="rt-edit" data-id="${esc(id)}">Editar rutina</button></div>`}</div>
  <div id="rt">${S.editRutina ? rutinaEditor() : rutinaView(a)}</div>
  <h2>Progreso</h2>
  ${progresoView(id, true)}
  <h2>Archivos (dietas y rutinas)</h2>
  <div class="card stack" style="margin-bottom:10px">
    <div class="grid2"><label class="f">Tipo<select id="arch-tipo"><option value="dieta">Dieta</option><option value="rutina">Rutina</option><option value="otro">Otro</option></select></label>
    <label class="f">Archivo (PDF, foto, Word, Excel · hasta 20 MB)<input id="arch-file" type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.txt"></label></div>
    <div class="actions"><button class="btn primary" id="arch-subir" data-act="arch-subir" data-id="${esc(id)}">Subir archivo</button></div>
  </div>
  <div class="list">${archivosLista((S.archivos||[]).filter(x=>x.alumno_id===id), true)}</div>
  <h2>Historial de pagos</h2>
  <div class="list">${pagos.length?pagos.map(p=>`<div class="row"><div class="main"><div class="name num">${money(p.monto)} <span class="muted small" style="font-weight:400">· ${esc(p.medio)}</span></div><div class="muted small">${fdate(p.fecha)} · cubre hasta ${fdate(p.hasta)}</div></div><button class="btn sm danger" data-act="anular" data-id="${esc(p.id)}">Anular</button></div>`).join(""):`<div class="empty">Todavía no registraste pagos de ${esc(a.nombre.split(" ")[0])}.</div>`}</div>`;
}

function vPagos(){
  const mes = TODAY.slice(0,7);
  const delMes = S.pagos.filter(p=>p.fecha.startsWith(mes));
  const porMedio = {}; delMes.forEach(p=>porMedio[p.medio]=(porMedio[p.medio]||0)+(p.monto||0));
  const esperado = activos().reduce((s,a)=>s+(a.cuota||0),0);
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Pagos</h2><button class="btn primary" data-act="pago">Registrar pago</button></div>
  <div class="band" style="margin-top:0"><div class="cell"><small>Cobrado este mes</small><b>${money(delMes.reduce((s,p)=>s+(p.monto||0),0))}</b></div><div class="cell"><small>Cuotas activas por mes</small><b>${money(esperado)}</b></div></div>
  ${Object.keys(porMedio).length?`<p class="small muted">${Object.entries(porMedio).map(([m,v])=>`${esc(m)}: <span class="num">${money(v)}</span>`).join(" · ")}</p>`:""}
  <h2>Datos para transferir y precios</h2>
  <form class="card stack" id="fcfg">
    <p class="small muted" style="margin:0">Tus alumnos ven estos datos en su pantalla para pagarte.</p>
    <div class="grid2">
      <label class="f">Alias<input id="cfg-alias" value="${esc(S.config.alias)}" placeholder="sol.trainer.mp" autocomplete="off"></label>
      <label class="f">Banco<input id="cfg-banco" value="${esc(S.config.banco)}" placeholder="Banco Provincia" autocomplete="off"></label>
      <label class="f">Titular de la cuenta<input id="cfg-titular" value="${esc(S.config.titular)}" autocomplete="off"></label>
      <label class="f">CVU / CBU (opcional)<input id="cfg-cvu" inputmode="numeric" value="${esc(S.config.cvu)}" autocomplete="off"></label>
      <label class="f">Tu WhatsApp (para que te avisen)<input id="cfg-wa" inputmode="tel" value="${esc(S.config.whatsapp)}" autocomplete="off"></label>
    </div>
    <b style="margin-top:6px">Precio de cada plan</b>
    <div class="grid2">${PLANES.map(([pl,k])=>`<label class="f">${pl} ($)<input id="cfg-${k}" inputmode="numeric" value="${esc(S.config[k]||"")}" placeholder="25000"></label>`).join("")}</div>
    <span class="small muted" style="margin-top:-4px">Al cargar un alumno nuevo, la cuota se completa sola según el plan.</span>
    <label class="f">Nota para los alumnos (opcional)<input id="cfg-nota" value="${esc(S.config.nota)}" placeholder="Pagá antes del día 10 de cada mes"></label>
    <div class="actions"><button class="btn primary" type="submit">Guardar datos</button></div>
  </form>
  <h2>Últimos pagos</h2>
  <div class="list">${S.pagos.length?S.pagos.slice(0,100).map(p=>`<div class="row link" data-go="alumno-${esc(p.alumno_id)}" tabindex="0"><div class="main"><div class="name">${esc(p.nombre)}</div><div class="muted small">${fdate(p.fecha)} · ${esc(p.medio)} · ${p.meses>1?p.meses+" meses":"1 mes"}</div></div><b class="num">${money(p.monto)}</b></div>`).join(""):`<div class="empty">Todavía no hay pagos registrados.</div>`}</div>`;
}

function vAsistencia(){
  const fecha = S.asistFecha || TODAY;
  const ids = (S.asist.get(fecha)||{ids:[]}).ids;
  const al = activos();
  return `<h2>Asistencia</h2>
  <div class="toolbar"><input type="date" id="as-fecha" value="${fecha}" style="max-width:190px"><span class="muted"><b class="num">${ids.length}</b> presentes de ${al.length}</span></div>
  <div class="list">${al.length?al.map(a=>{const on=ids.includes(a.id); const e=estado(a); return `<div class="row link" data-act="as-toggle" data-id="${esc(a.id)}" role="checkbox" aria-checked="${on}" tabindex="0"><div class="check ${on?"on":""}">✓</div><div class="main"><div class="name">${esc(a.nombre)}</div></div>${e.k!=="ok"?`<span class="pill ${e.k}">${esc(e.t)}</span>`:""}</div>`}).join(""):`<div class="empty">Cargá alumnos para tomar asistencia.</div>`}</div>
  <p class="small muted">Tocá un alumno para marcarlo presente. Si aparece con la cuota vencida, es buen momento para cobrarle.</p>`;
}

/* =================== Progreso, reportes, ejercicios y cumpleaños =================== */
const fmtN = n => Number(n).toLocaleString("es-AR",{maximumFractionDigits:1});
const compact = n => new Intl.NumberFormat("es-AR",{notation:"compact",maximumFractionDigits:1}).format(n||0);
const aidOf = x => x.alumno_id || x.alumnoId;
const mesNombre = m => parse(m+"-01").toLocaleDateString("es-AR",{month:"long",year:"numeric"});
const mesCorto = m => parse(m+"-01").toLocaleDateString("es-AR",{month:"short"}).replace(".","");
const mesMenos = (m, n) => addMonths(m+"-01", -n).slice(0,7);
const GRUPOS = ["Piernas","Glúteos","Pecho","Espalda","Hombros","Brazos","Core","Cardio","Movilidad"];
const CAMPOS = [["peso","Peso","kg"],["cintura","Cintura","cm"],["cadera","Cadera","cm"],["brazo","Brazo","cm"],["pierna","Pierna","cm"],["grasa","Grasa corporal","%"]];

function lineChart(pts, unit, nombre){
  if (pts.length < 2) return `<div class="empty small">${pts.length ? `Hay un solo registro (${fmtN(pts[0].y)} ${unit}). Con el próximo ya se ve la evolución.` : "Todavía no hay registros."}</div>`;
  const W=320, H=160, L=38, R=16, T=16, B=26;
  const xs = pts.map(p=>parse(p.x).getTime()), ys = pts.map(p=>p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  let y0 = lo, y1 = hi; if (y0===y1){ y0-=1; y1+=1; } const pad=(y1-y0)*.18; y0-=pad; y1+=pad;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = t => L + (x1===x0 ? .5 : (t-x0)/(x1-x0)) * (W-L-R);
  const Y = v => T + (1-(v-y0)/(y1-y0)) * (H-T-B);
  const P = pts.map((p,i)=>[X(xs[i]), Y(p.y)]);
  const line = P.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${P[0][0].toFixed(1)},${H-B} L${P.map(([x,y])=>`${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${P[P.length-1][0].toFixed(1)},${H-B} Z`;
  const ticks = [...new Set([lo, (lo+hi)/2, hi].map(v=>Math.round(v*10)/10))];
  const last = P[P.length-1], dif = ys[ys.length-1] - ys[0];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(nombre||"Evolución")}: de ${fmtN(ys[0])} a ${fmtN(ys[ys.length-1])} ${unit}">
    ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${L-6}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end">${fmtN(v)}</text>`).join("")}
    <path d="${area}" class="area"/><polyline points="${line}" class="ln"/>
    ${P.map(([x,y],i)=>`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i===P.length-1?4.5:2.5}" class="${i===P.length-1?"dot-end":"dot"}"/>`).join("")}
    <text x="${Math.min(last[0], W-R-2).toFixed(1)}" y="${(last[1]-9).toFixed(1)}" text-anchor="end" class="val">${fmtN(ys[ys.length-1])} ${unit}</text>
    <text x="${L}" y="${H-6}" text-anchor="start">${fdate(pts[0].x)}</text><text x="${W-R}" y="${H-6}" text-anchor="end">${fdate(pts[pts.length-1].x)}</text>
  </svg><div class="small muted">Desde el ${fdate(pts[0].x)}: <b class="num" style="color:var(--ink)">${dif>0?"+":""}${fmtN(dif)} ${unit}</b></div></div>`;
}

function barChart(items){
  const W=320, H=160, L=8, R=8, T=22, B=24, n=items.length, gap=10;
  const max = Math.max(1, ...items.map(i=>i.value)); const bw = (W-L-R-gap*(n-1))/n;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cobrado por mes: ${items.map(i=>`${i.label} ${money(i.value)}`).join(", ")}">
    <line x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}" class="grid"/>
    ${items.map((it,k)=>{ const h=(H-T-B)*it.value/max, x=L+k*(bw+gap), y=H-B-h; return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="3" class="${it.sel?"bar-sel":"bar"}"/><text x="${(x+bw/2).toFixed(1)}" y="${(y-6).toFixed(1)}" text-anchor="middle" class="${it.sel?"val":""}">${it.value?"$"+compact(it.value):"0"}</text><text x="${(x+bw/2).toFixed(1)}" y="${H-7}" text-anchor="middle">${esc(it.label)}</text>`; }).join("")}
  </svg></div>`;
}

function videoDe(nombre){
  const e = (S.biblio||[]).find(x => x.nombre.trim().toLowerCase() === String(nombre||"").trim().toLowerCase());
  if (!e) return "";
  if (e.video_url) return ` <a class="vid" href="${esc(e.video_url)}" target="_blank" rel="noopener" aria-label="Ver video de ${esc(e.nombre)}">▶ Video</a>`;
  if (e.video_path) return ` <button class="vid" data-abrir="${esc(e.video_path)}" aria-label="Ver video de ${esc(e.nombre)}">▶ Video</button>`;
  return "";
}
function datalistEjercicios(){
  const nombres = new Set((S.biblio||[]).map(e=>e.nombre));
  (S.cargas||[]).forEach(c=>nombres.add(c.ejercicio));
  return `<datalist id="ej-lib">${[...nombres].sort((a,b)=>a.localeCompare(b,"es")).map(n=>`<option value="${esc(n)}">`).join("")}</datalist>`;
}

/* ----- Progreso ----- */
function progresoView(id, admin){
  const med = (S.medic||[]).filter(m=>m.alumno_id===id).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const car = (S.cargas||[]).filter(c=>c.alumno_id===id).sort((a,b)=>a.fecha.localeCompare(b.fecha));
  const ejs = [...new Set(car.map(c=>c.ejercicio))].sort((a,b)=>a.localeCompare(b,"es"));
  const sel = ejs.includes(S.progEj[id]) ? S.progEj[id] : ejs[0];
  const has = (m,k) => m[k]!=null && m[k]!=="";
  const pesoPts = med.filter(m=>has(m,"peso")).map(m=>({x:m.fecha, y:Number(m.peso)}));
  const carPts = car.filter(c=>c.ejercicio===sel).map(c=>({x:c.fecha, y:Number(c.kg)}));
  const filas = CAMPOS.map(([k,t,u]) => { const v = med.filter(m=>has(m,k)); if (!v.length) return ""; const a=Number(v[0][k]), b=Number(v[v.length-1][k]), d=b-a;
    return `<tr><td>${t}</td><td class="num">${fmtN(a)} ${u}</td><td class="num"><b>${fmtN(b)} ${u}</b></td><td class="num ${d===0?"":"muted"}">${v.length>1?`${d>0?"+":""}${fmtN(d)}`:"—"}</td></tr>`; }).join("");
  return `<div class="stack">
  <div class="card stack"><div class="sec-head"><b>Peso corporal</b>${admin?`<button class="btn sm primary" data-act="med-nueva" data-id="${esc(id)}">+ Medición</button>`:""}</div>
    ${lineChart(pesoPts, "kg", "Peso corporal")}
    ${filas ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Medida</th><th>Primera</th><th>Última</th><th>Cambio</th></tr></thead><tbody>${filas}</tbody></table></div>` : ""}
    ${admin && med.length ? `<details><summary class="small">Ver mediciones cargadas (${med.length})</summary><div class="list" style="margin-top:8px">${med.slice().reverse().map(m=>`<div class="row"><div class="main"><div class="name">${fdate(m.fecha)}</div><div class="muted small">${CAMPOS.filter(([k])=>has(m,k)).map(([k,t,u])=>`${t} ${fmtN(m[k])} ${u}`).join(" · ")||"Sin valores"}</div></div><button class="btn sm danger" data-act="prog-del" data-tabla="mediciones" data-id="${esc(m.id)}" aria-label="Borrar medición">✕</button></div>`).join("")}</div></details>` : ""}
  </div>
  <div class="card stack"><div class="sec-head"><b>Cargas por ejercicio</b>${admin?`<button class="btn sm primary" data-act="carga-nueva" data-id="${esc(id)}">+ Carga</button>`:""}</div>
    ${ejs.length ? `<div class="chips">${ejs.map(e=>`<button class="chip" data-prog-ej="${esc(e)}" data-prog-id="${esc(id)}" aria-pressed="${e===sel}">${esc(e)}</button>`).join("")}</div>` : ""}
    ${ejs.length ? lineChart(carPts, "kg", sel) : `<div class="empty small">${admin ? "Registrá cuánto levanta en cada ejercicio para ver cómo progresa." : "Tu profe todavía no registró tus cargas."}</div>`}
    ${admin && carPts.length ? `<details><summary class="small">Ver registros de ${esc(sel)} (${carPts.length})</summary><div class="list" style="margin-top:8px">${car.filter(c=>c.ejercicio===sel).reverse().map(c=>`<div class="row"><div class="main"><div class="name num">${fmtN(c.kg)} kg${c.reps?` · ${esc(c.reps)} reps`:""}</div><div class="muted small">${fdate(c.fecha)}</div></div><button class="btn sm danger" data-act="prog-del" data-tabla="cargas" data-id="${esc(c.id)}" aria-label="Borrar registro">✕</button></div>`).join("")}</div></details>` : ""}
  </div></div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-prog-ej]"); if (!b) return;
  S.progEj[b.dataset.progId] = b.dataset.progEj; render();
});
function medicionForm(id){
  openSheet("Nueva medición", `<form id="fm" class="stack">
    <label class="f">Fecha<input id="fm-fecha" type="date" value="${TODAY}"></label>
    <div class="grid2">${CAMPOS.map(([k,t,u])=>`<label class="f">${t} (${u})<input id="fm-${k}" inputmode="decimal" placeholder="—"></label>`).join("")}</div>
    <label class="f">Notas<input id="fm-notas" placeholder="Opcional"></label>
    <div class="actions"><button class="btn primary" type="submit">Guardar medición</button></div></form>`, () => {
    $("#fm").onsubmit = async e => {
      e.preventDefault();
      const d = { alumno_id:id, fecha:$("#fm-fecha").value||TODAY, notas:$("#fm-notas").value.trim()||null };
      let alguno = false;
      CAMPOS.forEach(([k]) => { const v = $("#fm-"+k).value.replace(",",".").trim(); d[k] = v==="" ? null : Number(v); if (v!=="") alguno = true; });
      if (!alguno) return toast("Cargá al menos un valor");
      if (await guardar("mediciones", d)) closeSheet();
    };
  });
}
function cargaForm(id){
  const a = S.alumnos.get(id) || {};
  const deRutina = ((a.rutina&&a.rutina.dias)||[]).flatMap(d=>(d.ejercicios||[]).map(x=>x.nombre)).filter(Boolean);
  openSheet("Registrar carga", `<form id="fc" class="stack">
    <label class="f">Ejercicio<input id="fc-ej" list="ej-lib" required placeholder="Sentadilla" value="${esc(S.progEj[id]||deRutina[0]||"")}" autocomplete="off"></label>
    ${datalistEjercicios().replace('<datalist id="ej-lib">', `<datalist id="ej-lib">${deRutina.map(n=>`<option value="${esc(n)}">`).join("")}`)}
    <div class="grid2"><label class="f">Peso levantado (kg)<input id="fc-kg" inputmode="decimal" required></label><label class="f">Repeticiones<input id="fc-reps" placeholder="8"></label></div>
    <label class="f">Fecha<input id="fc-fecha" type="date" value="${TODAY}"></label>
    <div class="actions"><button class="btn primary" type="submit">Guardar carga</button></div></form>`, () => {
    $("#fc").onsubmit = async e => {
      e.preventDefault();
      const kg = Number($("#fc-kg").value.replace(",",".")); const ej = $("#fc-ej").value.trim();
      if (!ej || !kg) return toast("Completá ejercicio y peso");
      S.progEj[id] = ej;
      if (await guardar("cargas", { alumno_id:id, ejercicio:ej, kg, reps:$("#fc-reps").value.trim()||null, fecha:$("#fc-fecha").value||TODAY })) closeSheet();
    };
  });
}

/* ----- Reportes ----- */
function masTabs(cual){ return `<div class="chips" style="margin-top:14px"><a class="chip" href="#reportes" aria-pressed="${cual==="reportes"}">Reportes</a><a class="chip" href="#ejercicios" aria-pressed="${cual==="ejercicios"}">Ejercicios</a></div>`; }
function vReportes(){
  const m = S.repMes || TODAY.slice(0,7);
  const delMes = S.pagos.filter(p=>p.fecha.startsWith(m));
  const total = delMes.reduce((s,p)=>s+(p.monto||0),0);
  const prev = S.pagos.filter(p=>p.fecha.startsWith(mesMenos(m,1))).reduce((s,p)=>s+(p.monto||0),0);
  const porMedio = {}; delMes.forEach(p=>porMedio[p.medio||"Otro"]=(porMedio[p.medio||"Otro"]||0)+(p.monto||0));
  const seis = [5,4,3,2,1,0].map(k=>{ const mm=mesMenos(m,k); return {label:mesCorto(mm), value:S.pagos.filter(p=>p.fecha.startsWith(mm)).reduce((s,p)=>s+(p.monto||0),0), sel:k===0}; });
  const al = activos();
  const deud = al.map(a=>[a,estado(a)]).filter(([,e])=>e.k==="bad").sort((x,y)=>(x[1].d??-9999)-(y[1].d??-9999));
  const ultima = id => { let u=null; for (const [f,x] of S.asist) if (x.ids.includes(id) && (!u || f>u)) u=f; return u; };
  const hace14 = iso(new Date(Date.now()-14*86400000));
  const ausentes = al.map(a=>[a, ultima(a.id)]).filter(([a,u]) => (u ? u < hace14 : (a.alta||"") < hace14)).sort((x,y)=>(x[1]||"").localeCompare(y[1]||""));
  const altas = [...S.alumnos.values()].filter(a=>(a.alta||"").startsWith(m));
  const asisMes = [...S.asist.values()].filter(x=>x.fecha.startsWith(m) && x.ids.length);
  const visitas = asisMes.reduce((s,x)=>s+x.ids.length,0);
  return `${masTabs("reportes")}
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Reporte de ${esc(mesNombre(m))}</h2><input type="month" id="rep-mes" value="${m}" max="${TODAY.slice(0,7)}" style="max-width:180px" aria-label="Mes del reporte"></div>
  <div class="band" style="margin-top:0">
    <div class="cell"><small>Cobrado en el mes</small><b>${money(total)}</b><small>${delMes.length} ${delMes.length===1?"pago":"pagos"}${prev?` · ${total>=prev?"+":""}${Math.round((total-prev)/prev*100)}% vs. mes anterior`:""}</small></div>
    <div class="cell"><small>Asistencias en el mes</small><b>${visitas}</b><small>${asisMes.length} días con clase${asisMes.length?` · ${fmtN(visitas/asisMes.length)} por día`:""}</small></div>
  </div>
  <div class="card stack" style="margin-top:10px"><b>Cobrado por mes</b>${barChart(seis)}
    ${Object.keys(porMedio).length?`<div class="small muted">${Object.entries(porMedio).map(([k,v])=>`${esc(k)}: <span class="num">${money(v)}</span>`).join(" · ")}</div>`:""}</div>
  <h2>Deudores hoy <span class="muted small" style="font-family:var(--font-body);text-transform:none;letter-spacing:0">${deud.length} · al menos ${money(deud.reduce((s,[a])=>s+(a.cuota||0),0))}</span></h2>
  <div class="list">${deud.length?deud.map(([a,e])=>{ const wa=waLink(a.telefono, recordatorio(a)); return `<div class="row"><div class="main"><div class="name">${esc(a.nombre)}</div><div class="muted small">${esc(e.t)} · ${money(a.cuota)}</div></div><div class="actions">${wa?`<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Avisar</a>`:""}<button class="btn sm primary" data-act="pago" data-id="${esc(a.id)}">Cobrar</button></div></div>`; }).join(""):`<div class="empty">No hay deudores. Todos están al día.</div>`}</div>
  <h2>Dejaron de venir <span class="muted small" style="font-family:var(--font-body);text-transform:none;letter-spacing:0">más de 14 días sin asistir</span></h2>
  <div class="list">${ausentes.length?ausentes.map(([a,u])=>{ const wa=waLink(a.telefono, `Hola ${a.nombre.split(" ")[0]}! Te extrañamos en ${GYM}. ¿Cómo andás? ¿Te esperamos esta semana?`); return `<div class="row link" data-go="alumno-${esc(a.id)}" tabindex="0"><div class="main"><div class="name">${esc(a.nombre)}</div><div class="muted small">${u?`Última vez: ${fdate(u)} (hace ${daysBetween(u,TODAY)} días)`:"Nunca registró asistencia"}</div></div>${wa?`<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Escribirle</a>`:""}</div>`; }).join(""):`<div class="empty">Todos tus alumnos activos vinieron en las últimas dos semanas.</div>`}</div>
  <h2>Altas del mes <span class="muted small" style="font-family:var(--font-body);text-transform:none;letter-spacing:0">${altas.length}</span></h2>
  <div class="list">${altas.length?altas.map(a=>`<div class="row link" data-go="alumno-${esc(a.id)}" tabindex="0"><div class="main"><div class="name">${esc(a.nombre)}</div><div class="muted small">Alta el ${fdate(a.alta)} · ${esc(a.plan||"")}</div></div></div>`).join(""):`<div class="empty">No hubo altas en ${esc(mesNombre(m))}.</div>`}</div>`;
}
document.addEventListener("change", e => { if (e.target.id==="rep-mes"){ S.repMes = e.target.value || TODAY.slice(0,7); render(); } });

/* ----- Biblioteca de ejercicios ----- */
function vEjercicios(){
  const q = (S.qEj||"").toLowerCase();
  const lista = (S.biblio||[]).filter(e=>!q || e.nombre.toLowerCase().includes(q) || (e.grupo||"").toLowerCase().includes(q)).sort((a,b)=>a.nombre.localeCompare(b.nombre,"es"));
  const gi = g => { const i = GRUPOS.indexOf(g); return i < 0 ? 99 : i; };
  const grupos = [...new Set(lista.map(e=>e.grupo||"Otros"))].sort((a,b)=>gi(a)-gi(b) || a.localeCompare(b,"es"));
  return `${masTabs("ejercicios")}
  <h2>Biblioteca de ejercicios</h2>
  <p class="small muted" style="margin-top:-4px">Cada ejercicio con video aparece con <b>▶ Video</b> en la rutina de tus alumnos, cuando el nombre coincide.</p>
  <div class="toolbar"><input id="buscar-ej" type="search" placeholder="Buscar ejercicio o grupo" value="${esc(S.qEj||"")}"><button class="btn primary" data-act="ej-nuevo">Nuevo ejercicio</button></div>
  ${lista.length ? grupos.map(g=>`<h3 style="margin:14px 0 6px">${esc(g)}</h3><div class="list">${lista.filter(e=>(e.grupo||"Otros")===g).map(e=>`<div class="row"><div class="main"><div class="name">${esc(e.nombre)}</div>${e.descripcion?`<div class="muted small">${esc(e.descripcion)}</div>`:""}</div><div class="actions">${videoDe(e.nombre)||`<span class="small muted">sin video</span>`}<button class="btn sm" data-act="ej-editar" data-id="${esc(e.id)}">Editar</button></div></div>`).join("")}</div>`).join("")
   : `<div class="empty card">${(S.biblio||[]).length ? "Ningún ejercicio coincide con la búsqueda." : "Todavía no cargaste ejercicios. Tocá <b>Nuevo ejercicio</b> y pegá el link de un video corto."}</div>`}`;
}
document.addEventListener("input", e => { if (e.target.id==="buscar-ej"){ S.qEj = e.target.value; const pos=e.target.selectionStart; render(); const b=$("#buscar-ej"); if(b){ b.focus(); b.setSelectionRange(pos,pos);} } });
function ejercicioForm(ej){
  const n = !ej; ej = ej || {nombre:"",grupo:"",descripcion:"",video_url:""};
  openSheet(n ? "Nuevo ejercicio" : "Editar ejercicio", `<form id="fe" class="stack">
    <label class="f">Nombre (igual que en las rutinas)<input id="fe-nombre" required value="${esc(ej.nombre)}" autocomplete="off"></label>
    <label class="f">Grupo muscular<input id="fe-grupo" list="grupos" value="${esc(ej.grupo)}" placeholder="Piernas"></label>
    <datalist id="grupos">${GRUPOS.map(g=>`<option value="${g}">`).join("")}</datalist>
    <label class="f">Indicaciones (opcional)<textarea id="fe-desc" placeholder="Espalda recta, bajar hasta 90°…">${esc(ej.descripcion)}</textarea></label>
    <label class="f">Link del video (YouTube, Instagram, Drive…)<input id="fe-url" type="url" value="${esc(ej.video_url)}" placeholder="https://youtu.be/..."></label>
    <label class="f">O subí un video corto desde el celular (hasta 20 MB)<input id="fe-file" type="file" accept="video/*"></label>
    ${ej.video_path ? `<span class="small muted">Ya tiene un video subido. Si subís otro, se reemplaza.</span>` : ""}
    <div class="actions"><button class="btn primary" type="submit" id="fe-ok">${n?"Agregar ejercicio":"Guardar cambios"}</button>${n?"":`<button class="btn danger" type="button" id="fe-del">Borrar</button>`}</div></form>`, () => {
    $("#fe").onsubmit = async e => {
      e.preventDefault();
      const d = { nombre:$("#fe-nombre").value.trim(), grupo:$("#fe-grupo").value.trim()||null, descripcion:$("#fe-desc").value.trim()||null, video_url:$("#fe-url").value.trim()||null };
      if (!d.nombre) return;
      const f = $("#fe-file").files[0];
      if (f) {
        if (f.size > 20*1048576) return toast("El video pesa más de 20 MB. Probá con uno más corto o pegá un link.");
        const b=$("#fe-ok"); b.disabled=true; b.textContent="Subiendo video…";
        const v = await subirVideo(f); b.disabled=false; b.textContent="Guardar";
        if (!v) return;
        Object.assign(d, { video_url: null, video_path: null }, v);
      }
      if (await guardar("ejercicios", d, n ? null : ej.id)) closeSheet();
    };
    if (!n) $("#fe-del").onclick = async () => { if (await borrar("ejercicios", ej.id)) closeSheet(); };
  });
}

/* ----- Cumpleaños ----- */
const esCumple = (nac, dia=TODAY) => !!nac && nac.slice(5) === dia.slice(5);
const edad = nac => { if (!nac) return null; const [y,m,d] = nac.split("-").map(Number); const h = parse(TODAY); let e = h.getFullYear()-y; if (h.getMonth()+1<m || (h.getMonth()+1===m && h.getDate()<d)) e--; return e; };
function proximosCumples(dias){
  return activos().filter(a=>a.nacimiento).map(a=>{ let k=0; for (; k<=dias; k++){ if (esCumple(a.nacimiento, iso(new Date(parse(TODAY).getTime()+k*86400000)))) break; } return [a,k]; }).filter(([,k])=>k<=dias).sort((x,y)=>x[1]-y[1]);
}
function cumplesInicio(){
  const prox = proximosCumples(7); if (!prox.length) return "";
  return `<h2>Cumpleaños</h2><div class="list">${prox.map(([a,k])=>{ const wa = waLink(a.telefono, `¡Feliz cumpleaños, ${a.nombre.split(" ")[0]}! 🎉 Todo el equipo de ${GYM} te desea un gran día.`);
    return `<div class="row"><div class="avatar">🎂</div><div class="main"><div class="name">${esc(a.nombre)}</div><div class="muted small">${k===0?"<b>¡Hoy!</b> Ya le llega el saludo de la app":k===1?"Mañana":`En ${k} días`} · cumple ${edad(a.nacimiento)+(k===0?0:1)}</div></div>${k===0&&wa?`<a class="btn sm" href="${esc(wa)}" target="_blank" rel="noopener">Saludar</a>`:""}</div>`; }).join("")}</div>`;
}

/* ----- Acciones de administrador ----- */
async function accionesExtra(act, t){
  const id = t.dataset.id;
  if (act==="med-nueva") medicionForm(id);
  else if (act==="carga-nueva") cargaForm(id);
  else if (act==="prog-del") { if (await borrar(t.dataset.tabla, id)) toast("Registro borrado"); }
  else if (act==="ej-nuevo") ejercicioForm();
  else if (act==="ej-editar") ejercicioForm((S.biblio||[]).find(e=>e.id===id));
  else return false;
  return true;
}

/* ----- Guardado (Supabase) ----- */
async function guardar(tabla, datos, id){ return run(() => id ? sb.from(tabla).update(datos).eq("id", id) : sb.from(tabla).insert(datos), "Guardado"); }
async function borrar(tabla, id){ return run(() => sb.from(tabla).delete().eq("id", id)); }
async function subirVideo(f){
  const limpio = f.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9._-]+/g,"_");
  const path = `biblioteca/${Date.now()}-${limpio}`;
  const up = await sb.storage.from("archivos").upload(path, f, { contentType: f.type || undefined });
  if (up.error) { toast("No se pudo subir el video: " + errMsg(up.error)); return null; }
  return { video_path: path };
}

/* =================== Render & eventos =================== */
function render(){
  if (S.role === "alumno") return renderAlumno();
  if (S.role !== "admin") return;
  $("#top").hidden = false; $("#tabs").hidden = false;
  const r = location.hash.slice(1) || "inicio";
  const base = r.startsWith("alumno-") ? "alumnos" : (r==="reportes"||r==="ejercicios") ? "mas" : r;
  document.querySelectorAll("#tabs a").forEach(a => { if (a.dataset.v===base) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  if (S.editRutina && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.r) return;
  const focusSearch = document.activeElement && document.activeElement.id==="buscar"; const pos = focusSearch ? document.activeElement.selectionStart : 0;
  $("#view").innerHTML = r==="alumnos" ? vAlumnos() : r.startsWith("alumno-") ? vAlumno(r.slice(7)) : r==="pagos" ? vPagos() : r==="asistencia" ? vAsistencia() : r==="reportes" ? vReportes() : r==="ejercicios" ? vEjercicios() : vInicio();
  if (focusSearch){ const b=$("#buscar"); if(b){ b.focus(); b.setSelectionRange(pos,pos);} }
  pintarPush();
}
window.addEventListener("hashchange", () => { S.editRutina=false; S.draft=null; render(); window.scrollTo(0,0); });

document.addEventListener("input", e => {
  if (e.target.id==="buscar"){ S.q = e.target.value; const l=$("#al-list"); if(l){ const tmp=document.createElement("div"); tmp.innerHTML=vAlumnos(); l.innerHTML=tmp.querySelector("#al-list").innerHTML; } }
  const r = e.target.dataset && e.target.dataset.r;
  if (r && S.draft){ const i=+e.target.dataset.i; if (r==="dia") S.draft.dias[i].nombre=e.target.value; else S.draft.dias[i].ejercicios[+e.target.dataset.j][r]=e.target.value; }
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "fcfg") return;
  e.preventDefault();
  const v = id => $(id).value.trim() || null;
  await run(() => sb.from("config").update({ alias:v("#cfg-alias"), banco:v("#cfg-banco"), titular:v("#cfg-titular"), cvu:v("#cfg-cvu"), whatsapp:v("#cfg-wa"), nota:v("#cfg-nota"), ...Object.fromEntries(PLANES.map(([,k])=>[k, Number(($("#cfg-"+k).value||"").replace(/\D/g,""))||null])) }).eq("id",1), "Datos guardados");
});
document.addEventListener("change", e => { if (e.target.id==="as-fecha"){ S.asistFecha = e.target.value || TODAY; render(); } });
document.addEventListener("keydown", e => { if ((e.key==="Enter"||e.key===" ") && e.target.classList && e.target.classList.contains("link")) { e.preventDefault(); e.target.click(); } });
function rerenderRt(){ const r=$("#rt"); if (r) r.innerHTML = rutinaEditor(); }

document.addEventListener("click", async e => {
  if (S.role !== "admin") return;
  const t = e.target.closest("[data-act],[data-go],[data-f]");
  if (!t || t.closest("#tabs")) return;
  if (t.dataset.f && !t.dataset.go){ S.filter=t.dataset.f; render(); return; }
  if (t.dataset.go){ if (t.dataset.f) S.filter=t.dataset.f; location.hash = t.dataset.go; return; }
  const act = t.dataset.act, id = t.dataset.id;
  if (await accionesExtra(act, t)) return;
  if (act==="nuevo") alumnoForm();
  else if (act==="editar") alumnoForm(S.alumnos.get(id));
  else if (act==="pago") pagoForm(id);
  else if (act==="anular") anularPago(S.pagos.find(p=>p.id===id));
  else if (act==="copiar-rec") copy(recordatorio(S.alumnos.get(id)));
  else if (act==="arch-subir") subirArchivo(id);
  else if (act==="arch-del"){
    const f = (S.archivos||[]).find(x=>x.id===id); if (!f) return;
    openSheet("Borrar archivo", `<p>¿Borrar <b>${esc(f.nombre)}</b>? El alumno deja de verlo.</p><div class="actions"><button class="btn danger" id="ad-ok">Borrar archivo</button></div>`, () => {
      $("#ad-ok").onclick = async () => { await sb.storage.from("archivos").remove([f.path]); if (await run(() => sb.from("archivos").delete().eq("id", f.id), "Archivo borrado")) closeSheet(); };
    });
  }
  else if (act==="copiar-inv") copy(invitacion(S.alumnos.get(id)));
  else if (act==="rt-copy") copy(rutinaTexto(S.alumnos.get(id)));
  else if (act==="rt-edit"){ const a=S.alumnos.get(id); S.draft = JSON.parse(JSON.stringify((a.rutina&&a.rutina.dias&&a.rutina.dias.length)?a.rutina:{dias:[{nombre:"Día 1",ejercicios:[{nombre:"",series:"",reps:"",carga:""}]}]})); S.draft.alumnoId=id; S.editRutina=true; render(); }
  else if (act==="rt-cancel"){ S.editRutina=false; S.draft=null; render(); }
  else if (act==="rt-adddia"){ S.draft.dias.push({nombre:`Día ${S.draft.dias.length+1}`,ejercicios:[{nombre:"",series:"",reps:"",carga:""}]}); rerenderRt(); }
  else if (act==="rt-deldia"){ S.draft.dias.splice(+t.dataset.i,1); rerenderRt(); }
  else if (act==="rt-addex"){ S.draft.dias[+t.dataset.i].ejercicios.push({nombre:"",series:"",reps:"",carga:""}); rerenderRt(); const ins=document.querySelectorAll(`[data-r="nombre"][data-i="${t.dataset.i}"]`); ins[ins.length-1]?.focus(); }
  else if (act==="rt-delex"){ S.draft.dias[+t.dataset.i].ejercicios.splice(+t.dataset.j,1); rerenderRt(); }
  else if (act==="rt-save"){
    const dias = S.draft.dias.map(d=>({nombre:d.nombre.trim()||"Día", ejercicios:d.ejercicios.filter(x=>x.nombre.trim()).map(x=>({nombre:x.nombre.trim(),series:String(x.series).trim(),reps:String(x.reps).trim(),carga:String(x.carga).trim()}))})).filter(d=>d.ejercicios.length);
    const aid = S.draft.alumnoId; S.editRutina=false; S.draft=null;
    await run(() => sb.from("alumnos").update({ rutina:{dias}, rutina_actualizada:TODAY }).eq("id", aid), "Rutina guardada");
  }
  else if (act==="as-toggle"){
    const fecha = S.asistFecha || TODAY; const cur = (S.asist.get(fecha)||{fecha,ids:[]});
    const on = cur.ids.includes(id);
    cur.ids = on ? cur.ids.filter(x=>x!==id) : [...cur.ids, id]; S.asist.set(fecha, cur); render();
    const r = on ? await sb.from("asistencias").delete().eq("fecha",fecha).eq("alumno_id",id) : await sb.from("asistencias").upsert({fecha, alumno_id:id});
    if (r.error) { toast("No se pudo guardar la asistencia"); cargarAdmin(); }
  }
});


/* =================== Notificaciones al celular =================== */
const swListo = () => Promise.race([navigator.serviceWorker.ready, new Promise((_,r)=>setTimeout(()=>r(new Error("La app todavía se está instalando, probá de nuevo en unos segundos")),3000))]);
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
async function pushEstado(){
  if (!CFG.VAPID_PUBLIC_KEY) return "sin-config";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return esIOS && !instalada ? "ios-instalar" : "no-soportado";
  if (Notification.permission === "denied") return "bloqueado";
  try { const reg = await swListo(); const sub = await reg.pushManager.getSubscription(); return sub ? "activo" : "inactivo"; } catch { return "inactivo"; }
}
function b64ToUint8(b){ const p="=".repeat((4-b.length%4)%4); const raw=atob((b+p).replace(/-/g,"+").replace(/_/g,"/")); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0))); }
async function activarPush(){
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("No diste permiso para las notificaciones"); return pintarPush(); }
    const reg = await swListo();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:b64ToUint8(CFG.VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subs").upsert({ endpoint:j.endpoint, email:S.email, p256dh:j.keys.p256dh, auth:j.keys.auth });
    if (error) throw error;
    toast("Listo, vas a recibir los avisos en este celular");
  } catch(e){ toast("No se pudieron activar: " + errMsg(e)); }
  pintarPush();
}
async function pintarPush(){
  const box = $("#push-box"); if (!box) return;
  const st = await pushEstado();
  const txt = S.role==="admin" ? "Recibí un aviso 48 horas antes de que venza cada cuota, y un resumen de las vencidas." : "Activá los avisos y te llega una notificación 48 horas antes de que venza tu cuota y cuando tu profe te manda una dieta o rutina nueva.";
  box.innerHTML = st==="activo" ? `<span class="small muted">🔔 Avisos activados en este celular.</span>`
    : st==="inactivo" ? `<div class="notice"><span>${txt}</span><button class="btn sm primary" id="push-on">Activar avisos</button></div>`
    : st==="ios-instalar" ? `<div class="notice"><span>Para recibir avisos en iPhone, primero agregá la app a la pantalla de inicio (botón Compartir y luego “Agregar a inicio”) y abrila desde ahí.</span></div>`
    : st==="bloqueado" ? `<div class="notice"><span>Bloqueaste las notificaciones. Habilitalas desde la configuración del navegador para recibir los avisos.</span></div>`
    : "";
  const b = $("#push-on"); if (b) b.onclick = activarPush;
}

/* =================== Arranque =================== */
async function iniciar(){
  const { data:{ session } } = await sb.auth.getSession();
  if (!session) { S.role=null; return vLogin(); }
  if (RECOVERY && !S.recoveryDone) { S.recoveryDone = true; return vLogin("nueva"); }
  S.email = session.user.email;
  const { data: admin, error } = await sb.rpc("soy_admin");
  if (error) { $("#view").innerHTML = `<div class="notice err">No pudimos conectar: ${esc(errMsg(error))}</div>`; return; }
  S.role = admin ? "admin" : "alumno";
  if (S.role==="admin") { $("#view").innerHTML = `<div class="empty">Cargando tus alumnos…</div>`; $("#top").hidden=false; await cargarAdmin(); }
  else await cargarAlumno();
}
$("#salir").onclick = async () => {
  try { const reg = await swListo(); const sub = await reg.pushManager.getSubscription(); if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } } catch {}
  await sb.auth.signOut(); S.role=null; location.hash=""; vLogin(); };
sb.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") vLogin("nueva"); });
iniciar();
})();
