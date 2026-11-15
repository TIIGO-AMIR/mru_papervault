(() => {
  "use strict";

  const C = window.PV_CONFIG;
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const app = document.getElementById("app");
  const $ = (sel) => document.querySelector(sel);
  const OFFLINE_MSG = "Your phone is offline. Connect to the internet and try again.";
  const QUEUED_MSG = "Your phone is offline. The file is saved and will be shared when you are online.";

  let profile = null; // { id, reg_no, name, year, course }

  const ICON_EYE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12,4.5C7,4.5 2.73,7.61 1,12c1.73,4.39 6,7.5 11,7.5s9.27,-3.11 11,-7.5c-1.73,-4.39 -6,-7.5 -11,-7.5zM12,17c-2.76,0 -5,-2.24 -5,-5s2.24,-5 5,-5 5,2.24 5,5 -2.24,5 -5,5zM12,9c-1.66,0 -3,1.34 -3,3s1.34,3 3,3 3,-1.34 3,-3 -1.34,-3 -3,-3z"/></svg>';
  const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19,9h-4V3H9v6H5l7,7 7,-7zM5,18v2h14v-2H5z"/></svg>';
  const ICON_MORE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';

  // ---------- Small helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add("hidden"), 4500);
  }

  function friendly(err) {
    if (!navigator.onLine) return OFFLINE_MSG;
    const m = String((err && err.message) || err || "").toLowerCase();
    if (err instanceof TypeError || /fetch|network/.test(m)) return OFFLINE_MSG;
    if (m.includes("invalid login credentials")) return "Email or password is incorrect.";
    if (m.includes("already registered") || m.includes("already exists") || m.includes("duplicate")) {
      return "An account with this email or registration number already exists.";
    }
    if (m.includes("password") && (m.includes("at least") || m.includes("weak") || m.includes("should"))) {
      return "Choose a stronger password with at least 8 characters.";
    }
    if (m.includes("too large") || m.includes("413") || m.includes("payload")) {
      return "This file is larger than the 20 MB limit. Choose a smaller file.";
    }
    if (m.includes("rate limit") || m.includes("too many")) {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
    return "Something went wrong. Please try again.";
  }

  function safeName(name) {
    return String(name).replace(/[^A-Za-z0-9._-]/g, "_");
  }

  function extOf(name) {
    const i = String(name).lastIndexOf(".");
    return i >= 0 ? String(name).slice(i).toLowerCase() : ".pdf";
  }

  function mimeFromName(name) {
    const n = String(name).toLowerCase();
    if (n.endsWith(".pdf")) return "application/pdf";
    if (n.endsWith(".png")) return "image/png";
    return "image/jpeg";
  }

  function fileNameFor(paper) {
    return safeName(paper.title) + extOf(paper.file_path);
  }

  function matches(query, ...fields) {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return fields.some((f) => String(f || "").toLowerCase().includes(q));
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Saved "${name}". On iPhone, choose Save to Files if asked.`);
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (label) button.textContent = busy ? "Please wait..." : label;
  }

  // ---------- Profile storage ----------
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem("pv_profile")) || null; } catch (_) { return null; }
  }
  function saveProfile(p) {
    localStorage.setItem("pv_profile", JSON.stringify(p));
  }

  async function ensureProfile(user) {
    const { data: rows, error } = await sb.from("profiles").select("*").eq("id", user.id);
    if (error) throw error;
    let p = rows && rows[0];
    if (!p) {
      const m = user.user_metadata || {};
      p = { id: user.id, reg_no: m.reg_no, name: m.name, year: m.year, course: m.course };
      const { error: insertError } = await sb.from("profiles").insert(p);
      if (insertError) throw insertError;
    }
    profile = { id: p.id, reg_no: p.reg_no, name: p.name, year: p.year, course: p.course };
    saveProfile(profile);
  }

  async function doLogin(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await ensureProfile(data.user);
  }

  async function doRegister(f) {
    const { data, error } = await sb.auth.signUp({
      email: f.email,
      password: f.password,
      options: { data: { reg_no: f.reg, name: f.name, year: f.year, course: f.course } }
    });
    if (error) throw error;
    let user = data.user;
    if (!data.session) {
      // Email confirmation is off, so sign in straight away if the server did not return a session.
      const r = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
      if (r.error) throw r.error;
      user = r.data.user;
    }
    await ensureProfile(user);
  }

  async function doLogout() {
    try { await sb.auth.signOut({ scope: "local" }); } catch (_) { /* offline is fine */ }
    localStorage.removeItem("pv_profile");
    profile = null;
    location.hash = "#/login";
  }

  // ---------- Files on this phone (per account) ----------
  async function myFiles() {
    const list = await PVDB.getByOwner("files", profile.id);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function queuedIds() {
    return new Set((await PVDB.getAll("queue")).map((q) => q.fileId));
  }

  function statusOf(rec, queued) {
    if (rec.sharedPaperId) return "Shared online";
    if (queued.has(rec.id)) return "Waiting to be shared";
    return "On this phone only";
  }

  async function saveNewFile(meta, file) {
    if (file.size > C.maxBytes) throw new Error("file too large");
    const rec = {
      id: crypto.randomUUID(),
      owner: profile.id,
      reg: profile.reg_no,
      title: meta.title,
      course: meta.course,
      year: meta.year,
      type: meta.type,
      fileName: safeName(file.name),
      mime: file.type || mimeFromName(file.name),
      size: file.size,
      blob: file,
      createdAt: Date.now(),
      sharedPaperId: null,
      storagePath: null
    };
    await PVDB.put("files", rec);
    if (meta.share) return shareRecord(rec);
    return null;
  }

  // ---------- Sharing to the shared library ----------
  async function shareRecord(rec) {
    if (!navigator.onLine) {
      await PVDB.put("queue", { fileId: rec.id, queuedAt: Date.now() });
      return QUEUED_MSG;
    }
    if (rec.size > C.maxBytes) return friendly(new Error("file too large"));
    try {
      const path = `${rec.owner}/${rec.id}_${safeName(rec.fileName)}`;
      const up = await sb.storage.from(C.bucket).upload(path, rec.blob, {
        contentType: rec.mime,
        upsert: true
      });
      if (up.error) throw up.error;

      const ins = await sb.from("papers").insert({
        title: rec.title,
        course: rec.course,
        year: rec.year,
        type: rec.type,
        file_path: path,
        uploaded_by: rec.reg
      }).select("id").single();
      if (ins.error) throw ins.error;

      rec.sharedPaperId = ins.data.id;
      rec.storagePath = path;
      await PVDB.put("files", rec);
      await PVDB.del("queue", rec.id);
      return null;
    } catch (e) {
      if (!navigator.onLine || /fetch|network/i.test(String(e && e.message))) {
        await PVDB.put("queue", { fileId: rec.id, queuedAt: Date.now() });
        return QUEUED_MSG;
      }
      return friendly(e);
    }
  }

  async function sendQueue() {
    if (!profile || !navigator.onLine) return { sent: 0, message: null };
    const items = await PVDB.getAll("queue");
    let sent = 0;
    let message = null;
    for (const q of items) {
      const rec = await PVDB.get("files", q.fileId);
      if (!rec) { await PVDB.del("queue", q.fileId); continue; }
      if (rec.owner !== profile.id) continue;
      const result = await shareRecord(rec);
      if (result) message = result; else sent++;
    }
    return { sent, message };
  }

  // ---------- Shared library cache ----------
  async function refreshShared() {
    const { data, error } = await sb.from("papers").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    await PVDB.clear("papers");
    for (const p of data) await PVDB.put("papers", p);
    return data;
  }

  async function paperBlob(paper) {
    const saved = await PVDB.get("downloads", paper.id);
    if (saved) return saved.blob;
    if (!navigator.onLine) throw new TypeError("offline");
    const { data, error } = await sb.storage.from(C.bucket).download(paper.file_path);
    if (error) throw error;
    await PVDB.put("downloads", { id: paper.id, blob: data });
    return data;
  }

  // ---------- Viewer ----------
  async function renderBlob(blob, mime, host) {
    host.innerHTML = "";
    if (mime.startsWith("image/")) {
      const img = new Image();
      img.className = "page-img";
      img.src = URL.createObjectURL(blob);
      host.appendChild(img);
      return;
    }
    try {
      const data = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const available = Math.min(host.clientWidth || window.innerWidth, 900) - 16;
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (available / base.width) * dpr });
        const canvas = document.createElement("canvas");
        canvas.className = "page-canvas";
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width / dpr}px`;
        host.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
    } catch (_) {
      host.innerHTML = '<p class="error">This file cannot be displayed here. Download it to your phone instead.</p>';
    }
  }

  // ---------- Bottom sheets (menus and small forms) ----------
  function closeSheet() {
    $("#sheet").classList.add("hidden");
  }

  function openSheet(title, buttons) {
    $("#sheet-title").textContent = title;
    const body = $("#sheet-body");
    body.innerHTML = "";
    buttons.forEach((b) => {
      const el = document.createElement("button");
      el.className = `btn ${b.cls || "outline"}`;
      el.textContent = b.label;
      el.onclick = () => { closeSheet(); b.run(); };
      body.appendChild(el);
    });
    const cancel = document.createElement("button");
    cancel.className = "btn text";
    cancel.textContent = "Cancel";
    cancel.onclick = closeSheet;
    body.appendChild(cancel);
    $("#sheet").classList.remove("hidden");
  }

  function openForm(title, html, onSubmit) {
    $("#sheet-title").textContent = title;
    const body = $("#sheet-body");
    body.innerHTML = `<form class="stack" id="sheet-form">${html}
      <button class="btn primary" type="submit">Save</button>
      <button class="btn text" type="button" id="sheet-cancel">Cancel</button></form>`;
    $("#sheet-cancel").onclick = closeSheet;
    $("#sheet-form").onsubmit = async (ev) => {
      ev.preventDefault();
      const ok = await onSubmit(new FormData(ev.target));
      if (ok !== false) closeSheet();
    };
    $("#sheet").classList.remove("hidden");
  }

  function yearOptions(selected) {
    return C.yearLabels.map((y, i) =>
      `<option value="${i + 1}" ${i + 1 === Number(selected) ? "selected" : ""}>${y}</option>`).join("");
  }

  function typeOptions(selected) {
    return C.paperTypes.map((t) =>
      `<option value="${esc(t)}" ${t === selected ? "selected" : ""}>${esc(t)}</option>`).join("");
  }

  // ---------- Views ----------
  const titles = {
    "/home": "PaperVault", "/login": "PaperVault", "/register": "Create account",
    "/save": "Save a file", "/mine": "My files", "/library": "Browse papers", "/view": "Paper"
  };

  const views = {};

  views["/login"] = () => {
    app.innerHTML = `
      <section class="card auth">
        <img class="logo" src="logo.png" alt="MRU logo">
        <h2>PaperVault</h2>
        <p class="muted">Log in to your account.</p>
        <form id="f-login" class="stack">
          <input id="l-email" type="email" placeholder="Email" autocomplete="email" required>
          <input id="l-pass" type="password" placeholder="Password" autocomplete="current-password" required>
          <button class="btn primary" id="l-submit" type="submit">Log in</button>
        </form>
        <button class="btn text" id="go-register" type="button">New student? Create an account</button>
        <p class="motto">SEEKING GREATER HORIZONS IN THOUGHT &amp; ACTION</p>
      </section>`;
    $("#f-login").onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = $("#l-submit");
      if (!navigator.onLine) return toast("You need internet to log in the first time on this phone.");
      setBusy(btn, true, "Log in");
      try {
        await doLogin($("#l-email").value.trim(), $("#l-pass").value);
        location.hash = "#/home";
      } catch (e) {
        toast(friendly(e));
      } finally {
        setBusy(btn, false, "Log in");
      }
    };
    $("#go-register").onclick = () => { location.hash = "#/register"; };
  };

  views["/register"] = () => {
    app.innerHTML = `
      <section class="card">
        <h2>Create your account</h2>
        <p class="muted">Your files stay private to your account.</p>
        <form id="f-reg" class="stack">
          <input id="r-name" placeholder="Full name" autocomplete="name" required>
          <input id="r-reg" placeholder="Registration number" required>
          <label class="field">Year of study</label>
          <select id="r-year">${yearOptions(1)}</select>
          <input id="r-course" placeholder="Course (programme)" required>
          <input id="r-email" type="email" placeholder="Email" autocomplete="email" required>
          <input id="r-pass" type="password" placeholder="Password (at least 8 characters)" autocomplete="new-password" required>
          <input id="r-confirm" type="password" placeholder="Confirm password" autocomplete="new-password" required>
          <button class="btn primary" id="r-submit" type="submit">Create account</button>
        </form>
      </section>`;
    $("#f-reg").onsubmit = async (ev) => {
      ev.preventDefault();
      const f = {
        name: $("#r-name").value.trim(),
        reg: $("#r-reg").value.trim().toUpperCase(),
        year: Number($("#r-year").value),
        course: $("#r-course").value.trim(),
        email: $("#r-email").value.trim(),
        password: $("#r-pass").value,
        confirm: $("#r-confirm").value
      };
      if (f.password.length < 8) return toast("Your password must be at least 8 characters.");
      if (f.password !== f.confirm) return toast("The two passwords do not match.");
      if (!navigator.onLine) return toast("You need internet to create your account.");
      const btn = $("#r-submit");
      setBusy(btn, true, "Create account");
      try {
        await doRegister(f);
        location.hash = "#/home";
      } catch (e) {
        toast(friendly(e));
      } finally {
        setBusy(btn, false, "Create account");
      }
    };
  };

  views["/home"] = async () => {
    const files = await myFiles();
    const queued = await queuedIds();
    const waiting = files.filter((f) => queued.has(f.id)).length;
    app.innerHTML = `
      <section class="card blue">
        <strong>${esc(profile.name)}</strong>
        <div>${esc(profile.reg_no)} &bull; Year ${esc(profile.year)}</div>
        <div>${esc(profile.course)}</div>
      </section>
      <section class="card gold" id="summary"></section>
      <div class="stack">
        <button class="btn gold" id="b-save">Save a file on my phone</button>
        <button class="btn primary" id="b-mine">My files</button>
        <button class="btn primary" id="b-lib">Browse papers</button>
        <button class="btn outline" id="b-send">Share waiting files now</button>
        <button class="btn text" id="b-logout">Log out</button>
      </div>`;
    const summary = `${files.length} file(s) saved on this phone` +
      (waiting ? `<br>${waiting} waiting to be shared. They will be shared when you are online.` : "");
    $("#summary").innerHTML = summary;

    $("#b-save").onclick = () => { location.hash = "#/save"; };
    $("#b-mine").onclick = () => { location.hash = "#/mine"; };
    $("#b-lib").onclick = () => { location.hash = "#/library"; };
    $("#b-send").onclick = () => runSend(true);
    $("#b-logout").onclick = doLogout;

    if (waiting && navigator.onLine) runSend(false);
  };

  async function runSend(showMessages) {
    const btn = $("#b-send");
    if (!navigator.onLine) {
      if (showMessages) toast(OFFLINE_MSG);
      return;
    }
    if (btn) setBusy(btn, true, "Share waiting files now");
    const { sent, message } = await sendQueue();
    if (btn) setBusy(btn, false, "Share waiting files now");
    if (showMessages) toast(message || (sent ? "Waiting files are shared." : "Nothing is waiting to be shared."));
    if (sent && location.hash === "#/home") views["/home"]();
  }

  views["/save"] = () => {
    app.innerHTML = `
      <section class="card">
        <h2>Save a file on my phone</h2>
        <p class="muted">The file stays on your phone. Only you can see it, unless you choose to share it.</p>
        <form id="f-save" class="stack">
          <input id="s-file" type="file" accept=".pdf,image/jpeg,image/png" required>
          <input id="s-title" placeholder="Title (e.g. CSC 201 Final Exam 2024)" required>
          <input id="s-course" placeholder="Course unit (code and name)" required>
          <label class="field">Year</label>
          <select id="s-year">${yearOptions(profile.year)}</select>
          <label class="field">Type</label>
          <select id="s-type">${typeOptions(C.paperTypes[0])}</select>
          <label class="check"><input id="s-share" type="checkbox"> Also share this file to the shared library now</label>
          <button class="btn gold" id="s-submit" type="submit">Save</button>
        </form>
      </section>`;
    $("#f-save").onsubmit = async (ev) => {
      ev.preventDefault();
      const file = $("#s-file").files[0];
      if (!file) return toast("Please choose a PDF or photo first.");
      const btn = $("#s-submit");
      setBusy(btn, true, "Save");
      try {
        const message = await saveNewFile({
          title: $("#s-title").value.trim(),
          course: $("#s-course").value.trim(),
          year: Number($("#s-year").value),
          type: $("#s-type").value,
          share: $("#s-share").checked
        }, file);
        toast(message || "Saved on your phone.");
        location.hash = "#/mine";
      } catch (e) {
        toast(friendly(e));
      } finally {
        setBusy(btn, false, "Save");
      }
    };
  };

  // Shared list rendering for "My files" and "Browse papers"
  async function buildItems(scope) {
    const mine = await myFiles();
    const queued = await queuedIds();
    const items = mine.map((f) => ({
      kind: "mine", id: f.id, title: f.title,
      sub: `${f.course} • Year ${f.year} • ${statusOf(f, queued)}`, rec: f
    }));
    if (scope === "library") {
      const shared = new Set(mine.filter((f) => f.sharedPaperId).map((f) => f.sharedPaperId));
      const papers = (await PVDB.getAll("papers")).sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      for (const p of papers) {
        if (shared.has(p.id)) continue;
        items.push({
          kind: "shared", id: p.id, title: p.title,
          sub: `${p.course} • Year ${p.year} • ${p.type}`, paper: p
        });
      }
    }
    return items;
  }

  function renderRows(items, query, scope) {
    const visible = items.filter((it) =>
      matches(query, it.title, it.kind === "mine" ? it.rec.course : it.paper.course));
    const host = $("#rows");
    if (!visible.length) {
      host.innerHTML = `<div class="empty">${scope === "mine"
        ? "You have no files on this phone yet.<br>Use Save a file on my phone on the Home screen."
        : "No papers yet."}</div>`;
      return;
    }
    host.innerHTML = `<ul class="list">${visible.map((it) => `
      <li class="row" data-kind="${it.kind}" data-id="${esc(it.id)}">
        <div class="row-text">
          <div class="row-title">${esc(it.title)}</div>
          <div class="row-sub">${esc(it.sub)}</div>
        </div>
        <button class="icon-btn" data-act="view" aria-label="View in the app">${ICON_EYE}</button>
        <button class="icon-btn gold" data-act="download" aria-label="Download to my phone">${ICON_DOWNLOAD}</button>
        ${it.kind === "mine" ? `<button class="icon-btn" data-act="more" aria-label="More options">${ICON_MORE}</button>` : ""}
      </li>`).join("")}</ul>`;

    host.onclick = (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const row = btn.closest(".row");
      const item = items.find((it) => it.kind === row.dataset.kind && it.id === row.dataset.id);
      if (!item) return;
      const act = btn.dataset.act;
      if (act === "view") openViewer(item);
      if (act === "download") downloadItem(item);
      if (act === "more") moreMenu(item, scope);
    };
  }

  function openViewer(item) {
    location.hash = `#/view?kind=${item.kind}&id=${encodeURIComponent(item.id)}`;
  }

  async function downloadItem(item) {
    try {
      if (item.kind === "mine") {
        saveBlob(item.rec.blob, item.rec.fileName);
      } else {
        const blob = await paperBlob(item.paper);
        saveBlob(blob, fileNameFor(item.paper));
      }
    } catch (e) {
      toast(friendly(e));
    }
  }

  function moreMenu(item, scope) {
    const rec = item.rec;
    const buttons = [];
    if (!rec.sharedPaperId) buttons.push({ label: "Share to the shared library", run: () => shareFromMenu(rec, scope) });
    buttons.push({ label: "Rename", run: () => renameFile(rec, scope) });
    buttons.push({ label: "Edit details", run: () => editFile(rec, scope) });
    buttons.push({ label: rec.sharedPaperId ? "Delete" : "Delete from my phone", cls: "danger", run: () => deleteFile(rec, scope) });
    openSheet(rec.title, buttons);
  }

  async function shareFromMenu(rec, scope) {
    toast("Sharing...");
    const message = await shareRecord(rec);
    toast(message || "Shared to the library.");
    refreshCurrent(scope);
  }

  function renameFile(rec, scope) {
    openForm("Rename", `<input name="title" value="${esc(rec.title)}" required>`, async (fd) => {
      const title = String(fd.get("title") || "").trim();
      if (!title) { toast("The name cannot be empty."); return false; }
      rec.title = title;
      await PVDB.put("files", rec);
      refreshCurrent(scope);
    });
  }

  function editFile(rec, scope) {
    openForm("Edit details", `
      <input name="title" value="${esc(rec.title)}" required>
      <input name="course" value="${esc(rec.course)}" required>
      <select name="year">${yearOptions(rec.year)}</select>
      <select name="type">${typeOptions(rec.type)}</select>`, async (fd) => {
      const course = String(fd.get("course") || "").trim();
      const title = String(fd.get("title") || "").trim();
      if (!title || !course) { toast("Title and course are required."); return false; }
      Object.assign(rec, { title, course, year: Number(fd.get("year")), type: String(fd.get("type")) });
      await PVDB.put("files", rec);
      refreshCurrent(scope);
    });
  }

  function deleteFile(rec, scope) {
    const removeLocal = async () => {
      await PVDB.del("files", rec.id);
      await PVDB.del("queue", rec.id);
      toast("Removed from your phone.");
      refreshCurrent(scope);
    };
    if (!rec.sharedPaperId) return openSheet("Delete this file?", [{ label: "Delete", cls: "danger", run: removeLocal }]);
    openSheet("Delete this file?", [
      { label: "Remove from my phone only", cls: "danger", run: removeLocal },
      {
        label: "Remove from my phone and the shared library", cls: "danger",
        run: async () => {
          if (!navigator.onLine) return toast(OFFLINE_MSG);
          try {
            const del = await sb.from("papers").delete().eq("id", rec.sharedPaperId);
            if (del.error) throw del.error;
            if (rec.storagePath) await sb.storage.from(C.bucket).remove([rec.storagePath]);
            await PVDB.del("papers", rec.sharedPaperId);
            await removeLocal();
          } catch (e) {
            toast(friendly(e));
          }
        }
      }
    ]);
  }

  function refreshCurrent(scope) {
    if (location.hash === `#/${scope === "mine" ? "mine" : "library"}`) views[`/${scope === "mine" ? "mine" : "library"}`]();
  }

  function listView(scope) {
    return async () => {
      app.innerHTML = `
        <input class="search" id="search" type="search" placeholder="${scope === "mine" ? "Search my files" : "Search by title or course"}">
        <p class="error" id="status"></p>
        <div id="rows"></div>`;

      let items = await buildItems(scope);
      const show = () => renderRows(items, $("#search").value, scope);
      show();
      $("#search").oninput = show;

      if (scope !== "library") return;
      if (!navigator.onLine) {
        $("#status").classList.remove("error");
        $("#status").textContent = "You are offline. Showing what is saved on this phone.";
        return;
      }
      try {
        await refreshShared();
        items = await buildItems(scope);
        show();
      } catch (_) {
        $("#status").textContent = "The shared library could not be refreshed. Showing what is saved on this phone.";
      }
    };
  }
  views["/mine"] = listView("mine");
  views["/library"] = listView("library");

  views["/view"] = async (params) => {
    app.innerHTML = '<div class="viewer" id="viewer"><p class="muted">Opening...</p></div>';
    let blob, mime, title;
    try {
      if (params.kind === "mine") {
        const rec = await PVDB.get("files", params.id);
        if (!rec || rec.owner !== profile.id) throw new Error("not found");
        blob = rec.blob; mime = rec.mime; title = rec.title;
      } else {
        const paper = await PVDB.get("papers", params.id);
        if (!paper) throw new Error("not found");
        blob = await paperBlob(paper);
        mime = mimeFromName(paper.file_path); title = paper.title;
      }
    } catch (e) {
      $("#viewer").innerHTML = `<p class="error">${esc(friendly(e))}</p>`;
      return;
    }
    $("#title").textContent = title;
    await renderBlob(blob, mime, $("#viewer"));
  };

  // ---------- Router ----------
  function route() {
    const [path, query] = (location.hash.slice(1) || "/").split("?");
    const params = Object.fromEntries(new URLSearchParams(query || ""));
    const publicPaths = ["/login", "/register"];

    if (!profile) {
      if (!publicPaths.includes(path)) { location.hash = "#/login"; return; }
    } else if (publicPaths.includes(path)) {
      location.hash = "#/home";
      return;
    }

    const key = views[path] ? path : "/home";
    $("#title").textContent = titles[key] || "PaperVault";
    const showBack = profile && !["/home", "/login", "/register"].includes(key);
    $("#back").classList.toggle("hidden", !showBack);
    closeSheet();
    Promise.resolve(views[key](params)).catch((e) => toast(friendly(e)));
  }

  function updateNet() {
    $("#net").classList.toggle("hidden", navigator.onLine);
  }

  // ---------- Start ----------
  async function boot() {
    $("#back").onclick = () => { history.length > 1 ? history.back() : (location.hash = "#/home"); };
    window.addEventListener("hashchange", route);
    window.addEventListener("online", async () => {
      updateNet();
      const { sent } = await sendQueue();
      if (sent) toast(`${sent} waiting file(s) shared.`);
      if (location.hash === "#/home") views["/home"]();
    });
    window.addEventListener("offline", updateNet);
    updateNet();

    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) {
        profile = loadProfile();
        if (navigator.onLine) {
          try { await ensureProfile(data.session.user); } catch (_) { /* keep the saved profile */ }
        }
        if (!profile) profile = loadProfile();
      } else {
        localStorage.removeItem("pv_profile");
        profile = null;
      }
    } catch (_) {
      // Offline with a saved session: use the saved profile.
      profile = loadProfile();
    }

    if (!location.hash) location.hash = profile ? "#/home" : "#/login";
    route();
    if (profile && navigator.onLine) {
      const { sent } = await sendQueue();
      if (sent) toast(`${sent} waiting file(s) shared.`);
    }
  }

  boot();
})();
