// 选将预览: type 4-5 general names, compare their cards and skills side by side.
// Deliberately private: state never leaves localStorage (no share link, no URL hash).
(function () {
  "use strict";

  var COUNTS = [4, 5];
  var KEY = "sgs-draft";
  var KINGDOM = { wei: "魏", shu: "蜀", wu: "吴", qun: "群", jin: "晋", shen: "神" };

  var cards = [], bySlug = {};
  var state = { n: 5, picks: [], hide: false };
  var saveTimer = null;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fit() {
    while (state.picks.length < state.n) state.picks.push("");
    state.picks.length = state.n;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    $("#saved").textContent = "已保存 " + new Date().toTimeString().slice(0, 8);
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
    if (raw && raw.picks) {
      state.n = COUNTS.indexOf(raw.n) > -1 ? raw.n : 5;
      state.picks = raw.picks.map(function (p) { return String(p || ""); });
      state.hide = !!raw.hide;
    }
    fit();
  }

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

  function slotHTML(name, i) {
    var c = findCard(name);
    var pic = c && c.img
      ? '<a class="draft-pic" href="../generals/' + encodeURIComponent(c.slug) + '/" title="查看详情">' +
        '<img src="../img/card/' + encodeURIComponent(c.slug) + '.webp" alt="' + esc(c.name) + '" decoding="async"></a>'
      : '<div class="draft-pic empty">' + (name ? "找不到「" + esc(name) + "」" : "输入武将名") + "</div>";
    var head = c
      ? '<span class="kb k-' + c.kingdom + '">' + esc(KINGDOM[c.kingdom] || c.kingdom) + "</span>" +
        '<b class="draft-name">' + esc(c.name) + "</b>" +
        '<span class="hp"><span class="heart">♥</span>' + (c.hp === c.maxHp ? c.maxHp : c.hp + "/" + c.maxHp) + "</span>" +
        (c.lord ? '<span class="tag">主公</span>' : "")
      : '<span class="muted">第 ' + (i + 1) + " 张</span>";
    var skills = c ? c.skills.map(function (s) {
      return '<div class="draft-skill"><b>' + esc(s.n) + "</b>" + esc(s.t) + "</div>";
    }).join("") : "";
    return '<article class="draft-card" data-i="' + i + '">' +
      '<div class="draft-head">' + head + "</div>" +
      pic +
      '<input class="gen-input" list="gen-list" placeholder="武将名 / 拼音" value="' + esc(name) + '" aria-label="第 ' + (i + 1) + ' 个武将">' +
      (skills ? '<div class="draft-skills">' + skills + "</div>" : "") +
      "</article>";
  }

  function render() {
    $("#slot-count").innerHTML = COUNTS.map(function (n) {
      return '<button type="button" class="chip" data-n="' + n + '" aria-pressed="' + (n === state.n) + '">' + n + " 张</button>";
    }).join("");
    var wrap = $("#slots");
    wrap.style.setProperty("--cols", state.n);
    wrap.classList.toggle("hidden", state.hide);
    wrap.innerHTML = state.picks.map(slotHTML).join("");
    $("#hide").setAttribute("aria-pressed", String(state.hide));
    $("#hide").textContent = state.hide ? "显示卡面" : "遮挡卡面";
  }

  // Only the changed slot is redrawn, so typing never loses focus.
  function redraw(el, name, i) {
    var tmp = document.createElement("div");
    tmp.innerHTML = slotHTML(name, i);
    var next = tmp.firstChild;
    el.querySelector(".draft-head").innerHTML = next.querySelector(".draft-head").innerHTML;
    el.replaceChild(next.querySelector(".draft-pic"), el.querySelector(".draft-pic"));
    var oldSkills = el.querySelector(".draft-skills"), newSkills = next.querySelector(".draft-skills");
    if (oldSkills && newSkills) oldSkills.innerHTML = newSkills.innerHTML;
    else if (oldSkills) oldSkills.remove();
    else if (newSkills) el.appendChild(newSkills);
  }

  function wire() {
    $("#slot-count").addEventListener("click", function (e) {
      var b = e.target.closest("[data-n]");
      if (!b) return;
      state.n = +b.dataset.n; fit(); render(); scheduleSave();
    });
    $("#slots").addEventListener("input", function (e) {
      if (!e.target.classList.contains("gen-input")) return;
      var el = e.target.closest(".draft-card"), i = +el.dataset.i;
      state.picks[i] = e.target.value;
      redraw(el, state.picks[i], i);
      scheduleSave();
    });
    $("#hide").addEventListener("click", function () {
      state.hide = !state.hide; render(); scheduleSave();
    });
    $("#clear").addEventListener("click", function () {
      state.picks = []; fit(); render(); save();
    });
  }

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
      .catch(function () { /* inputs still work, just without lookup */ });
  });
})();
