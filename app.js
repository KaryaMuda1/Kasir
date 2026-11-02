(() => {
  "use strict";

  const STORAGE_KEY = "smart-kasir-data-v1";
  const AUTH_SESSION_KEY = "smart-kasir-user";
  const PASSWORD_ITERATIONS = 210000;
  const now = new Date();
  const sampleProducts = [
    { id: "p1", sku: "SKU-001", barcode: "899100100001", name: "Kopi Susu Gula Aren", category: "Minuman", price: 18000, cost: 9000, stock: 32, minStock: 8, emoji: "☕" },
    { id: "p2", sku: "SKU-002", barcode: "899100100002", name: "Matcha Latte", category: "Minuman", price: 22000, cost: 11000, stock: 18, minStock: 8, emoji: "🍵" },
    { id: "p3", sku: "SKU-003", barcode: "899100100003", name: "Croissant Butter", category: "Makanan", price: 16000, cost: 8500, stock: 4, minStock: 6, emoji: "🥐" },
    { id: "p4", sku: "SKU-004", barcode: "899100100004", name: "Roti Cokelat", category: "Makanan", price: 12000, cost: 5500, stock: 23, minStock: 6, emoji: "🥖" },
    { id: "p5", sku: "SKU-005", barcode: "899100100005", name: "Air Mineral 600ml", category: "Minuman", price: 6000, cost: 2500, stock: 3, minStock: 10, emoji: "💧" },
    { id: "p6", sku: "SKU-006", barcode: "899100100006", name: "Cookies Choco Chip", category: "Makanan", price: 14000, cost: 7000, stock: 16, minStock: 5, emoji: "🍪" },
    { id: "p7", sku: "SKU-007", barcode: "899100100007", name: "Es Teh Lemon", category: "Minuman", price: 12000, cost: 4500, stock: 28, minStock: 8, emoji: "🍋" },
    { id: "p8", sku: "SKU-008", barcode: "899100100008", name: "Sandwich Ayam", category: "Makanan", price: 25000, cost: 14500, stock: 12, minStock: 5, emoji: "🥪" }
  ];

  const initialState = () => ({
    products: sampleProducts,
    transactions: [],
    users: [],
    settings: { storeName: "SMART KASIR STORE", address: "Jl. Usaha Makmur No. 12, Jakarta", taxRate: 0, receiptWidth: "80" },
    inventoryLog: [],
    version: 1
  });

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return initialState();
      const parsed = JSON.parse(saved);
      if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.transactions)) throw new Error("Struktur data tidak valid.");
      return { ...initialState(), ...parsed, settings: { ...initialState().settings, ...parsed.settings } };
    } catch (error) {
      console.error("Gagal membaca data SMART KASIR dari browser.", error);
      return initialState();
    }
  }

  let state = loadState();
  let currentUser = null;
  let authError = "";
  let authEmail = "";
  let authBusy = false;
  let page = "dashboard";
  let cart = [];
  let cartDiscount = 0;
  let discountType = "nominal";
  let selectedCategory = "Semua";
  let reportPeriod = "today";
  let dashboardPeriod = "week";
  let transactionQuery = "";
  let transactionStatus = "";
  let transactionMethod = "";
  let transactionDate = "";
  let productQuery = "";
  let selectedProductIds = new Set();
  let paymentMethod = "cash";
  let scanStream = null;
  let scannerControls = null;

  const content = document.getElementById("page-content");
  const appShell = document.getElementById("app-shell");
  const authScreen = document.getElementById("auth-screen");
  const authContent = document.getElementById("auth-content");
  const modalBackdrop = document.getElementById("modal-backdrop");
  const modal = document.getElementById("modal");
  const rupiah = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0));
  const number = value => new Intl.NumberFormat("id-ID").format(Number(value) || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const dateText = value => new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  const todayKey = value => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
  const pageNames = { dashboard: "Dashboard", kasir: "Kasir", produk: "Produk", transaksi: "Transaksi", laporan: "Laporan", pengguna: "Pengguna" };

  function hasPasswordCredentials() {
    return state.users.some(user => user.passwordHash && user.passwordSalt && user.email);
  }

  function canAccessPage(nextPage, user = currentUser) {
    return Boolean(user && (user.role === "Admin" || ["kasir", "transaksi"].includes(nextPage)));
  }

  function requireAdmin() {
    if (currentUser?.role === "Admin") return true;
    toast("Fitur ini hanya dapat diakses oleh Admin.", true);
    return false;
  }

  function resolveSession() {
    try {
      const userId = sessionStorage.getItem(AUTH_SESSION_KEY);
      return state.users.find(user => user.id === userId && user.passwordHash && user.email) || null;
    } catch (error) {
      console.error("Sesi login tidak dapat dibaca.", error);
      return null;
    }
  }

  function bytesToHex(bytes) {
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, saltHex) {
    if (!window.crypto?.subtle) throw new Error("Browser ini belum menyediakan Web Crypto. Buka aplikasi melalui HTTPS atau localhost.");
    const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], byte => parseInt(byte, 16));
    const key = await window.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return bytesToHex(await window.crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256));
  }

  function makeSalt() {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return bytesToHex(bytes);
  }

  function setSession(user) {
    try {
      sessionStorage.setItem(AUTH_SESSION_KEY, user.id);
    } catch (error) {
      console.error("Sesi login tidak dapat disimpan.", error);
      throw new Error("Sesi tidak dapat dibuat. Periksa pengaturan penyimpanan browser.");
    }
    currentUser = user;
    authError = "";
    document.getElementById("sidebar").classList.remove("is-open");
    page = user.role === "Kasir" ? "kasir" : "dashboard";
    render();
  }

  function renderAuth() {
    const setup = !hasPasswordCredentials();
    authScreen.hidden = false;
    appShell.hidden = true;
    const heading = setup ? "Buat akun Admin" : "Selamat datang kembali";
    const description = setup
      ? "Buat akun Admin pertama untuk mengaktifkan login email SMART KASIR di browser ini."
      : "Masuk dengan email yang sudah didaftarkan untuk melanjutkan.";
    const fields = setup
      ? `<div class="field"><label for="auth-name">Nama Admin</label><input id="auth-name" name="name" autocomplete="name" maxlength="60" required></div><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(authEmail)}" required></div><div class="field"><label for="auth-password">Password (minimal 8 karakter)</label><input id="auth-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="field"><label for="auth-confirm">Ulangi password</label><input id="auth-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>`
      : `<div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="username" maxlength="254" value="${escapeHtml(authEmail)}" required></div><div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" maxlength="128" required></div>`;
    authContent.innerHTML = `<div class="auth-brand"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z"/><path d="M4 12.5 12 17l8-4.5M4 16.5l8 4.5 8-4.5"/></svg></span><span class="brand-copy"><strong>SMART <span>KASIR</span></strong><small>POINT OF SALE</small></span></div><div class="auth-copy"><h1>${heading}</h1><p>${description}</p></div><form class="auth-form" id="auth-form">${fields}<button class="btn btn-primary" type="submit" ${authBusy ? "disabled" : ""}>${authBusy ? "Memproses..." : setup ? "Buat akun Admin" : "Masuk"}</button></form>${authError ? `<p class="auth-error" role="alert">${escapeHtml(authError)}</p>` : ""}<p class="auth-note"><strong>Penyimpanan lokal:</strong> akun dan data hanya tersedia di browser/perangkat ini. Password di-hash, tetapi login lokal bukan pengganti autentikasi backend dan tidak menyinkronkan data antarperangkat.</p><p class="auth-foot">Jangan gunakan penyimpanan lokal ini sebagai sistem akses produksi.</p>`;
  }

  async function handleAuthSubmit(form) {
    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    authEmail = email;
    authBusy = true;
    renderAuth();
    try {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Masukkan alamat email yang valid.");
      if (!hasPasswordCredentials()) {
        const name = String(formData.get("name") || "").trim();
        if (!name || password.length < 8 || password.length > 128) throw new Error("Nama wajib diisi dan password harus 8 hingga 128 karakter.");
        if (password !== String(formData.get("confirmPassword") || "")) throw new Error("Konfirmasi password tidak cocok.");
        if (state.users.some(user => user.email?.toLowerCase() === email)) throw new Error("Email tersebut sudah terdaftar.");
        const salt = makeSalt();
        const user = { id: `u-${Date.now()}`, name, email, role: "Admin", passwordSalt: salt, passwordHash: await hashPassword(password, salt) };
        state.users = [user];
        persist();
        setSession(user);
      } else {
        const user = state.users.find(entry => entry.email?.toLowerCase() === email);
        if (!user || !user.passwordSalt || !user.passwordHash || await hashPassword(password, user.passwordSalt) !== user.passwordHash) throw new Error("Email atau password salah.");
        setSession(user);
      }
    } catch (error) {
      console.error("Proses autentikasi lokal gagal.", error);
      authError = error.message || "Tidak dapat memproses login.";
    } finally {
      authBusy = false;
      if (!currentUser) renderAuth();
    }
  }

  function logout() {
    if (cart.length && !window.confirm("Keluar akan mengosongkan keranjang. Lanjutkan?")) return;
    try {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
    } catch (error) {
      console.error("Sesi login tidak dapat dihapus.", error);
    }
    currentUser = null;
    cart = [];
    cartDiscount = 0;
    document.getElementById("sidebar").classList.remove("is-open");
    render();
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      document.querySelector(".connection").innerHTML = "<i></i> Tersimpan di perangkat";
    } catch (error) {
      console.error("Gagal menyimpan data SMART KASIR ke browser.", error);
      document.querySelector(".connection").textContent = "Gagal menyimpan";
      toast("Penyimpanan browser penuh atau tidak tersedia. Data belum tersimpan.", true);
    }
  }

  function toast(message, error = false) {
    const item = document.createElement("div");
    item.className = `toast${error ? " error" : ""}`;
    item.textContent = message;
    document.getElementById("toast-region").append(item);
    window.setTimeout(() => item.remove(), 3500);
  }

  function moneyInput(value = "") {
    return value === "" ? "" : number(String(value).replace(/\D/g, ""));
  }

  function navTo(nextPage) {
    if (!pageNames[nextPage]) return;
    if (!canAccessPage(nextPage)) {
      toast("Halaman ini tidak tersedia untuk peran akun Anda.", true);
      return;
    }
    if (page === "kasir" && nextPage !== "kasir" && cart.length && !window.confirm("Keranjang masih berisi produk. Tinggalkan halaman kasir dan kosongkan keranjang?")) return;
    if (page === "kasir" && nextPage !== "kasir") { cart = []; cartDiscount = 0; }
    page = nextPage;
    document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    document.getElementById("breadcrumb-current").textContent = pageNames[page];
    document.getElementById("sidebar").classList.remove("is-open");
    render();
  }

  function heading(title, description, actions = "") {
    return `<div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
  }

  function statCard(label, value, icon, foot, footClass = "") {
    return `<article class="card stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot"><span class="${footClass}">${foot}</span></div></article>`;
  }

  function statusPill(status) {
    const classes = { Lunas: "pill-success", "Belum lunas": "pill-warning", Dibatalkan: "pill-danger" };
    return `<span class="pill ${classes[status] || "pill-neutral"}">${escapeHtml(status || "Belum lunas")}</span>`;
  }

  function payLabel(method) {
    return ({ cash: "Tunai", transfer: "Transfer bank", qris: "QRIS", dana: "DANA", ovo: "OVO", gopay: "GoPay", shopeepay: "ShopeePay", debit: "Kartu debit", credit: "Kartu kredit" })[method] || method || "—";
  }

  function getSales(period = "today") {
    const current = new Date();
    const start = new Date(current);
    if (period === "today") start.setHours(0, 0, 0, 0);
    else if (period === "week") start.setDate(current.getDate() - 6);
    else start.setDate(1);
    return state.transactions.filter(tx => tx.status === "Lunas" && new Date(tx.createdAt) >= start && new Date(tx.createdAt) <= current);
  }

  function txTable(rows, showActions = false) {
    if (!rows.length) return `<div class="empty-state">Belum ada transaksi pada periode ini.</div>`;
    return `<div class="table-scroll"><table><thead><tr><th>NO. TRANSAKSI</th><th>TANGGAL & WAKTU</th><th>KASIR</th><th>PEMBAYARAN</th><th>TOTAL</th><th>STATUS</th>${showActions ? "<th>AKSI</th>" : ""}</tr></thead><tbody>${rows.map(tx => `<tr><td class="table-strong">${escapeHtml(tx.id)}</td><td>${escapeHtml(dateText(tx.createdAt))}</td><td>${escapeHtml(tx.cashier || "Kasir")}</td><td>${escapeHtml(payLabel(tx.method))}</td><td class="table-strong">${rupiah(tx.total)}</td><td>${statusPill(tx.status)}</td>${showActions ? `<td><button class="table-action" data-action="receipt" data-id="${escapeHtml(tx.id)}">Detail</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }

  function drawChart(canvas, series, labels) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, bounds.width * ratio);
    canvas.height = Math.max(1, bounds.height * ratio);
    ctx.scale(ratio, ratio);
    const width = bounds.width, height = bounds.height;
    const left = 44, right = 12, top = 12, bottom = 26;
    const graphWidth = width - left - right, graphHeight = height - top - bottom;
    const max = Math.max(1, ...series.map(point => point.value)) * 1.22;
    ctx.font = "9px DM Sans, sans-serif";
    for (let i = 0; i <= 3; i++) {
      const y = top + graphHeight * i / 3;
      ctx.beginPath(); ctx.strokeStyle = "#eef1f6"; ctx.lineWidth = 1; ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      ctx.fillStyle = "#99a2b0"; ctx.textAlign = "right";
      const amount = Math.round(max * (1 - i / 3));
      ctx.fillText(amount >= 1000000 ? `${(amount / 1000000).toFixed(1)}jt` : amount >= 1000 ? `${Math.round(amount / 1000)}rb` : String(amount), left - 7, y + 3);
    }
    const points = series.map((item, index) => ({ x: left + graphWidth * (series.length === 1 ? .5 : index / (series.length - 1)), y: top + graphHeight * (1 - item.value / max) }));
    if (points.length) {
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      if (points.length === 1) ctx.lineTo(points[0].x + .01, points[0].y);
      ctx.lineTo(points[points.length - 1].x, top + graphHeight); ctx.lineTo(points[0].x, top + graphHeight); ctx.closePath();
      const gradient = ctx.createLinearGradient(0, top, 0, top + graphHeight); gradient.addColorStop(0, "#3d76f622"); gradient.addColorStop(1, "#3d76f600"); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = "#477cf0"; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      points.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 3, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#477cf0"; ctx.lineWidth = 2; ctx.stroke(); });
    }
    ctx.fillStyle = "#98a1af"; ctx.textAlign = "center";
    labels.forEach((label, index) => { const x = left + graphWidth * (labels.length === 1 ? .5 : index / (labels.length - 1)); ctx.fillText(label, x, height - 6); });
  }

  function chartData(period) {
    const nowDate = new Date();
    if (period === "week") return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(nowDate); day.setDate(nowDate.getDate() - 6 + index);
      const key = todayKey(day);
      return { label: day.toLocaleDateString("id-ID", { weekday: "short" }), value: state.transactions.filter(tx => tx.status === "Lunas" && todayKey(tx.createdAt) === key).reduce((sum, tx) => sum + tx.total, 0) };
    });
    if (period === "month") return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(nowDate.getFullYear(), nowDate.getMonth() - 5 + index, 1);
      return { label: month.toLocaleDateString("id-ID", { month: "short" }), value: state.transactions.filter(tx => { const date = new Date(tx.createdAt); return tx.status === "Lunas" && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth(); }).reduce((sum, tx) => sum + tx.total, 0) };
    });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(nowDate); day.setDate(nowDate.getDate() - 6 + index);
      const key = todayKey(day);
      return { label: day.toLocaleDateString("id-ID", { day: "numeric", month: "short" }), value: state.transactions.filter(tx => tx.status === "Lunas" && todayKey(tx.createdAt) === key).reduce((sum, tx) => sum + tx.total, 0) };
    });
  }

  function renderDashboard() {
    const sales = getSales("today");
    const total = sales.reduce((sum, tx) => sum + tx.total, 0);
    const profit = sales.reduce((sum, tx) => sum + tx.items.reduce((subtotal, item) => subtotal + (item.price - item.cost) * item.qty, 0) - (tx.discount || 0), 0);
    const lowStock = state.products.filter(product => product.stock <= product.minStock);
    const best = new Map();
    sales.forEach(tx => tx.items.forEach(item => best.set(item.name, (best.get(item.name) || 0) + item.qty)));
    const bestRows = [...best].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const top = bestRows[0]?.[1] || 1;
    const warning = lowStock.length ? `<div class="alert-strip"><span>⚠ &nbsp;<strong>${lowStock.length} produk</strong> perlu restok: ${lowStock.slice(0, 3).map(item => escapeHtml(item.name)).join(", ")}${lowStock.length > 3 ? "…" : ""}</span><button class="table-action" data-page="produk">Lihat stok →</button></div>` : "";
    return `${heading("Dashboard", `Ringkasan aktivitas toko, ${new Date().toLocaleDateString("id-ID", { dateStyle: "full" })}`, `<button class="btn" data-action="export-report">↓ &nbsp;Unduh laporan</button><button class="btn btn-primary" data-page="kasir">＋ &nbsp;Transaksi baru</button>`)}
      <div class="storage-banner">Mode penyimpanan perangkat aktif. Data hanya tersedia di browser ini—belum tersambung ke database atau backend bersama.</div>${warning}
      <div class="stat-grid">${statCard("Penjualan hari ini", rupiah(total), "↗", `${sales.length} transaksi lunas`, "trend-up")}${statCard("Jumlah transaksi", number(sales.length), "▤", `${state.transactions.filter(tx => tx.status === "Belum lunas").length} pembayaran menunggu verifikasi`, "")}${statCard("Keuntungan kotor hari ini", rupiah(profit), "◈", "Harga jual dikurangi harga beli & diskon", "")}${statCard("Produk tersedia", number(state.products.reduce((sum, product) => sum + product.stock, 0)), "▦", `${lowStock.length} produk stok minimum`, lowStock.length ? "trend-warn" : "trend-up")}</div>
      <div class="dashboard-grid"><article class="card chart-card"><div class="card-header"><div><h2>Ringkasan penjualan</h2><p>Hanya pembayaran yang sudah lunas</p></div><select class="period-select" id="dashboard-period"><option value="week" ${dashboardPeriod === "week" ? "selected" : ""}>7 hari terakhir</option><option value="month" ${dashboardPeriod === "month" ? "selected" : ""}>6 bulan terakhir</option></select></div><div class="chart-wrap"><canvas id="sales-chart" aria-label="Grafik penjualan"></canvas></div></article>
      <article class="card"><div class="card-header"><div><h2>Produk terlaris hari ini</h2><p>Diurutkan berdasarkan jumlah terjual</p></div></div><div class="card-body">${bestRows.length ? `<div class="best-list">${bestRows.map(([name, qty]) => { const product = state.products.find(entry => entry.name === name); return `<div class="best-item"><span class="product-emoji">${escapeHtml(product?.emoji || "📦")}</span><div class="best-info"><strong>${escapeHtml(name)}</strong><div class="progress"><span style="width:${Math.max(8, qty / top * 100)}%"></span></div></div><span class="best-qty">${qty} terjual</span></div>`; }).join("")}</div>` : `<div class="empty-state">Belum ada produk terjual hari ini.</div>`}</div></article></div>
      <article class="card table-card"><div class="card-header"><div><h2>Transaksi terbaru</h2><p>Aktivitas penjualan terkini</p></div><button class="table-action" data-page="transaksi">Lihat semua →</button></div>${txTable(state.transactions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5), true)}</article>`;
  }

  function renderCashier() {
    const categories = ["Semua", ...new Set(state.products.map(product => product.category))];
    const filtered = state.products.filter(product => (selectedCategory === "Semua" || product.category === selectedCategory) && `${product.name} ${product.sku} ${product.barcode}`.toLowerCase().includes(productQuery.toLowerCase()));
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discount = Math.min(subtotal, discountType === "persen" ? Math.round(subtotal * Math.min(100, cartDiscount) / 100) : cartDiscount);
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * (Number(state.settings.taxRate) || 0) / 100);
    const total = taxable + tax;
    const payment = document.getElementById("payment-method")?.value || paymentMethod;
    paymentMethod = payment;
    const cash = Number(String(document.getElementById("cash-received")?.value || "").replace(/\D/g, "")) || 0;
    const cartHtml = cart.length ? cart.map(item => `<div class="cart-item"><span class="product-emoji">${escapeHtml(item.emoji)}</span><div class="cart-item-info"><strong>${escapeHtml(item.name)}</strong><small>${rupiah(item.price)} / item</small><div class="quantity-control"><button aria-label="Kurangi jumlah" data-action="qty-minus" data-id="${escapeHtml(item.id)}">−</button><span>${item.qty}</span><button aria-label="Tambah jumlah" data-action="qty-plus" data-id="${escapeHtml(item.id)}">+</button></div></div><div class="cart-item-right"><strong>${rupiah(item.price * item.qty)}</strong><button class="remove-item" data-action="cart-remove" data-id="${escapeHtml(item.id)}">Hapus</button></div></div>`).join("") : `<div class="cart-empty">🛍️<br><br>Keranjang masih kosong.<br>Pilih produk untuk memulai.</div>`;
    return `${heading("Kasir", "Pilih produk untuk memulai transaksi penjualan.", `<button class="btn" data-action="scan">▣ &nbsp;Pindai barcode</button>`)}
      <div class="pos-layout"><section class="card pos-catalog"><div class="pos-search-row"><label class="search-box">⌕ <input id="pos-search" autocomplete="off" placeholder="Cari nama, SKU, atau scan barcode..." value="${escapeHtml(productQuery)}"></label><button class="btn" data-action="scan" aria-label="Pindai barcode menggunakan kamera">▣</button></div><div class="toolbar" style="margin:12px 0 0">${categories.map(category => `<button class="btn btn-sm ${selectedCategory === category ? "btn-primary" : ""}" data-action="category" data-value="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div><div class="product-grid">${filtered.length ? filtered.map(product => `<button class="product-tile" data-action="add-cart" data-id="${escapeHtml(product.id)}" ${product.stock <= 0 ? "disabled" : ""}><span class="tile-emoji">${escapeHtml(product.emoji || "📦")}</span><span class="tile-name">${escapeHtml(product.name)}</span><span class="tile-price">${rupiah(product.price)}</span><span class="tile-stock">Stok ${number(product.stock)}${product.stock <= product.minStock ? " · Menipis" : ""}</span></button>`).join("") : `<div class="empty-state">Produk tidak ditemukan.</div>`}</div></section>
      <aside class="card cart-card"><div class="cart-head"><div class="cart-title"><h2>Keranjang belanja</h2><span class="cart-count">${cart.reduce((sum, item) => sum + item.qty, 0)}</span></div></div><div class="cart-items">${cartHtml}</div><div class="cart-summary"><div class="summary-row"><span>Subtotal</span><strong>${rupiah(subtotal)}</strong></div><div class="summary-row"><span>Diskon <span style="display:inline-flex;gap:4px" class="discount-row"><input id="discount-input" inputmode="numeric" placeholder="0" value="${cartDiscount || ""}" aria-label="Nominal diskon"><select id="discount-type" aria-label="Jenis diskon"><option value="nominal" ${discountType === "nominal" ? "selected" : ""}>Rp</option><option value="persen" ${discountType === "persen" ? "selected" : ""}>%</option></select></span></span><strong>− ${rupiah(discount)}</strong></div>${tax ? `<div class="summary-row"><span>Pajak (${escapeHtml(state.settings.taxRate)}%)</span><strong>${rupiah(tax)}</strong></div>` : ""}<div class="summary-row total"><span>Total</span><strong>${rupiah(total)}</strong></div><label class="cash-field">Metode pembayaran<select class="payment-select" id="payment-method"><option value="cash" ${payment === "cash" ? "selected" : ""}>Tunai (Cash)</option><option value="transfer" ${payment === "transfer" ? "selected" : ""}>Transfer bank</option><option value="qris" ${payment === "qris" ? "selected" : ""}>QRIS</option><option value="dana" ${payment === "dana" ? "selected" : ""}>DANA</option><option value="ovo" ${payment === "ovo" ? "selected" : ""}>OVO</option><option value="gopay" ${payment === "gopay" ? "selected" : ""}>GoPay</option><option value="shopeepay" ${payment === "shopeepay" ? "selected" : ""}>ShopeePay</option><option value="debit" ${payment === "debit" ? "selected" : ""}>Kartu debit</option><option value="credit" ${payment === "credit" ? "selected" : ""}>Kartu kredit</option></select></label>${payment === "cash" ? `<label class="cash-field">Uang diterima<input id="cash-received" inputmode="numeric" autocomplete="off" placeholder="Masukkan nominal uang" value="${moneyInput(document.getElementById("cash-received")?.value || "")}"><span id="change-due">Kembalian: ${rupiah(Math.max(0, cash - total))}</span></label>` : `<div class="payment-note">Pembayaran digital akan berstatus <strong>Belum lunas</strong> sampai diverifikasi melalui gateway resmi. Verifikasi produksi belum tersedia di aplikasi perangkat ini.</div>`}<button class="checkout-btn" data-action="checkout" ${!cart.length || (payment === "cash" && cash < total) ? "disabled" : ""}>${payment === "cash" ? "Selesaikan transaksi tunai" : "Catat sebagai belum lunas"}</button></div></aside></div>`;
  }

  function renderProducts() {
    const filtered = state.products.filter(product => `${product.name} ${product.sku} ${product.barcode} ${product.category}`.toLowerCase().includes(productQuery.toLowerCase()));
    return `${heading("Manajemen produk", "Stok otomatis berkurang sesuai jumlah barang setelah transaksi tunai lunas.", `<button class="btn" data-action="export-stock">↓ &nbsp;Ekspor stok</button><button class="btn" data-action="print-selected-barcodes" ${selectedProductIds.size ? "" : "disabled"}>▤ &nbsp;Cetak barcode${selectedProductIds.size ? ` (${selectedProductIds.size})` : ""}</button><button class="btn btn-primary" data-action="product-new">＋ &nbsp;Tambah produk</button>`)}
      <div class="toolbar"><label class="search-box">⌕ <input id="product-search" placeholder="Cari nama, SKU, barcode, atau kategori..." value="${escapeHtml(productQuery)}"></label><span class="btn">▦ &nbsp;${number(state.products.length)} produk</span></div>
      <article class="card table-card"><div class="table-scroll"><table><thead><tr><th>PILIH</th><th>PRODUK</th><th>SKU / BARCODE</th><th>KATEGORI</th><th>HARGA JUAL</th><th>HARGA BELI</th><th>STOK</th><th>STATUS STOK</th><th>AKSI</th></tr></thead><tbody>${filtered.length ? filtered.map(product => `<tr><td><input type="checkbox" aria-label="Pilih barcode ${escapeHtml(product.name)}" data-action="select-barcode" data-id="${escapeHtml(product.id)}" ${selectedProductIds.has(product.id) ? "checked" : ""}></td><td><span class="table-strong">${escapeHtml(product.emoji || "📦")} &nbsp;${escapeHtml(product.name)}</span></td><td>${escapeHtml(product.sku)}<br><span class="muted">${escapeHtml(product.barcode || "—")}</span></td><td>${escapeHtml(product.category)}</td><td>${rupiah(product.price)}</td><td>${rupiah(product.cost)}</td><td class="${product.stock <= product.minStock ? "stock-low" : ""}">${number(product.stock)}</td><td>${product.stock <= product.minStock ? `<span class="pill pill-warning">Stok menipis</span>` : `<span class="pill pill-success">Tersedia</span>`}</td><td><button class="table-action" data-action="product-edit" data-id="${escapeHtml(product.id)}">Edit</button><button class="table-action" style="color:#4777e4" data-action="print-product-barcode" data-id="${escapeHtml(product.id)}">Barcode</button><button class="table-action" style="color:#d2555d" data-action="product-delete" data-id="${escapeHtml(product.id)}"> Hapus</button></td></tr>`).join("") : `<tr><td colspan="9"><div class="empty-state">Produk tidak ditemukan.</div></td></tr>`}</tbody></table></div></article>
      <article class="card table-card" style="margin-top:15px"><div class="card-header"><div><h2>Riwayat perubahan stok</h2><p>Penyesuaian manual dan penjualan yang tercatat</p></div></div>${state.inventoryLog?.length ? `<div class="table-scroll"><table><thead><tr><th>TANGGAL</th><th>PRODUK</th><th>STOK SEBELUM</th><th>STOK SESUDAH</th><th>KETERANGAN</th></tr></thead><tbody>${state.inventoryLog.slice().reverse().slice(0, 10).map(log => `<tr><td>${escapeHtml(dateText(log.date))}</td><td class="table-strong">${escapeHtml(log.name)}</td><td>${number(log.before)}</td><td>${number(log.after)}</td><td>${escapeHtml(log.source)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Perubahan stok akan muncul setelah transaksi lunas atau penyesuaian manual.</div>`}</article>
      <div class="storage-banner" style="margin-top:13px">Perubahan stok dari transaksi lunas dicatat otomatis. Transaksi digital yang belum diverifikasi tidak mengurangi stok.</div>`;
  }

  function renderTransactions() {
    const rows = state.transactions.filter(tx => (!transactionStatus || tx.status === transactionStatus) && (!transactionMethod || tx.method === transactionMethod) && (!transactionDate || todayKey(tx.createdAt) === transactionDate) && `${tx.id} ${tx.cashier} ${payLabel(tx.method)}`.toLowerCase().includes(transactionQuery.toLowerCase())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return `${heading("Riwayat transaksi", "Cari transaksi, periksa status pembayaran, dan cetak ulang struk.", `<button class="btn btn-primary" data-page="kasir">＋ &nbsp;Transaksi baru</button>`)}
      <div class="toolbar"><label class="search-box">⌕ <input id="transaction-search" placeholder="Cari nomor transaksi atau kasir..." value="${escapeHtml(transactionQuery)}"></label><input id="transaction-date" class="form-select filter-date" type="date" aria-label="Filter tanggal" value="${escapeHtml(transactionDate)}"><select class="form-select" id="transaction-method"><option value="">Semua pembayaran</option>${[["cash","Tunai"],["transfer","Transfer bank"],["qris","QRIS"],["dana","DANA"],["ovo","OVO"],["gopay","GoPay"],["shopeepay","ShopeePay"],["debit","Kartu debit"],["credit","Kartu kredit"]].map(([value,label]) => `<option value="${value}" ${transactionMethod === value ? "selected" : ""}>${label}</option>`).join("")}</select><select class="form-select" id="transaction-status"><option value="">Semua status</option><option value="Lunas" ${transactionStatus === "Lunas" ? "selected" : ""}>Lunas</option><option value="Belum lunas" ${transactionStatus === "Belum lunas" ? "selected" : ""}>Belum lunas</option><option value="Dibatalkan" ${transactionStatus === "Dibatalkan" ? "selected" : ""}>Dibatalkan</option></select><span class="btn">${rows.length} transaksi</span></div>
      <article class="card table-card">${rows.length ? `<div class="table-scroll"><table><thead><tr><th>NO. TRANSAKSI</th><th>TANGGAL & WAKTU</th><th>KASIR</th><th>PRODUK</th><th>PEMBAYARAN</th><th>TOTAL</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${rows.map(tx => `<tr><td class="table-strong">${escapeHtml(tx.id)}</td><td>${escapeHtml(dateText(tx.createdAt))}</td><td>${escapeHtml(tx.cashier)}</td><td>${number(tx.items.reduce((sum, item) => sum + item.qty, 0))} item</td><td>${escapeHtml(payLabel(tx.method))}</td><td class="table-strong">${rupiah(tx.total)}</td><td>${statusPill(tx.status)}</td><td><button class="table-action" data-action="receipt" data-id="${escapeHtml(tx.id)}">Detail / struk</button>${tx.status === "Belum lunas" ? `<button class="table-action" style="color:#d2555d" data-action="cancel-tx" data-id="${escapeHtml(tx.id)}">Batalkan</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Transaksi tidak ditemukan. Transaksi baru akan tampil di sini.</div>`}</article>
      <div class="storage-banner" style="margin-top:13px">Status lunas hanya untuk pembayaran tunai yang terkonfirmasi. Pembayaran digital tetap belum lunas sampai diverifikasi oleh payment gateway/backend—fitur gateway produksi belum dikonfigurasi.</div>`;
  }

  function renderReports() {
    const allPeriods = { today: "Hari ini", week: "7 hari terakhir", month: "Bulan ini", all: "Semua transaksi" };
    const matching = state.transactions.filter(tx => {
      if (tx.status !== "Lunas") return false;
      if (reportPeriod === "all") return true;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      if (reportPeriod === "week") start.setDate(start.getDate() - 6);
      if (reportPeriod === "month") start.setDate(1);
      return new Date(tx.createdAt) >= start;
    });
    const total = matching.reduce((sum, tx) => sum + tx.total, 0);
    const capital = matching.reduce((sum, tx) => sum + tx.items.reduce((value, item) => value + (Number(item.cost) || 0) * item.qty, 0), 0);
    const profit = matching.reduce((sum, tx) => sum + tx.items.reduce((value, item) => value + (item.price - item.cost) * item.qty, 0) - (tx.discount || 0), 0);
    const count = matching.reduce((sum, tx) => sum + tx.items.reduce((value, item) => value + item.qty, 0), 0);
    const productTotals = new Map(), methods = new Map();
    matching.forEach(tx => { methods.set(payLabel(tx.method), (methods.get(payLabel(tx.method)) || 0) + tx.total); tx.items.forEach(item => productTotals.set(item.name, (productTotals.get(item.name) || 0) + item.qty)); });
    const products = [...productTotals].sort((a, b) => b[1] - a[1]);
    const payments = [...methods].sort((a, b) => b[1] - a[1]);
    return `${heading("Laporan keuangan", "Laporan dihitung dari transaksi berstatus lunas saja.", `<button class="btn" data-action="export-report">↓ &nbsp;Ekspor CSV / Excel</button><button class="btn btn-primary" data-action="print-report">▤ &nbsp;Cetak / PDF</button>`)}
      <div class="toolbar"><select id="report-period" class="form-select">${Object.entries(allPeriods).map(([key, label]) => `<option value="${key}" ${reportPeriod === key ? "selected" : ""}>${label}</option>`).join("")}</select><span class="btn">${matching.length} transaksi lunas</span></div>
      <div class="report-summary"><article class="card report-card"><small>Total penjualan</small><strong>${rupiah(total)}</strong></article><article class="card report-card"><small>Total Modal / HPP</small><strong>${rupiah(capital)}</strong></article><article class="card report-card"><small>Estimasi keuntungan</small><strong>${rupiah(profit)}</strong></article><article class="card report-card"><small>Produk terjual</small><strong>${number(count)} item</strong></article></div>
      <div class="dashboard-grid"><article class="card table-card"><div class="card-header"><div><h2>Produk terlaris</h2><p>Jumlah item terjual pada periode terpilih</p></div></div>${products.length ? `<div class="table-scroll"><table><thead><tr><th>PRODUK</th><th>JUMLAH TERJUAL</th><th>KATEGORI</th></tr></thead><tbody>${products.map(([name, qty]) => `<tr><td class="table-strong">${escapeHtml(name)}</td><td>${qty}</td><td>${escapeHtml(state.products.find(item => item.name === name)?.category || "—")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Belum ada penjualan lunas pada periode ini.</div>`}</article>
      <article class="card table-card"><div class="card-header"><div><h2>Penjualan per metode</h2><p>Nominal pembayaran terverifikasi</p></div></div>${payments.length ? `<div class="table-scroll"><table><thead><tr><th>METODE</th><th>TOTAL</th></tr></thead><tbody>${payments.map(([name, amount]) => `<tr><td class="table-strong">${escapeHtml(name)}</td><td>${rupiah(amount)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Belum ada data pembayaran.</div>`}</article></div>
      <article class="card table-card" style="margin-top:15px"><div class="card-header"><div><h2>Ringkasan stok</h2><p>Stok saat ini dibandingkan batas minimum setiap produk</p></div><button class="table-action" data-action="export-stock">Unduh stok →</button></div><div class="table-scroll"><table><thead><tr><th>PRODUK</th><th>SKU</th><th>STOK TERSEDIA</th><th>BATAS MINIMUM</th><th>STATUS</th></tr></thead><tbody>${state.products.map(product => `<tr><td class="table-strong">${escapeHtml(product.name)}</td><td>${escapeHtml(product.sku)}</td><td>${number(product.stock)}</td><td>${number(product.minStock)}</td><td>${product.stock <= product.minStock ? `<span class="pill pill-warning">Perlu restok</span>` : `<span class="pill pill-success">Aman</span>`}</td></tr>`).join("")}</tbody></table></div></article>`;
  }

  function renderUsers() {
    return `${heading("Pengguna & pengaturan", "Kelola profil kasir, informasi toko, dan format struk.")}
      <div class="storage-banner">Login email dan peran tersimpan hanya di browser ini. Kasir hanya dapat membuka menu Kasir dan Transaksi. Batas akses lokal bukan keamanan backend; data tidak tersinkron ke perangkat lain.</div>
      <div class="settings-grid"><article class="card"><div class="card-header"><div><h2>Informasi toko & struk</h2><p>Informasi yang tercetak pada bukti transaksi</p></div></div><form class="settings-form" id="settings-form"><div class="field"><label for="store-name">Nama toko</label><input id="store-name" name="storeName" required value="${escapeHtml(state.settings.storeName)}"></div><div class="field"><label for="store-address">Alamat toko</label><input id="store-address" name="address" required value="${escapeHtml(state.settings.address)}"></div><div class="field"><label for="tax-rate">Pajak (%)</label><input id="tax-rate" name="taxRate" type="number" min="0" max="100" step="0.1" value="${escapeHtml(state.settings.taxRate)}"><small class="form-hint">Diterapkan pada transaksi kasir baru. Pajak default 0%.</small></div><div class="field"><label for="receipt-width">Lebar struk thermal</label><select id="receipt-width" name="receiptWidth"><option value="58" ${state.settings.receiptWidth === "58" ? "selected" : ""}>58 mm</option><option value="80" ${state.settings.receiptWidth === "80" ? "selected" : ""}>80 mm</option></select></div><button class="btn btn-primary" type="submit">Simpan pengaturan toko</button></form></article>
      <article class="card"><div class="card-header"><div><h2>Akun Admin & Kasir</h2><p>Masuk menggunakan alamat email dan password</p></div><button class="btn btn-primary btn-sm" data-action="user-new">＋ Tambah kasir</button></div><div class="table-scroll"><table><thead><tr><th>NAMA</th><th>EMAIL</th><th>PERAN</th><th>AKSI</th></tr></thead><tbody>${state.users.map(user => `<tr><td class="table-strong">${escapeHtml(user.name)}</td><td>${escapeHtml(user.email || "—")}</td><td><span class="pill pill-neutral">${escapeHtml(user.role)}</span></td><td>${user.id !== currentUser.id && user.role !== "Admin" ? `<button class="table-action" style="color:#d2555d" data-action="user-delete" data-id="${escapeHtml(user.id)}">Hapus</button>` : user.id === currentUser.id ? `<span class="muted">Akun Anda</span>` : `<span class="muted">Admin</span>`}</td></tr>`).join("")}</tbody></table></div><div class="card-body"><button class="btn" data-action="backup-export">↓ &nbsp;Cadangkan data JSON</button><button style="margin-left:7px" class="btn" data-action="backup-import">↑ &nbsp;Pulihkan cadangan</button></div></article></div>`;
  }

  function render() {
    currentUser = resolveSession();
    if (!currentUser) {
      renderAuth();
      return;
    }
    if (!canAccessPage(page)) page = currentUser.role === "Kasir" ? "kasir" : "dashboard";
    authScreen.hidden = true;
    appShell.hidden = false;
    document.querySelectorAll(".navigation .nav-link").forEach(button => { button.hidden = !canAccessPage(button.dataset.page); });
    document.getElementById("topbar-date").textContent = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    document.getElementById("sidebar-user").textContent = currentUser.name;
    document.getElementById("sidebar-role").textContent = currentUser.role === "Admin" ? "Administrator" : currentUser.role;
    document.querySelector(".top-avatar").textContent = currentUser.name.trim().charAt(0).toUpperCase();
    document.querySelector(".connection").innerHTML = "<i></i> Tersimpan di perangkat";
    document.querySelector(".navigation .nav-link.active")?.classList.remove("active");
    document.querySelector(`.navigation .nav-link[data-page="${page}"]`)?.classList.add("active");
    document.getElementById("breadcrumb-current").textContent = pageNames[page];
    content.innerHTML = ({ dashboard: renderDashboard, kasir: renderCashier, produk: renderProducts, transaksi: renderTransactions, laporan: renderReports, pengguna: renderUsers })[page]();
    if (page === "dashboard") requestAnimationFrame(() => drawChart(document.getElementById("sales-chart"), chartData(dashboardPeriod).map(item => ({ value: item.value })), chartData(dashboardPeriod).map(item => item.label)));
  }

  function showModal(title, body, onSubmit, submitLabel = "Simpan") {
    modal.innerHTML = `<form id="modal-form"><header class="modal-header"><h2 id="modal-title">${escapeHtml(title)}</h2><button class="close-modal" type="button" aria-label="Tutup" data-action="close-modal">×</button></header><div class="modal-body">${body}</div><footer class="modal-footer"><button class="btn" type="button" data-action="close-modal">Batal</button><button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button></footer></form>`;
    modalBackdrop.hidden = false;
    modal.querySelector("input")?.focus();
    modal.querySelector("form").addEventListener("submit", event => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); });
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    if (scanStream) { scanStream.getTracks().forEach(track => track.stop()); scanStream = null; }
    if (scannerControls) { scannerControls.stop(); scannerControls = null; }
  }

  function handleProductSubmit(data, existing) {
    const values = {
      name: String(data.get("name") || "").trim(),
      sku: String(data.get("sku") || "").trim(),
      barcode: String(data.get("barcode") || "").trim(),
      category: String(data.get("category") || "").trim(),
      price: Number(data.get("price")),
      cost: Number(data.get("cost")),
      stock: Number(data.get("stock")),
      minStock: Number(data.get("minStock")),
      emoji: String(data.get("emoji") || "📦").trim().slice(0, 4)
    };
    if (!values.name || !values.sku || !values.category || !Number.isFinite(values.price) || values.price < 0 || !Number.isFinite(values.cost) || values.cost < 0 || !Number.isInteger(values.stock) || values.stock < 0 || !Number.isInteger(values.minStock) || values.minStock < 0) { toast("Periksa kembali nama, SKU, kategori, harga, dan stok.", true); return; }
    if (state.products.some(product => product.id !== existing?.id && product.sku.toLowerCase() === values.sku.toLowerCase())) { toast("SKU sudah digunakan produk lain.", true); return; }
    const priorStock = existing?.stock;
    if (existing) Object.assign(existing, values);
    else { values.id = `p-${Date.now()}`; state.products.push(values); }
    if (existing && priorStock !== values.stock) state.inventoryLog.push({ date: new Date().toISOString(), productId: existing.id, name: values.name, before: priorStock, after: values.stock, source: "Penyesuaian manual" });
    persist(); closeModal(); render(); toast(existing ? "Produk berhasil diperbarui." : "Produk berhasil ditambahkan.");
  }

  function productModal(existing) {
    const value = (key, fallback = "") => escapeHtml(existing?.[key] ?? fallback);
    const body = `<div class="field"><label>Nama produk *</label><input name="name" required maxlength="80" value="${value("name")}"></div><div class="field"><label>Kategori *</label><input name="category" required maxlength="40" value="${value("category")}"></div><div class="field"><label>SKU *</label><input name="sku" required maxlength="40" value="${value("sku")}"></div><div class="field"><label>Barcode</label><input name="barcode" maxlength="60" value="${value("barcode")}"></div><div class="settings-grid" style="gap:9px"><div class="field"><label>Harga jual (Rp) *</label><input name="price" type="number" min="0" step="1" required value="${value("price")}"></div><div class="field"><label>Harga beli (Rp) *</label><input name="cost" type="number" min="0" step="1" required value="${value("cost")}"></div><div class="field"><label>Stok *</label><input name="stock" type="number" min="0" step="1" required value="${value("stock", "0")}"></div><div class="field"><label>Stok minimum *</label><input name="minStock" type="number" min="0" step="1" required value="${value("minStock", "5")}"></div></div><div class="field"><label>Emoji produk</label><input name="emoji" maxlength="4" value="${value("emoji", "📦")}"></div>`;
    showModal(existing ? "Edit produk" : "Tambah produk", body, data => handleProductSubmit(data, existing));
  }

  function recordInventory(product, delta, source) {
    if (!delta) return;
    const before = product.stock;
    product.stock += delta;
    state.inventoryLog.push({ date: new Date().toISOString(), productId: product.id, name: product.name, before, after: product.stock, source });
  }

  function checkout() {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    const discount = Math.min(subtotal, discountType === "persen" ? Math.round(subtotal * Math.min(100, cartDiscount) / 100) : cartDiscount);
    const tax = Math.round((subtotal - discount) * (Number(state.settings.taxRate) || 0) / 100);
    const total = subtotal - discount + tax;
    const method = document.getElementById("payment-method").value;
    paymentMethod = method;
    const cash = Number(String(document.getElementById("cash-received")?.value || "").replace(/\D/g, "")) || 0;
    if (!cart.length) return;
    for (const item of cart) {
      const product = state.products.find(entry => entry.id === item.id);
      if (!product || product.stock < item.qty) { toast(`Stok ${item.name} tidak mencukupi.`, true); render(); return; }
    }
    if (method === "cash" && cash < total) { toast("Uang yang diterima kurang dari total pembayaran.", true); return; }
    const transaction = {
      id: `SK-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-6)}`,
      createdAt: new Date().toISOString(),
      cashier: currentUser.name,
      method,
      status: method === "cash" ? "Lunas" : "Belum lunas",
      items: cart.map(item => { const product = state.products.find(entry => entry.id === item.id); return { id: item.id, name: item.name, sku: item.sku, emoji: item.emoji, qty: item.qty, price: item.price, cost: product.cost }; }),
      subtotal, discount, tax, total,
      amountReceived: method === "cash" ? cash : 0,
      change: method === "cash" ? cash - total : 0,
      paymentReference: null
    };
    if (transaction.status === "Lunas") transaction.items.forEach(item => { const product = state.products.find(entry => entry.id === item.id); recordInventory(product, -item.qty, `Penjualan ${transaction.id}`); });
    state.transactions.push(transaction);
    paymentMethod = "cash";
    persist(); cart = []; cartDiscount = 0; closeModal(); navTo("transaksi");
    if (transaction.status === "Lunas") receiptModal(transaction);
    else { toast("Transaksi dicatat sebagai BELUM LUNAS. Stok belum berubah."); render(); }
  }

  function receiptMarkup(tx) {
    return `<div class="receipt" data-paper="${escapeHtml(state.settings.receiptWidth)}"><h2>${escapeHtml(state.settings.storeName)}</h2><p>${escapeHtml(state.settings.address)}</p><hr><div class="receipt-row"><span>No. transaksi</span><strong>${escapeHtml(tx.id)}</strong></div><div class="receipt-row"><span>Tanggal</span><span>${escapeHtml(dateText(tx.createdAt))}</span></div><div class="receipt-row"><span>Kasir</span><span>${escapeHtml(tx.cashier)}</span></div><hr><div class="receipt-items">${tx.items.map(item => `<div class="receipt-item"><div class="receipt-item-title">${escapeHtml(item.name)}</div><div class="receipt-item-detail"><span>${item.qty} × ${rupiah(item.price)}</span><span>${rupiah(item.qty * item.price)}</span></div></div>`).join("")}</div><hr><div class="receipt-row"><span>Subtotal</span><span>${rupiah(tx.subtotal)}</span></div>${tx.discount ? `<div class="receipt-row"><span>Diskon</span><span>− ${rupiah(tx.discount)}</span></div>` : ""}${tx.tax ? `<div class="receipt-row"><span>Pajak</span><span>${rupiah(tx.tax)}</span></div>` : ""}<div class="receipt-row"><strong>TOTAL</strong><strong>${rupiah(tx.total)}</strong></div><hr><div class="receipt-row"><span>Pembayaran</span><span>${escapeHtml(payLabel(tx.method))}</span></div><div class="receipt-row"><span>Status</span><strong>${escapeHtml(tx.status)}</strong></div>${tx.method === "cash" ? `<div class="receipt-row"><span>Uang diterima</span><span>${rupiah(tx.amountReceived)}</span></div><div class="receipt-row"><span>Kembalian</span><span>${rupiah(tx.change)}</span></div>` : `<div class="receipt-row"><span>Verifikasi</span><span>Menunggu gateway</span></div>`}<hr><p class="receipt-thanks">Terima kasih atas kunjungan Anda!<br>Sampai jumpa kembali 🙏</p></div>`;
  }

  function receiptModal(tx) {
    const width = escapeHtml(state.settings.receiptWidth);
    const canPrint = tx.status === "Lunas";
    modal.innerHTML = `<header class="modal-header"><h2 id="modal-title">Bukti transaksi</h2><button class="close-modal" aria-label="Tutup" data-action="close-modal">×</button></header><div class="modal-body"><div class="storage-banner">Status pembayaran: <strong>${escapeHtml(tx.status)}</strong>${tx.status === "Belum lunas" ? " — struk lunas tidak tersedia." : ""}</div><div class="receipt-print-root">${receiptMarkup(tx)}</div></div><footer class="modal-footer"><button class="btn" data-action="close-modal">Tutup</button><button class="btn btn-primary" data-action="print-receipt" data-id="${escapeHtml(tx.id)}" data-width="${width}" ${canPrint ? "" : "disabled"}>▤ &nbsp;Cetak / simpan PDF</button></footer>`;
    modalBackdrop.hidden = false;
  }

  function csvDownload(filename, rows) {
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`File ${filename} berhasil diunduh.`);
  }

  function exportReport() {
    csvDownload("laporan-smart-kasir.csv", [
      ["Nomor transaksi", "Tanggal", "Kasir", "Metode", "Status", "Subtotal", "Diskon", "Pajak", "Total", "Produk", "Qty", "HPP item"],
      ...state.transactions.flatMap(tx => tx.items.map(item => [tx.id, dateText(tx.createdAt), tx.cashier, payLabel(tx.method), tx.status, tx.subtotal, tx.discount, tx.tax || 0, tx.total, item.name, item.qty, (Number(item.cost) || 0) * item.qty]))
    ]);
  }

  function exportStock() {
    csvDownload("stok-smart-kasir.csv", [["Nama", "Kategori", "SKU", "Barcode", "Harga jual", "Harga beli", "Stok", "Stok minimum"], ...state.products.map(product => [product.name, product.category, product.sku, product.barcode, product.price, product.cost, product.stock, product.minStock])]);
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString(), schema: "SMART-KASIR-BACKUP-1" }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `backup-smart-kasir-${todayKey(new Date())}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); toast("Cadangan data berhasil diunduh.");
  }

  function importBackup() {
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = "application/json,.json";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0]; if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed.products) || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.users) || !parsed.settings) throw new Error("File cadangan tidak memiliki struktur SMART KASIR yang valid.");
        if (!window.confirm("Pulihkan data dari file ini? Data saat ini pada browser akan digantikan.")) return;
        state = { ...initialState(), ...parsed }; persist(); render(); toast("Cadangan data berhasil dipulihkan.");
      } catch (error) { console.error("Gagal memulihkan cadangan.", error); toast(error.message || "File cadangan tidak dapat dibaca.", true); }
    });
    picker.click();
  }

  const code39Patterns = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
    "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw",
    C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn",
    G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
    K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
    O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn",
    S: "nnwnnnwwn", T: "nnnnwnwwn", U: "wwnnnnnnw", V: "nwwnnnnnw",
    W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
    "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn",
    "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn"
  };

  function barcodeValue(product) {
    const barcode = String(product.barcode || "").trim();
    const candidate = barcode || product.sku;
    const normalized = String(candidate || "").toUpperCase();
    if (normalized.length > 40 || !normalized || [...normalized].some(char => !code39Patterns[char] || char === "*")) {
      throw new Error(`Barcode/SKU "${product.barcode || product.sku}" tidak didukung. Gunakan angka, huruf A–Z, spasi, atau karakter - . $ / + %.`);
    }
    return normalized;
  }

  function barcodeSvg(value) {
    const encoded = `*${value}*`;
    const narrow = 2, wide = 5, gap = 2, quiet = 12, barHeight = 58;
    let x = quiet;
    const bars = [];
    for (const char of encoded) {
      const pattern = code39Patterns[char];
      for (let index = 0; index < pattern.length; index++) {
        const width = pattern[index] === "w" ? wide : narrow;
        if (index % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="${barHeight}"/>`);
        x += width;
      }
      x += gap;
    }
    const width = x - gap + quiet;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="barcode-svg" viewBox="0 0 ${width} ${barHeight}" role="img" aria-label="Barcode ${escapeHtml(value)}"><rect width="${width}" height="${barHeight}" fill="white"/>${bars.join("")}</svg>`;
  }

  function printBarcodeLabels(ids) {
    const products = ids.map(id => state.products.find(product => product.id === id)).filter(Boolean);
    if (!products.length) { toast("Pilih setidaknya satu produk untuk mencetak barcode.", true); return; }
    try {
      const labels = products.map(product => {
        const value = barcodeValue(product);
        return `<article class="barcode-label">${barcodeSvg(value)}<strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(value)}</span></article>`;
      }).join("");
      modal.innerHTML = `<header class="modal-header"><h2 id="modal-title">Cetak barcode produk</h2><button class="close-modal" aria-label="Tutup" data-action="close-modal">×</button></header><div class="modal-body"><p class="form-hint">Barcode Code 39 dibuat dari SKU/barcode produk. Cetak menggunakan kertas A4, lalu potong sesuai garis putus-putus.</p><div class="barcode-print-root">${labels}</div></div><footer class="modal-footer"><button class="btn" data-action="close-modal">Batal</button><button class="btn btn-primary" data-action="print-barcodes">▤ &nbsp;Cetak ${products.length} label</button></footer>`;
      modalBackdrop.hidden = false;
    } catch (error) {
      toast(error.message, true);
    }
  }

  function findScannedProduct(rawValue) {
    const code = String(rawValue || "").trim().replace(/^\*|\*$/g, "");
    const normalized = code.toLowerCase();
    return state.products.find(product => String(product.barcode || "").trim().toLowerCase() === normalized || String(product.sku || "").trim().toLowerCase() === normalized);
  }

  function handleScannedCode(rawValue) {
    const code = String(rawValue || "").trim().replace(/^\*|\*$/g, "");
    const product = findScannedProduct(code);
    if (!product) {
      const hint = document.getElementById("scanner-hint");
      if (hint) hint.textContent = `Barcode ${code} tidak ditemukan di produk. Coba lagi atau periksa nilai SKU/barcode di menu Produk.`;
      return false;
    }
    closeModal();
    addToCart(product);
    return true;
  }

  function loadZxingBrowser() {
    if (window.ZXingBrowser?.BrowserMultiFormatReader) return Promise.resolve(window.ZXingBrowser);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-zxing-browser="true"]');
      if (existing) {
        existing.addEventListener("load", () => window.ZXingBrowser?.BrowserMultiFormatReader ? resolve(window.ZXingBrowser) : reject(new Error("Pustaka scanner gagal dimuat.")), { once: true });
        existing.addEventListener("error", () => reject(new Error("Pustaka scanner tidak dapat diunduh. Periksa koneksi internet.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
      script.async = true;
      script.dataset.zxingBrowser = "true";
      script.onload = () => window.ZXingBrowser?.BrowserMultiFormatReader ? resolve(window.ZXingBrowser) : reject(new Error("Browser tidak mendukung pemindai barcode alternatif."));
      script.onerror = () => reject(new Error("Pustaka scanner tidak dapat diunduh. Periksa koneksi internet."));
      document.head.append(script);
    });
  }

  function showScanner() {
    modal.innerHTML = `<header class="modal-header"><h2 id="modal-title">Scan barcode dengan kamera HP</h2><button class="close-modal" aria-label="Tutup" data-action="close-modal">×</button></header><div class="modal-body"><div class="scanner-frame"><video id="scanner-video" playsinline muted></video><span class="scanner-target" aria-hidden="true"></span></div><div class="form-hint" id="scanner-hint">Meminta izin kamera belakang. Arahkan barcode barang ke kotak pemindai.</div><form id="scan-code-form" class="scanner-manual"><input name="code" autocomplete="off" placeholder="Atau masukkan barcode / SKU manual" aria-label="Masukkan barcode atau SKU"><button class="btn" type="submit">Cari</button></form><p class="form-hint">Untuk memakai kamera HP, buka aplikasi melalui alamat HTTPS. Kamera memerlukan izin browser dan barcode harus terdaftar pada data produk.</p></div>`;
    modalBackdrop.hidden = false;
  }

  function startScanner() {
    showScanner();
    const video = document.getElementById("scanner-video");
    const hint = document.getElementById("scanner-hint");
    if (!navigator.mediaDevices?.getUserMedia) {
      hint.textContent = "Kamera tidak tersedia. Buka aplikasi melalui HTTPS pada browser HP, atau masukkan barcode/SKU secara manual.";
      return;
    }
    if (!window.isSecureContext) {
      hint.textContent = "Browser memblokir kamera pada halaman non-HTTPS. Buka aplikasi melalui alamat HTTPS, lalu izinkan akses kamera.";
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }).then(async stream => {
      if (!video.isConnected) { stream.getTracks().forEach(track => track.stop()); return; }
      scanStream = stream;
      video.srcObject = stream;
      await video.play();
      if ("BarcodeDetector" in window) {
        try {
          const available = typeof window.BarcodeDetector.getSupportedFormats === "function" ? await window.BarcodeDetector.getSupportedFormats() : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];
          const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"].filter(format => available.includes(format));
          if (!formats.length) throw new Error("Format barcode tidak didukung.");
          const detector = new window.BarcodeDetector({ formats });
          hint.textContent = "Kamera aktif. Arahkan barcode agar terlihat jelas di dalam kotak.";
          const scan = async () => {
            if (!scanStream || !video.isConnected) return;
            try {
              const codes = await detector.detect(video);
              if (codes.length && handleScannedCode(codes[0].rawValue)) return;
            } catch (error) {
              if (document.getElementById("scanner-hint")) document.getElementById("scanner-hint").textContent = "Barcode belum terbaca. Jaga kamera tetap fokus dan pastikan barcode terang.";
            }
            if (scanStream && video.isConnected) window.setTimeout(scan, 250);
          };
          scan();
          return;
        } catch (error) {
          console.warn("Scanner bawaan tidak dapat digunakan; beralih ke scanner alternatif.", error);
        }
      }
      stream.getTracks().forEach(track => track.stop());
      scanStream = null;
      try {
        hint.textContent = "Memuat pemindai untuk browser HP ini...";
        const zxing = await loadZxingBrowser();
        if (!video.isConnected) return;
        const reader = new zxing.BrowserMultiFormatReader();
        scannerControls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, (result, error, controls) => {
          if (result) { controls?.stop(); scannerControls = null; handleScannedCode(result.getText()); }
        });
        if (hint.isConnected) hint.textContent = "Kamera aktif. Arahkan barcode ke dalam kotak. Pemindai alternatif memerlukan koneksi internet.";
      } catch (error) {
        console.error("Pemindai kamera tidak dapat dimulai.", error);
        if (hint.isConnected) hint.textContent = `${error.message || "Kamera tidak dapat dimulai."} Pastikan izin kamera aktif. Anda tetap dapat memasukkan barcode/SKU secara manual.`;
      }
    }).catch(error => {
      console.error("Akses kamera gagal.", error);
      if (hint.isConnected) hint.textContent = "Kamera tidak dapat diakses. Izinkan kamera di browser HP atau masukkan barcode/SKU secara manual.";
    });
  }

  function addToCart(product) {
    const existing = cart.find(item => item.id === product.id);
    if ((existing?.qty || 0) >= product.stock) { toast(`Stok ${product.name} tidak mencukupi.`, true); return; }
    if (existing) existing.qty++;
    else cart.push({ id: product.id, name: product.name, sku: product.sku, emoji: product.emoji || "📦", price: product.price, qty: 1 });
    render();
  }

  function saveSettings(form) {
    const data = new FormData(form);
    const taxRate = Number(data.get("taxRate"));
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) { toast("Pajak harus bernilai 0 hingga 100 persen.", true); return; }
    state.settings = { ...state.settings, storeName: String(data.get("storeName")).trim(), address: String(data.get("address")).trim(), taxRate, receiptWidth: data.get("receiptWidth") };
    persist(); render(); toast("Pengaturan toko berhasil disimpan.");
  }

  function userModal() {
    if (!requireAdmin()) return;
    const body = `<div class="field"><label>Nama kasir</label><input name="name" required maxlength="60"></div><div class="field"><label>Email login</label><input name="email" type="email" required maxlength="254" autocomplete="email"></div><div class="field"><label>Password awal (8–128 karakter)</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></div><p class="form-hint">Sampaikan password awal ini kepada kasir secara pribadi. Kasir dapat menggantinya melalui ikon profil setelah login.</p>`;
    showModal("Tambah akun kasir", body, async data => {
      const name = String(data.get("name") || "").trim(), email = String(data.get("email") || "").trim().toLowerCase(), password = String(data.get("password") || "");
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) { toast("Periksa nama, email, dan password 8 hingga 128 karakter.", true); return; }
      if (state.users.some(user => user.email?.toLowerCase() === email)) { toast("Email sudah digunakan akun lain.", true); return; }
      try {
        const salt = makeSalt();
        const user = { id: `u-${Date.now()}`, name, email, role: "Kasir", passwordSalt: salt, passwordHash: await hashPassword(password, salt) };
        state.users.push(user); persist(); closeModal(); render(); toast("Akun kasir berhasil dibuat. Kasir dapat masuk dengan email tersebut.");
      } catch (error) {
        console.error("Akun kasir gagal dibuat.", error);
        toast(error.message || "Tidak dapat membuat akun kasir.", true);
      }
    });
  }

  function changePasswordModal() {
    const body = `<div class="form-hint">Ganti password akun <strong>${escapeHtml(currentUser.email)}</strong>. Password baru harus 8 hingga 128 karakter.</div><div class="field"><label>Password saat ini</label><input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></div><div class="field"><label>Password baru</label><input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="field"><label>Ulangi password baru</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div>`;
    showModal("Ganti password", body, async data => {
      const currentPassword = String(data.get("currentPassword") || "");
      const newPassword = String(data.get("newPassword") || "");
      if (newPassword.length < 8 || newPassword.length > 128 || newPassword !== String(data.get("confirmPassword") || "")) { toast("Password baru harus 8 hingga 128 karakter dan konfirmasinya harus cocok.", true); return; }
      try {
        if (await hashPassword(currentPassword, currentUser.passwordSalt) !== currentUser.passwordHash) { toast("Password saat ini salah.", true); return; }
        const salt = makeSalt();
        currentUser.passwordSalt = salt;
        currentUser.passwordHash = await hashPassword(newPassword, salt);
        persist(); closeModal(); toast("Password berhasil diganti.");
      } catch (error) {
        console.error("Password gagal diganti.", error);
        toast(error.message || "Tidak dapat mengganti password.", true);
      }
    }, "Simpan password");
  }

  function cancelTransaction(id) {
    const tx = state.transactions.find(item => item.id === id);
    if (!tx || tx.status !== "Belum lunas") { toast("Hanya transaksi belum lunas yang dapat dibatalkan dari sini.", true); return; }
    if (!window.confirm(`Batalkan transaksi ${id}? Pembayaran gateway tetap harus diperiksa secara manual.`)) return;
    tx.status = "Dibatalkan"; tx.cancelledAt = new Date().toISOString(); persist(); render(); toast("Transaksi dibatalkan. Pastikan tidak ada pembayaran eksternal yang berhasil.");
  }

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-page], [data-action], [data-id='']"); if (!target) return;
    if (target.dataset.page) { navTo(target.dataset.page); return; }
    const action = target.dataset.action, id = target.dataset.id;
    if (!action) return;
    if (!currentUser) return;
    if (action === "close-modal") closeModal();
    else if (action === "product-new") { if (requireAdmin()) productModal(null); }
    else if (action === "product-edit") { if (requireAdmin()) productModal(state.products.find(item => item.id === id)); }
    else if (action === "product-delete") {
      if (!requireAdmin()) return;
      const product = state.products.find(item => item.id === id);
      if (!product || !window.confirm(`Hapus produk "${product.name}"? Data historis transaksi tetap disimpan.`)) return;
      if (cart.some(item => item.id === id)) { toast("Produk ini masih berada di keranjang.", true); return; }
      state.products = state.products.filter(item => item.id !== id); persist(); render(); toast("Produk berhasil dihapus.");
    } else if (action === "category") { selectedCategory = target.dataset.value; render(); }
    else if (action === "print-product-barcode") printBarcodeLabels([id]);
    else if (action === "print-selected-barcodes") printBarcodeLabels([...selectedProductIds]);
    else if (action === "print-barcodes") {
      document.body.classList.add("printing-barcodes");
      window.print();
    }
    else if (action === "add-cart") { const product = state.products.find(item => item.id === id); if (product) addToCart(product); }
    else if (action === "qty-plus" || action === "qty-minus") {
      const item = cart.find(entry => entry.id === id), product = state.products.find(entry => entry.id === id);
      if (!item || !product) return;
      if (action === "qty-plus") { if (item.qty >= product.stock) { toast(`Stok ${item.name} tidak mencukupi.`, true); return; } item.qty++; }
      else if (--item.qty <= 0) cart = cart.filter(entry => entry.id !== id);
      render();
    } else if (action === "cart-remove") { cart = cart.filter(item => item.id !== id); render(); }
    else if (action === "checkout") checkout();
    else if (action === "scan") startScanner();
    else if (action === "receipt") { const tx = state.transactions.find(item => item.id === id); if (tx) receiptModal(tx); }
    else if (action === "print-receipt") {
      const tx = state.transactions.find(item => item.id === id);
      if (!tx || tx.status !== "Lunas") { toast("Struk lunas hanya tersedia untuk pembayaran yang terverifikasi.", true); return; }
      document.body.classList.add("printing-receipt");
      const css = document.createElement("style"); css.id = "receipt-print-style"; css.textContent = `@media print { @page { size: ${target.dataset.width}mm auto; margin: 3mm; } }`;
      document.head.append(css); window.print(); css.remove(); document.body.classList.remove("printing-receipt");
    } else if (action === "export-report") exportReport();
    else if (action === "export-stock") exportStock();
    else if (action === "backup-export") { if (requireAdmin()) downloadBackup(); }
    else if (action === "backup-import") { if (requireAdmin()) importBackup(); }
    else if (action === "user-new") userModal();
    else if (action === "user-delete") {
      if (!requireAdmin()) return;
      const user = state.users.find(item => item.id === id);
      if (!user || user.id === currentUser.id || user.role === "Admin" || !window.confirm(`Hapus akun kasir ${user.name}?`)) return;
      state.users = state.users.filter(item => item.id !== id);
      persist(); render(); toast("Pengguna berhasil dihapus.");
    } else if (action === "change-password") changePasswordModal();
    else if (action === "logout") logout();
    else if (action === "cancel-tx") { if (requireAdmin()) cancelTransaction(id); }
    else if (action === "print-report") {
      document.body.classList.add("printing-report"); window.print();
    }
  });

  document.addEventListener("input", event => {
    if (event.target.id === "pos-search" || event.target.id === "product-search") {
      const input = event.target, cursor = input.selectionStart;
      productQuery = input.value; const currentPage = page; render();
      const refreshed = document.getElementById(currentPage === "kasir" ? "pos-search" : "product-search");
      if (refreshed) { refreshed.focus(); refreshed.setSelectionRange(cursor, cursor); }
    } else if (event.target.id === "transaction-search") {
      transactionQuery = event.target.value; const cursor = event.target.selectionStart; render(); const input = document.getElementById("transaction-search"); input?.focus(); input?.setSelectionRange(cursor, cursor);
    } else if (event.target.id === "discount-input") {
      cartDiscount = Math.max(0, Number(event.target.value) || 0); const cursor = event.target.selectionStart; render(); const input = document.getElementById("discount-input"); input?.focus(); input?.setSelectionRange(cursor, cursor);
    } else if (event.target.id === "cash-received") {
      const raw = event.target.value.replace(/\D/g, ""), cursor = event.target.selectionStart;
      event.target.value = moneyInput(raw);
      const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
      const discount = Math.min(total, discountType === "persen" ? Math.round(total * Math.min(100, cartDiscount) / 100) : cartDiscount);
      const payTotal = total - discount + Math.round((total - discount) * (Number(state.settings.taxRate) || 0) / 100);
      document.getElementById("change-due").textContent = `Kembalian: ${rupiah(Math.max(0, Number(raw) - payTotal))}`;
      document.querySelector(".checkout-btn").disabled = cart.length === 0 || Number(raw) < payTotal;
      if (cursor === event.target.value.length) event.target.setSelectionRange(cursor, cursor);
    }
  });

  document.addEventListener("change", event => {
    if (event.target.matches('[data-action="select-barcode"]')) {
      if (event.target.checked) selectedProductIds.add(event.target.dataset.id);
      else selectedProductIds.delete(event.target.dataset.id);
      render();
    } else if (event.target.id === "dashboard-period") { dashboardPeriod = event.target.value; const items = chartData(dashboardPeriod); drawChart(document.getElementById("sales-chart"), items.map(item => ({ value: item.value })), items.map(item => item.label)); }
    else if (event.target.id === "report-period") { reportPeriod = event.target.value; render(); }
    else if (event.target.id === "transaction-status") { transactionStatus = event.target.value; render(); }
    else if (event.target.id === "discount-type") { discountType = event.target.value; render(); }
    else if (event.target.id === "payment-method") { paymentMethod = event.target.value; render(); }
    else if (event.target.id === "transaction-method") { transactionMethod = event.target.value; render(); }
    else if (event.target.id === "transaction-date") { transactionDate = event.target.value; render(); }
  });

  document.addEventListener("submit", event => {
    if (event.target.id === "auth-form") { event.preventDefault(); handleAuthSubmit(event.target); }
    else if (event.target.id === "scan-code-form") {
      event.preventDefault();
      const code = String(new FormData(event.target).get("code") || "").trim();
      if (code) handleScannedCode(code);
    }
    else if (event.target.id === "settings-form") { event.preventDefault(); if (requireAdmin()) saveSettings(event.target); }
  });

  document.getElementById("menu-toggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("is-open"));
  document.getElementById("storage-info").addEventListener("click", () => toast("Data memakai localStorage pada browser ini, bukan database/server bersama. Unduh cadangan JSON secara berkala."));
  document.querySelectorAll(".logout-button").forEach(button => button.addEventListener("click", logout));
  modalBackdrop.addEventListener("click", event => { if (event.target === modalBackdrop) closeModal(); });
  window.addEventListener("resize", () => { if (page === "dashboard") { const items = chartData(dashboardPeriod); drawChart(document.getElementById("sales-chart"), items.map(item => ({ value: item.value })), items.map(item => item.label)); } });
  window.addEventListener("afterprint", () => { document.getElementById("receipt-print-style")?.remove(); document.body.classList.remove("printing-receipt", "printing-report", "printing-barcodes"); });

  currentUser = resolveSession();
  page = currentUser?.role === "Kasir" ? "kasir" : "dashboard";
  render();
})();
