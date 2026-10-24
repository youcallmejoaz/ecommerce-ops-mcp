// Replays a scripted terminal session: typed prompt, then output lines.
// window.SCRIPT = { prompt: "...", lines: [[delayMs, html], ...] }
(function () {
  const out = document.getElementById("out");
  const s = window.SCRIPT;
  const cur = '<span class="cur"></span>';
  let html = '<span class="p">❯ </span><span class="u">';
  let i = 0;
  const typeNext = () => {
    if (i < s.prompt.length) {
      html += s.prompt[i] === "<" ? "&lt;" : s.prompt[i];
      i++;
      out.innerHTML = html + "</span>" + cur;
      setTimeout(typeNext, s.typeMs ?? 28 + (i * 7919 % 23));
    } else {
      html += "</span>\n";
      out.innerHTML = html + cur;
      let t = 0;
      s.lines.forEach(([delay, line]) => {
        t += delay;
        setTimeout(() => { html += line + "\n"; out.innerHTML = html + cur; out.scrollTop = out.scrollHeight; }, t);
      });
      setTimeout(() => { document.body.dataset.done = "1"; }, t + 200);
    }
  };
  setTimeout(typeNext, s.startMs ?? 500);
})();
