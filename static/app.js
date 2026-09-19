// List page: load data/generals.json, then search / filter / sort / render.
// All UI state lives in the query string so any filtered view can be shared as a link.
(function () {
  "use strict";

  var KINGDOMS = [["wei", "魏"], ["shu", "蜀"], ["wu", "吴"], ["qun", "群"], ["jin", "晋"], ["shen", "神"]];
  var KINGDOM_RANK = { wei: 0, shu: 1, wu: 2, qun: 3, jin: 4, shen: 5 };
  var TAG_ORDER = ["锁定技", "限定技", "觉醒技", "转换技", "主公技", "使命技", "宗族技", "召唤技", "连招技", "阵法技", "韵律技"];
  var DEFAULTS = { q: "", k: "", hp: "", tag: "", kind: "", lord: "", sort: "code", view: "card", cols: "" };

  var state = Object.assign({}, DEFAULTS);
  var cards = [];
  var el = {};

  // ------------------------------------------------------------------ utils
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
  function $(sel) { return document.querySelector(sel); }

  function readURL() {
    var p = new URLSearchParams(location.search);
    Object.keys(DEFAULTS).forEach(function (k) { state[k] = p.get(k) || DEFAULTS[k]; });
  }
  function writeURL() {
    var p = new URLSearchParams();
    Object.keys(DEFAULTS).forEach(function (k) { if (state[k] && state[k] !== DEFAULTS[k]) p.set(k, state[k]); });
    var qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  // ------------------------------------------------------------------ search
  // Each space-separated token must match somewhere; the card's score is the sum of
  // each token's best field. Name > pinyin > title > skill name > skill text.
  function prepare(c) {
    c._name = norm(c.name);
    c._title = norm(c.title);
    c._py = c.py.split(" ");
    c._ini = c.ini.split(" ");
    c._sn = c.skills.map(function (s) { return norm(s.n); });
    c._spy = norm(c.spy);
    c._st = c.skills.map(function (s) { return norm(s.t); });
    c._code = norm(c.code);
  }

  function tokenScore(c, t) {
    if (c._name === t) return 100;
    if (c._name.indexOf(t) === 0) return 85;
    if (c._name.indexOf(t) > -1) return 70;
    var i;
    if (/^[a-z]+$/.test(t)) {
      for (i = 0; i < c._py.length; i++) if (c._py[i] === t) return 80;
      for (i = 0; i < c._ini.length; i++) if (c._ini[i] === t) return 75;
      for (i = 0; i < c._py.length; i++) if (c._py[i].indexOf(t) === 0) return 62;
      for (i = 0; i < c._ini.length; i++) if (c._ini[i].indexOf(t) === 0) return 58;
    }
    if (c._title.indexOf(t) > -1) return 50;
    for (i = 0; i < c._sn.length; i++) if (c._sn[i] === t) return 48;
    for (i = 0; i < c._sn.length; i++) if (c._sn[i].indexOf(t) > -1) return 40;
    if (c._code.indexOf(t) > -1) return 38;
    if (/^[a-z]{2,}$/.test(t) && c._spy.indexOf(t) > -1) return 30;
    for (i = 0; i < c._st.length; i++) if (c._st[i].indexOf(t) > -1) return 12;
    return 0;
  }

  function scoreCard(c, tokens) {
    var total = 0;
    for (var i = 0; i < tokens.length; i++) {
      var s = tokenScore(c, tokens[i]);
      if (!s) return 0;
      total += s;
    }
    return total;
  }

  // Snippet around the first skill-text hit, for matches that only live in skill text.
  function textHit(c, tokens) {
    for (var i = 0; i < c.skills.length; i++) {
      var raw = c.skills[i].t, lower = raw.toLowerCase();
      for (var j = 0; j < tokens.length; j++) {
        var at = lower.indexOf(tokens[j]);
        if (at > -1 && /[^\x00-\x7f]/.test(tokens[j])) {
          var a = Math.max(0, at - 14), b = Math.min(raw.length, at + tokens[j].length + 22);
          return "<b>" + esc(c.skills[i].n) + "</b>：" + (a ? "…" : "") + esc(raw.slice(a, at)) +
            "<mark>" + esc(raw.slice(at, at + tokens[j].length)) + "</mark>" +
            esc(raw.slice(at + tokens[j].length, b)) + (b < raw.length ? "…" : "");
        }
      }
    }
    return "";
  }

  // ------------------------------------------------------------------ filter + sort
  function passes(c, except) {
    if (except !== "k" && state.k && c.kingdom !== state.k) return false;
    if (except !== "hp" && state.hp && String(c.maxHp) !== state.hp) return false;
    if (except !== "tag" && state.tag && c.tags.indexOf(state.tag) < 0) return false;
    if (except !== "kind" && state.kind && c.kind !== state.kind) return false;
    if (except !== "lord" && state.lord && !c.lord) return false;
    return true;
  }

  var SORTS = {
    code: function (a, b) {
      return (KINGDOM_RANK[a.kingdom] - KINGDOM_RANK[b.kingdom]) || (a._num - b._num) || (a._i - b._i);
    },
    name: function (a, b) { return a._py[0].localeCompare(b._py[0]) || a._i - b._i; },
    hpDesc: function (a, b) { return (b.maxHp - a.maxHp) || SORTS.code(a, b); },
    hpAsc: function (a, b) { return (a.maxHp - b.maxHp) || SORTS.code(a, b); },
    skills: function (a, b) { return (b.skills.length - a.skills.length) || SORTS.code(a, b); }
  };

  function results() {
    var tokens = norm(state.q) ? state.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
    var list = [];
    cards.forEach(function (c) {
      if (!passes(c)) return;
      c._score = tokens.length ? scoreCard(c, tokens) : 0;
      if (tokens.length && !c._score) return;
      c._hit = tokens.length && c._score < 40 * tokens.length ? textHit(c, tokens) : "";
      list.push(c);
    });
    var by = SORTS[state.sort] || SORTS.code;
    list.sort(tokens.length && state.sort === "code"
      ? function (a, b) { return (b._score - a._score) || by(a, b); }
      : by);
    return list;
  }

  // ------------------------------------------------------------------ render
  function hpHTML(c) {
    if (c.maxHp <= 0) return "";
    var v = c.hp === c.maxHp ? c.maxHp : c.hp + "/" + c.maxHp;
    return '<span class="hp"><span class="heart">♥</span>' + v + "</span>";
  }

  function cardHTML(c, i) {
    var corner = "";
    if (c.kind === "skillcard") corner += '<span class="tag tag-kind">技能卡</span>';
    if (c.lord) corner += '<span class="tag">主公</span>';
    if (c.sim) corner += '<span class="tag tag-sim">模拟器</span>';
    var skills = c.skills.map(function (s) { return "<b>" + esc(s.n) + "</b>"; }).join(" · ");
    return '<a class="gcard" href="generals/' + encodeURIComponent(c.slug) + '/">' +
      '<div class="thumb">' + (c.img
        ? '<img src="img/thumb/' + encodeURIComponent(c.slug) + '.webp" alt="' + esc(c.name) + '"' + (i < 10 ? "" : ' loading="lazy"') + ' decoding="async" width="480" height="674">'
        : "") + "</div>" +
      (corner ? '<div class="corner">' + corner + "</div>" : "") +
      '<div class="body">' +
      '<div class="row1"><span class="kb k-' + c.kingdom + '">' + esc(kingdomName(c.kingdom)) + "</span>" +
      '<span class="gname">' + esc(c.name) + "</span>" + hpHTML(c) + "</div>" +
      '<div class="gtitle">' + esc(c.title || " ") + (c.code ? ' · ' + esc(c.code) : "") + "</div>" +
      (c._hit ? '<div class="hit">' + c._hit + "</div>" : '<div class="gskills">' + skills + "</div>") +
      "</div></a>";
  }

  function kingdomName(k) {
    for (var i = 0; i < KINGDOMS.length; i++) if (KINGDOMS[i][0] === k) return KINGDOMS[i][1];
    return k;
  }

  function chip(group, value, label, count, extraClass) {
    var on = state[group] === value;
    return '<button type="button" class="chip' + (extraClass ? " " + extraClass : "") + '" data-g="' + group +
      '" data-v="' + esc(value) + '" aria-pressed="' + on + '">' + esc(label) +
      (count != null ? '<span class="n">' + count + "</span>" : "") + "</button>";
  }

  // Facet counts reflect every other active filter, so a chip never promises a result it can't deliver.
  function counts(group, key) {
    var m = {};
    cards.forEach(function (c) {
      if (!passes(c, group)) return;
      [].concat(key(c)).forEach(function (v) { m[v] = (m[v] || 0) + 1; });
    });
    return m;
  }

  function renderFilters() {
    var km = counts("k", function (c) { return c.kingdom; });
    var kHTML = chip("k", "", "全部", null);
    KINGDOMS.forEach(function (k) { if (km[k[0]] || state.k === k[0]) kHTML += chip("k", k[0], k[1], km[k[0]] || 0, "k-" + k[0]); });
    el.fk.innerHTML = kHTML;

    var hm = counts("hp", function (c) { return c.maxHp > 0 ? String(c.maxHp) : []; });
    var hps = Object.keys(allHp).sort(function (a, b) { return a - b; });
    el.fhp.innerHTML = chip("hp", "", "全部", null) + hps.map(function (h) { return chip("hp", h, "♥" + h, hm[h] || 0); }).join("");

    var tm = counts("tag", function (c) { return c.tags; });
    el.ftag.innerHTML = chip("tag", "", "全部", null) + allTags.map(function (t) { return chip("tag", t, t, tm[t] || 0); }).join("");

    var dm = counts("kind", function (c) { return c.kind; });
    var lm = counts("lord", function (c) { return c.lord ? "y" : []; });
    el.fkind.innerHTML = chip("kind", "", "全部", null) + chip("kind", "general", "武将", dm.general || 0) +
      chip("kind", "skillcard", "技能卡", dm.skillcard || 0) +
      '<span style="width:10px"></span>' + chip("lord", "y", "可选主公", lm.y || 0);
  }

  var allHp = {}, allTags = [];

  function render() {
    renderFilters();
    var list = results();
    el.count.innerHTML = "共 <b>" + list.length + "</b> 张" + (list.length !== cards.length ? '<span class="muted"> / ' + cards.length + "</span>" : "");
    el.grid.className = "grid" + (state.view === "portrait" ? " portrait" : "");
    el.grid.style.setProperty("--cols", state.cols || 5);
    el.grid.innerHTML = list.map(cardHTML).join("");
    el.empty.hidden = list.length > 0;
    el.reset.hidden = Object.keys(DEFAULTS).every(function (k) { return k === "view" || k === "cols" || k === "sort" || state[k] === DEFAULTS[k]; });
    document.querySelectorAll("[data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.view === state.view)); });
    document.querySelectorAll("[data-cols]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.cols === (state.cols || "5"))); });
    el.sort.value = state.sort;
    if (el.q.value !== state.q) el.q.value = state.q;
    writeURL();
  }

  // ------------------------------------------------------------------ wire up
  function init(data) {
    cards = data.cards;
    cards.forEach(function (c, i) {
      c._i = i;
      c._num = parseInt(String(c.code).replace(/\D/g, ""), 10) || 9999;
      prepare(c);
      if (c.maxHp > 0) allHp[c.maxHp] = 1;
      c.tags.forEach(function (t) { if (allTags.indexOf(t) < 0) allTags.push(t); });
    });
    allTags.sort(function (a, b) {
      var ia = TAG_ORDER.indexOf(a), ib = TAG_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });

    document.querySelector(".filters").addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var g = b.dataset.g, v = b.dataset.v;
      state[g] = state[g] === v ? DEFAULTS[g] : v;
      render();
    });
    document.querySelectorAll("[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { state.view = b.dataset.view; render(); });
    });
    document.querySelectorAll("[data-cols]").forEach(function (b) {
      b.addEventListener("click", function () { state.cols = b.dataset.cols === "5" ? "" : b.dataset.cols; render(); });
    });
    el.sort.addEventListener("change", function () { state.sort = el.sort.value; render(); });

    var t;
    el.q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = el.q.value.trim(); render(); }, 80);
    });
    el.form.addEventListener("submit", function (e) {
      e.preventDefault();
      var first = el.grid.querySelector(".gcard");
      if (first && state.q) location.href = first.href;
    });
    function reset() {
      ["q", "k", "hp", "tag", "kind", "lord"].forEach(function (k) { state[k] = DEFAULTS[k]; });
      render();
    }
    el.reset.addEventListener("click", reset);
    el.emptyReset.addEventListener("click", reset);
    render();
  }

  document.addEventListener("DOMContentLoaded", function () {
    el = {
      q: $("#q"), form: $("#search-form"), grid: $("#grid"), count: $("#count"), empty: $("#empty"),
      emptyReset: $("#empty-reset"), reset: $("#reset"), sort: $("#sort"),
      fk: $("#f-k"), fhp: $("#f-hp"), ftag: $("#f-tag"), fkind: $("#f-kind")
    };
    readURL();
    fetch("data/generals.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(init)
      .catch(function (err) {
        el.count.textContent = "数据加载失败（" + err.message + "）。若直接双击打开了 index.html，请改用本地服务器：python -m http.server";
      });
  });
})();
