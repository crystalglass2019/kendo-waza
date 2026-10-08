/*
 * 画面の組み立てと操作
 * - ページの種類は <body data-page="list|技のID" data-root="サイト先頭への相対パス"> で決まる
 *   （一覧＝/kendo-waza/、技＝/kendo-waza/men/ など。検索エンジン向けに技ごとに別のURLを持つ）
 * - HTML の中身は templates.js で作る（静的HTMLの事前生成と同じテンプレート）
 * - 以前の「#men」形式のリンクは、新しいURL（men/）へ自動で移動する
 */
(() => {
  const app = document.getElementById('app');
  const page = document.body.dataset.page || 'list';
  const root = document.body.dataset.root || '';
  let player = null;

  function start() {
    const legacy = location.hash.slice(1);
    if (page === 'list' && WAZA_DETAIL[legacy]) { location.replace(Templates.wazaUrl(root, legacy)); return; }
    if (WAZA_DETAIL[page]) renderDetail(page);
    else renderList();
  }

  /* ================= 技の一覧 ================= */
  function renderList() {
    const state = { q: '', cat: 'all' };
    app.innerHTML = Templates.listHTML(root);
    const draw = () => { document.getElementById('groups').innerHTML = Templates.groupsHTML(root, state); };
    app.querySelector('#q').addEventListener('input', e => { state.q = e.target.value; draw(); });
    app.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      app.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-on', x === b));
      state.cat = b.dataset.cat;
      draw();
    }));
  }

  /* ================= 技の詳細 ================= */
  function renderDetail(id) {
    const d = WAZA_DETAIL[id];
    const has3D = Kendo3D.available();
    app.innerHTML = Templates.detailHTML(id, root, { no3d: !has3D, analyticsNote: window.ANALYTICS_NOTE });

    // ページ内リンク：なめらかにスクロール（URL の # は書き換えない）
    app.querySelectorAll('.toc a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById(a.dataset.sec).scrollIntoView({ behavior: 'smooth' });
    }));

    if (has3D) setupPlayer(Kendo3D.prepare(d.anim), d.steps);
  }

  function setupPlayer(anim, steps) {
    const $ = s => app.querySelector(s);
    const seek = $('#seek'), time = $('#time'), playBtn = $('#playBtn'), big = $('#bigPlay');
    const nowTitle = $('#nowTitle'), nowText = $('#nowText');
    const kiaiEl = { A: $('#kiaiA'), B: $('#kiaiB') }, ippon = $('#ippon'), hint = $('#hint');
    const phaseBtns = [...app.querySelectorAll('.phases button')];
    const checkEls = [...app.querySelectorAll('.checks li')];
    let lastPhase = -1;

    player = new Kendo3D.Player($('#stage'), anim, {
      onTick: (t, p) => {
        seek.value = t;
        time.textContent = `${t.toFixed(2)}s`;
        playBtn.textContent = p.playing ? '❚❚' : '▶';
        big.hidden = p.playing || t > 0;
        hint.hidden = p.view !== 'free';
        const i = anim.phases.findIndex(ph => t >= ph.from && t < ph.to);
        if (i !== lastPhase && i >= 0) {
          lastPhase = i;
          const ph = anim.phases[i];
          nowTitle.innerHTML = `<b>${ph.no}</b>${ph.title}`;
          nowText.textContent = ph.text;
          phaseBtns.forEach((b, j) => b.classList.toggle('is-on', j === i));
        }
        anim.checks.forEach((c, j) => checkEls[j].classList.toggle('is-on', t >= c.at));
        // 掛け声の吹き出し（頭の上に追従）
        for (const who of ['A', 'B']) {
          const kz = (anim.kiai || []).find(k => k.who === who && t >= k.from && t <= k.to);
          const el = kiaiEl[who];
          if (!kz) { el.hidden = true; continue; }
          const q = p.project(`${who}.head`);
          el.hidden = false;
          el.textContent = kz.text;
          el.className = `ov-kiai${kz.strong ? ' strong' : ''}`;
          el.style.left = `${q.x * 100}%`;
          el.style.top = `${q.y * 100}%`;
        }
        ippon.classList.toggle('show', !!anim.ippon && t >= anim.ippon.from);
      },
    });

    const toggle = () => (player.playing ? player.pause() : player.play());
    playBtn.addEventListener('click', toggle);
    big.addEventListener('click', () => player.play());
    $('#stage').addEventListener('click', e => {
      if (e.target.closest('button')) return;
      if (player.view === 'free') { if (!player.stage.lastDragMoved) toggle(); player.stage.lastDragMoved = false; return; }
      toggle();
    });
    seek.addEventListener('input', () => { player.pause(); player.seek(+seek.value); });
    $('#prevBtn').addEventListener('click', () => { player.pause(); player.seek(player.t - 1 / 30); });
    $('#nextBtn').addEventListener('click', () => { player.pause(); player.seek(player.t + 1 / 30); });
    $('#trail').addEventListener('change', e => { player.trail = e.target.checked; });
    $('#sound').addEventListener('change', e => { Kendo3D.Sound.on = e.target.checked; if (e.target.checked) Kendo3D.Sound.ensure(); });
    app.querySelectorAll('.mode button').forEach(b => b.addEventListener('click', () => {
      app.querySelectorAll('.mode button').forEach(x => x.classList.toggle('is-on', x === b));
      player.speed = +b.dataset.speed;
      if (!player.playing) player.play();
    }));
    app.querySelectorAll('.views button').forEach(b => b.addEventListener('click', () => {
      app.querySelectorAll('.views button').forEach(x => x.classList.toggle('is-on', x === b));
      player.setView(b.dataset.view);
      $('#stage').classList.toggle('is-free', b.dataset.view === 'free');
      paintStills();
    }));
    phaseBtns.forEach(b => b.addEventListener('click', () => { player.pause(); player.seek(+b.dataset.t); }));

    // 分解画像（選択中の視点で描画。自由視点のときは「横から」）
    const cvs = [...app.querySelectorAll('canvas.still')];
    const stillView = $('#stillView');
    const paintStills = () => {
      const v = player.view === 'free' ? 'side' : player.view;
      stillView.textContent = `— ${Kendo3D.VIEWS[v].label}の視点`;
      cvs.forEach(c => {
        const s = steps[+c.dataset.i];
        const r = c.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.width * 9 / 16 * dpr);
        player.snapshot(c, s.t, v, s.marks);
      });
    };
    paintStills();
    let rt = null;
    const onResize = () => {
      if (!document.contains(cvs[0])) { window.removeEventListener('resize', onResize); return; }
      clearTimeout(rt); rt = setTimeout(paintStills, 200);
    };
    window.addEventListener('resize', onResize);
  }

  // 一覧ページで #men などに変わったときも、新しいURLへ移動する
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (page === 'list' && WAZA_DETAIL[id]) location.replace(Templates.wazaUrl(root, id));
  });
  start();
})();
