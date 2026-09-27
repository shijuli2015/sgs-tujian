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

  // ---------------------------------------------------------------- voice
  // Browser speech recognition returns characters, not pinyin, and mishears homophones
  // (甄姬 -> 真机), so every match is done on pinyin built from the site's own table.
  var py = {};          // char -> pinyin, from data/pinyin.json
  var DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  var ID_WORDS = [["主公", "zhu"], ["忠臣", "zhong"], ["内奸", "nei"], ["内鬼", "nei"], ["反贼", "fan"], ["反包", "fan"]];

  function toPinyin(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) out += py[s[i]] || "";
    return out;
  }

  function seatNumber(text) {
    var m = text.match(/([0-9]+|[一二两三四五六七八九十]+)\s*号/);
    if (!m) return 0;
    var t = m[1];
    if (/^[0-9]+$/.test(t)) return +t;
    if (t === "十") return 10;
    if (t.length === 2 && t[0] === "十") return 10 + (DIGITS[t[1]] || 0);
    return DIGITS[t] || 0;
  }

  function matchGeneral(text, wantLord) {
    var p = toPinyin(text);
    if (p.length < 4) return null;                    // one syllable is too ambiguous
    var best = null, bestScore = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i], toks = (c.py || "").split(" "), score = 0;
      for (var j = 0; j < toks.length; j++) {
        var t = toks[j];
        if (!t || t.length < 4) continue;
        if (t === p) score = Math.max(score, 100);
        else if (p.indexOf(t) > -1) score = Math.max(score, 80 + t.length);
        else if (t.indexOf(p) > -1) score = Math.max(score, 60 + p.length);
      }
      if (!score) continue;
      // 曹操 alone matches 威曹操 / 魔曹操 / 起曹操: prefer a lord when 主公 was said,
      // otherwise the plainest name.
      score = score * 100 + (wantLord && c.lord ? 30 : 0) - c.name.length;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // "一号主公曹操 三号反贼张辽" -> one command per seat mention
  function parse(text) {
    var clean = text.replace(/[\s,，。、；;]/g, "");
    var marks = [], re = /([0-9]+|[一二两三四五六七八九十]+)\s*号/g, m;
    while ((m = re.exec(clean))) marks.push(m.index);
    var parts = marks.length ? marks.map(function (at, i) {
      return clean.slice(at, i + 1 < marks.length ? marks[i + 1] : clean.length);
    }) : [clean];

    return parts.map(function (part) {
      var seat = seatNumber(part), rest = part.replace(/([0-9]+|[一二两三四五六七八九十]+)\s*号/, ""), id = "";
      for (var i = 0; i < ID_WORDS.length; i++) {
        if (rest.indexOf(ID_WORDS[i][0]) > -1) { id = ID_WORDS[i][1]; rest = rest.replace(ID_WORDS[i][0], ""); break; }
      }
      rest = rest.replace(/^(是|选|用|的)+/, "");
      return { seat: seat, id: id, card: matchGeneral(rest, id === "zhu"), raw: part };
    }).filter(function (c) { return c.seat || c.id || c.card; });
  }

  function applyVoice(cmd) {
    var i = cmd.seat ? cmd.seat - 1 : -1;
    if (i < 0) {                                       // no seat said: first empty one
        for (var k = 0; k < state.seats.length; k++) if (!state.seats[k].g) { i = k; break; }
    }
    if (i < 0 || i >= state.n) return "座位 " + (cmd.seat || "?") + " 不在 1–" + state.n + " 内";
    var s = state.seats[i];
    if (cmd.id) s.id = cmd.id;
    if (cmd.card) s.g = cmd.card.name;
    var el = document.querySelector('.seat[data-i="' + i + '"]');
    if (el) {
      el.className = "seat" + (s.id ? " id-" + s.id : "");
      redrawSeat(el, s);
      el.querySelector(".gen-input").value = s.g;
      el.querySelector(".seat-id").value = s.id;
      el.classList.add("flash");
      setTimeout(function () { el.classList.remove("flash"); }, 900);
    }
    scheduleSave();
    return (i + 1) + "号" + (cmd.id ? " " + (IDENTITIES.filter(function (x) { return x.id === cmd.id; })[0] || {}).name : "") +
      (cmd.card ? " " + cmd.card.name : "");
  }

  function setupVoice() {
    var btn = $("#mic"), status = $("#mic-status");
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.disabled = true;
      status.textContent = "这个浏览器不支持语音识别，请用 Chrome 或 Edge。";
      return;
    }
    var rec = new SR(), on = false;
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var text = e.results[i][0].transcript;
        if (!e.results[i].isFinal) { interim += text; continue; }
        var done = parse(text).map(applyVoice).filter(Boolean);
        status.textContent = done.length ? "已填入：" + done.join("；") : "没听懂「" + text + "」";
      }
      if (interim) status.textContent = "听到：" + interim;
    };
    rec.onerror = function (e) {
      status.textContent = e.error === "not-allowed" ? "麦克风被拒绝，请在地址栏允许后重试" : "识别出错：" + e.error;
      stop();
    };
    rec.onend = function () { if (on) { try { rec.start(); } catch (err) { stop(); } } };

    function stop() {
      on = false; btn.setAttribute("aria-pressed", "false"); btn.textContent = "🎤 开始语音录入";
      try { rec.stop(); } catch (e) { /* already stopped */ }
    }
    btn.addEventListener("click", function () {
      if (on) { stop(); status.textContent = "已停止"; return; }
      on = true; btn.setAttribute("aria-pressed", "true"); btn.textContent = "■ 停止录入";
      status.textContent = "请说：三号 反贼 张辽";
      try { rec.start(); } catch (e) { /* already running */ }
    });
  }

  // ---------------------------------------------------------------- boot
  document.addEventListener("DOMContentLoaded", function () {
    load();
    render();
    wire();
    setupVoice();
    fetch("../data/pinyin.json?v=" + (document.body.dataset.build || ""))
      .then(function (r) { return r.json(); })
      .then(function (t) { py = t; })
      .catch(function () { /* voice matching falls back to nothing */ });
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
