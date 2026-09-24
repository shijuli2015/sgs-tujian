// 牌局记录: seat board for an identity game. State lives in localStorage, and the
// whole board can be encoded into the URL hash so a link shows the same table.
(function () {
  "use strict";

  var IDENTITIES = [
    { id: "zhu", name: "主公" }, { id: "zhong", name: "忠臣" },
    { id: "nei", name: "内奸" }, { id: "fan", name: "反贼" }, { id: "", name: "未知" }
  ];
  var COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var KEY = "sgs-session";
  var MAX_NOTE = 60;

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
  function blankSeat() { return { id: "", g: "", g2: "", hp: null, dead: false, note: "" }; }

  function fit() {
    while (state.seats.length < state.n) state.seats.push(blankSeat());
    state.seats.length = state.n;
  }

  // ---------------------------------------------------------------- storage
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    var t = new Date();
    $("#saved").textContent = "已保存 " + t.toTimeString().slice(0, 8);
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
      state.n = COUNTS.indexOf(raw.n) > -1 ? raw.n : 8;
      state.seats = raw.seats.map(function (s) {
        return {
          id: s.id || "", g: s.g || "", g2: s.g2 || "",
          hp: typeof s.hp === "number" ? s.hp : null,
          dead: !!s.dead, note: String(s.note || "").slice(0, MAX_NOTE)
        };
      });
    }
    fit();
  }

  // ---------------------------------------------------------------- lookup
  function findCard(text) {
    var t = String(text || "").trim();
    if (!t) return null;
    if (bySlug[t]) return bySlug[t];
    var low = t.toLowerCase();
    var exact = null, starts = null, has = null, py = null;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], n = c.name;
      if (n === t) { exact = c; break; }
      if (!starts && n.indexOf(t) === 0) starts = c;
      if (!has && n.indexOf(t) > -1) has = c;
      if (!py && /^[a-z]+$/.test(low) && (c.py || "").split(" ").concat((c.ini || "").split(" ")).indexOf(low) > -1) py = c;
    }
    return exact || starts || has || py;
  }

  // ---------------------------------------------------------------- render
  function identityOptions(sel) {
    return IDENTITIES.map(function (i) {
      return '<option value="' + i.id + '"' + (i.id === sel ? " selected" : "") + ">" + i.name + "</option>";
    }).join("");
  }

  function picHTML(c, cls) {
    if (!c) return '<div class="seat-pic ' + cls + ' empty" aria-hidden="true">?</div>';
    var img = c.img
      ? '<img src="../img/thumb/' + encodeURIComponent(c.slug) + '.webp" alt="' + esc(c.name) + '" decoding="async">'
      : '<span class="muted">无卡面</span>';
    return '<a class="seat-pic ' + cls + '" href="../generals/' + encodeURIComponent(c.slug) +
      '/" title="' + esc(c.name + (c.title ? "「" + c.title + "」" : "")) + '">' + img + "</a>";
  }

  function seatHTML(s, i) {
    var c = findCard(s.g), c2 = findCard(s.g2);
    var hp = s.hp == null ? (c ? c.maxHp : "") : s.hp;
    var link = c ? '<a class="seat-link" href="../generals/' + encodeURIComponent(c.slug) + '/" title="查看详情">详情 →</a>' : "";
    return '<article class="seat' + (s.dead ? " dead" : "") + (s.id ? " id-" + s.id : "") + '" data-i="' + i + '">' +
      '<header class="seat-head">' +
        '<span class="seat-no">' + (i + 1) + "</span>" +
        '<select class="select seat-id" aria-label="身份">' + identityOptions(s.id) + "</select>" +
        '<label class="seat-dead"><input type="checkbox" class="dead-box"' + (s.dead ? " checked" : "") + "> 阵亡</label>" +
      "</header>" +
      '<div class="seat-body">' +
        '<div class="seat-pics">' + picHTML(c, "main") + (c2 || s.g2 ? picHTML(c2, "sub") : "") + "</div>" +
        '<div class="seat-fields">' +
        '<div class="seat-gen">' +
          '<input class="gen-input" list="gen-list" placeholder="武将" value="' + esc(s.g) + '" aria-label="武将">' +
          '<input class="gen-input gen-2" list="gen-list" placeholder="副将（可空）" value="' + esc(s.g2) + '" aria-label="副将">' +
        "</div>" +
        '<div class="seat-meta">' +
          (c ? '<span class="kb k-' + c.kingdom + '">' + esc(kingdomName(c.kingdom)) + "</span>" : "") +
          (c ? '<span class="seat-title">' + esc(c.name) + (c.title ? "「" + esc(c.title) + "」" : "") + "</span>" : '<span class="muted">未选武将</span>') +
          (c2 ? '<span class="seat-title muted">+ ' + esc(c2.name) + "</span>" : "") +
          link +
        "</div>" +
        '<div class="seat-hp">' +
          '<button class="hp-btn" data-d="-1" type="button" aria-label="体力 -1">−</button>' +
          '<span class="hp"><span class="heart">♥</span><b class="hp-val">' + (hp === "" ? "—" : hp) + "</b></span>" +
          '<button class="hp-btn" data-d="1" type="button" aria-label="体力 +1">+</button>' +
          '<input class="note" placeholder="备注（装备、判定、心证…）" maxlength="' + MAX_NOTE + '" value="' + esc(s.note) + '">' +
        "</div>" +
      "</div></div></article>";
  }

  function kingdomName(k) {
    return { wei: "魏", shu: "蜀", wu: "吴", qun: "群", jin: "晋", shen: "神" }[k] || k;
  }

  function renderTally() {
    var by = {}, alive = 0;
    state.seats.forEach(function (s) {
      if (!s.dead) alive++;
      if (s.id) by[s.id] = (by[s.id] || 0) + 1;
    });
    var parts = IDENTITIES.filter(function (i) { return i.id && by[i.id]; })
      .map(function (i) { return i.name + " " + by[i.id]; });
    $("#tally").innerHTML = "共 <b>" + state.n + "</b> 人，存活 <b>" + alive + "</b>" +
      (parts.length ? "　·　" + esc(parts.join("、")) : "");
  }

  function render() {
    $("#seat-count").innerHTML = COUNTS.map(function (n) {
      return '<button type="button" class="chip" data-n="' + n + '" aria-pressed="' + (n === state.n) + '">' + n + "</button>";
    }).join("");
    $("#seats").innerHTML = state.seats.map(seatHTML).join("");
    renderTally();
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
      var x = seatOf(e); if (!x) return;
      if (e.target.classList.contains("gen-input")) {
        var second = e.target.classList.contains("gen-2");
        x.s[second ? "g2" : "g"] = e.target.value;
        if (!second) {
          var c = findCard(e.target.value);
          x.s.hp = c ? c.maxHp : null;      // picking a general refills to its printed HP
        }
        redrawSeat(x.el, x.s);
      } else if (e.target.classList.contains("note")) {
        x.s.note = e.target.value;
      }
      scheduleSave();
    });
    seats.addEventListener("change", function (e) {
      var x = seatOf(e); if (!x) return;
      if (e.target.classList.contains("seat-id")) { x.s.id = e.target.value; redrawSeat(x.el, x.s); renderTally(); }
      else if (e.target.classList.contains("dead-box")) { x.s.dead = e.target.checked; redrawSeat(x.el, x.s); renderTally(); }
      scheduleSave();
    });
    seats.addEventListener("click", function (e) {
      var b = e.target.closest(".hp-btn"); if (!b) return;
      var x = seatOf(e); if (!x) return;
      var c = findCard(x.s.g);
      var cur = x.s.hp == null ? (c ? c.maxHp : 0) : x.s.hp;
      x.s.hp = Math.max(0, Math.min(99, cur + (+b.dataset.d)));
      redrawSeat(x.el, x.s); scheduleSave();
    });

    $("#share").addEventListener("click", function () {
      var url = location.origin + location.pathname + "#" + encodeURIComponent(JSON.stringify(state));
      copy(url, this, "链接已复制");
      history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify(state)));
    });
    $("#copy-text").addEventListener("click", function () {
      copy(asText(), this, "战报已复制");
    });
    $("#reset-hp").addEventListener("click", function () {
      state.seats.forEach(function (s) { var c = findCard(s.g); s.hp = c ? c.maxHp : null; s.dead = false; });
      render(); save();
    });
    $("#clear").addEventListener("click", function () {
      if (!confirm("清空所有座位的记录？")) return;
      state.seats = []; fit(); render();
      history.replaceState(null, "", location.pathname);
      save();
    });
  }

  // Only the changed seat is re-rendered, so typing never loses focus.
  function redrawSeat(el, s) {
    var i = +el.dataset.i;
    var tmp = document.createElement("div");
    tmp.innerHTML = seatHTML(s, i);
    var next = tmp.firstChild;
    el.className = next.className;
    el.querySelector(".seat-meta").innerHTML = next.querySelector(".seat-meta").innerHTML;
    el.querySelector(".seat-pics").innerHTML = next.querySelector(".seat-pics").innerHTML;
    el.querySelector(".hp-val").textContent = next.querySelector(".hp-val").textContent;
  }

  function asText() {
    var lines = ["三国杀牌局记录（" + state.n + "人）"];
    state.seats.forEach(function (s, i) {
      var c = findCard(s.g), c2 = findCard(s.g2);
      var name = c ? c.name + (c.title ? "「" + c.title + "」" : "") : (s.g || "—");
      if (c2) name += " + " + c2.name;
      var id = (IDENTITIES.filter(function (x) { return x.id === s.id; })[0] || {}).name || "未知";
      var hp = s.hp == null ? (c ? c.maxHp : "—") : s.hp;
      lines.push((i + 1) + "号 " + id + "　" + name + "　♥" + hp + (s.dead ? "　阵亡" : "") + (s.note ? "　" + s.note : ""));
    });
    return lines.join("\n");
  }

  function copy(text, btn, done) {
    var label = btn.textContent;
    function flash(ok) {
      btn.textContent = ok ? done : "复制失败";
      setTimeout(function () { btn.textContent = label; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      flash(ok);
    }
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
