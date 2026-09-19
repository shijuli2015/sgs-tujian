// Shared by every page: theme toggle, Ctrl+K / "/" search focus, header search form.
(function () {
  var root = document.documentElement;
  var KEY = "sgs-theme";

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } }
  function current() {
    return root.dataset.theme ||
      (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }

  var saved = stored();
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-btn");
    function paint() { if (btn) btn.textContent = current() === "light" ? "☾" : "☀"; }
    paint();
    if (btn) btn.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      root.dataset.theme = next;
      store(next);
      paint();
    });

    var input = document.getElementById("q");
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    var kbd = document.querySelector(".search kbd");
    if (kbd && isMac) kbd.textContent = "⌘ K";

    document.addEventListener("keydown", function (e) {
      if (!input) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); input.focus(); input.select();
      } else if (e.key === "/" && !typing) {
        e.preventDefault(); input.focus();
      } else if (e.key === "Escape" && e.target === input) {
        input.blur();
      }
    });

    // detail pages: arrow keys walk the catalogue
    var prev = document.querySelector(".pager .prev"), next = document.querySelector(".pager .next");
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft" && prev) location.href = prev.href;
      if (e.key === "ArrowRight" && next) location.href = next.href;
    });
  });
})();
