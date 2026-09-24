// 牌局记录: each seat holds just an identity and a general's card image.
// State lives in localStorage and can be encoded into the URL hash to share a board.
(function () {
  "use strict";

  var IDENTITIES = [
    { id: "zhu", name: "主公" }, { id: "zhong", name: "忠臣" },
    { id: "nei", name: "内奸" }, { id: "fan", name: "反贼" }, { id: "", name: "未知" }
  ];
  var COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  var KEY = "sgs-session";

  var cards = [];                 // from data/generals.json
  var bySlug = {};
  var state = { n: 8, seats: [] };
  var saveTimer = null;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function blankSeat() { return { id: "", g: "" }; }

  function fit() {
    while (state.seats.length < state.n) state.seats.push(blankSeat());
    state.seats.length = state.n;
  }

  // Two rows whenever it fits: 8 seats -> 4 x 2, 10 -> 5 x 2, 5 -> 3 + 2.
  function columns() { return Math.max(2, Math.ceil(state.n / 2)); }

  // ---------------------------------------------------------------- storage
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    $("#saved").textContent = "已保存 " + new Date().toTimeString().slice(0, 8);
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

  function load() {
    var raw = null;
    if (location.hash.length > 1) {
      try { raw = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch (e) { raw = null; }
    }
    if (!raw) {
      try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
    }
    if (raw && raw.seats) {
      state.n = COUNTS.indexOf(raw.n) > -1 ? raw.n : Math.min(10, Math.max(2, raw.n || 8));
      state.seats = raw.seats.map(function (s) { return { id: s.id || "", g: s.g || "" }; });
    }
    fit();
  }

  // ---------------------------------------------------------------- lookup
  function findCard(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    if (bySlug[t]) return bySlug[t];
    var low = t.toLowerCase();
    var starts = null, has = null, py = null;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], n = c.name;
      if (n === t) return c;
      if (!starts && n.indexOf(t) === 0) starts = c;
      if (!has && n.indexOf(t) > -1) has = c;
      if (!py && /^[a-z]+$/.test(low) &&
        (c.py || "").split(" ").concat((c.ini || "").split(" ")).indexOf(low) > -1) py = c;
    }
    return starts || has || py;
  }

  // ---------------------------------------------------------------- render
  function seatHTML(s, i) {
    var c = findCard(s.g);
    var pic = c && c.img
      ? '<a class="seat-pic" href="../generals/' + encodeURIComponent(c.slug) + '/" title="' +
        esc(c.name + (c.title ? "「" + c.title + "」" : "")) + '"><img src="../img/thumb/' +
        encodeURIComponent(c.slug) + '.webp" alt="' + esc(c.name) + '" decoding="async"></a>'
      : '<div class="seat-pic empty">' + (s.g ? esc(s.g) : "未选武将") + "</div>";
    return '<article class="seat' + (s.id ? " id-" + s.id : "") + '" data-i="' + i + '">' +
      '<header class="seat-head"><span class="seat-no">' + (i + 1) + "</span>" +
        '<select class="select seat-id" aria-label="身份">' +
          IDENTITIES.map(function (x) {
            return '<option value="' + x.id + '"' + (x.id === s.id ? " selected" : "") + ">" + x.name + "</option>";
          }).join("") +
        "</select></header>" +
      pic +
      '<input class="gen-input" list="gen-list" placeholder="武将" value="' + esc(s.g) + '" aria-label="武将">' +
      "</article>";
  }

  function render() {
    $("#seat-count").innerHTML = COUNTS.map(function (n) {
      return '<button type="button" class="chip" data-n="' + n + '" aria-pressed="' + (n === state.n) + '">' + n + "</button>";
    }).join("");
    var seats = $("#seats");
    seats.style.setProperty("--cols", columns());
    seats.innerHTML = state.seats.map(seatHTML).join("");
  }

  // Only the picture is swapped, so typing never loses focus.
  function redrawSeat(el, s) {
    var tmp = document.createElement("div");
    tmp.innerHTML = seatHTML(s, +el.dataset.i);
    var next = tmp.firstChild;
    el.className = next.className;
    el.replaceChild(next.querySelector(".seat-pic"), el.querySelector(".seat-pic"));
  }

  // ---------------------------------------------------------------- actions
  function seatOf(e) {
    var el = e.target.closest(".seat");
    return el ? { s: state.seats[+el.dataset.i], el: el } : null;
  }

  function wire() {
    $("#seat-count").addEventListener("click", function (e) {
      var b = e.target.closest("[data-n]");
      if (!b) return;
      state.n = +b.dataset.n; fit(); render(); scheduleSave();
    });

    var seats = $("#seats");
    seats.addEventListener("input", function (e) {
      var x = seatOf(e);
      if (!x || !e.target.classList.contains("gen-input")) return;
      x.s.g = e.target.value;
      redrawSeat(x.el, x.s);
      scheduleSave();
    });
    seats.addEventListener("change", function (e) {
      var x = seatOf(e);
      if (!x || !e.target.classList.contains("seat-id")) return;
      x.s.id = e.target.value;
      x.el.className = "seat" + (x.s.id ? " id-" + x.s.id : "");
      scheduleSave();
    });

    $("#share").addEventListener("click", function () {
      var hash = "#" + encodeURIComponent(JSON.stringify(state));
      copy(location.origin + location.pathname + hash, this, "链接已复制");
      history.replaceState(null, "", hash);
    });
    $("#copy-text").addEventListener("click", function () { copy(asText(), this, "已复制"); });
    $("#clear").addEventListener("click", function () {
      if (!confirm("清空所有座位？")) return;
      state.seats = []; fit(); render();
      history.replaceState(null, "", location.pathname);
      save();
    });
  }

  function asText() {
    var lines = ["三国杀牌局（" + state.n + "人）"];
    state.seats.forEach(function (s, i) {
      var c = findCard(s.g);
      var id = (IDENTITIES.filter(function (x) { return x.id === s.id; })[0] || {}).name || "未知";
      lines.push((i + 1) + "号 " + id + "　" + (c ? c.name + (c.title ? "「" + c.title + "」" : "") : (s.g || "—")));
    });
    return lines.join("\n");
  }

  function copy(text, btn, done) {
    var label = btn.textContent;
    function flash(ok) {
      btn.textContent = ok ? done : "复制失败";
      setTimeout(function () { btn.textContent = label; }, 1600);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      flash(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, fallback);
    } else { fallback(); }
  }

  // ---------------------------------------------------------------- boot
  document.addEventListener("DOMContentLoaded", function () {
    load();
    render();
    wire();
    fetch("../data/generals.json?v=" + (document.body.dataset.build || ""))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        cards = d.cards.filter(function (c) { return c.kind === "general"; });
        cards.forEach(function (c) { bySlug[c.slug] = c; });
        var list = document.createElement("datalist");
        list.id = "gen-list";
        list.innerHTML = cards.map(function (c) {
          return '<option value="' + esc(c.name) + '">' + esc(c.title) + "</option>";
        }).join("");
        document.body.appendChild(list);
        render();
      })
      .catch(function () { /* the board still works, just without name lookup */ });
  });
})();
