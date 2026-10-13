/*
 * 画面の HTML テンプレート（文字列を返すだけの関数）
 * ブラウザ（app.js）と、検索エンジン向けに静的な HTML を作るビルド（tools/build-pages.js）の両方で使う。
 * root：サイトの一番上までの相対パス（一覧は ''、技のページは '../'）
 */
const Templates = (() => {
  const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  const LEVEL = ['', '初級', '中級', '上級'];
  const groupOf = id => WAZA_GROUPS.find(g => g.id === id);
  const partClass = p => ({ 面: 'men', 小手: 'kote', 胴: 'do', 突き: 'tsuki' }[p] || 'men');
  const VIEW_LABELS = [['side', '横から'], ['attacker', '攻撃側から'], ['receiver', '相手側から'], ['free', '自由視点']];
  const DEFAULT_VIEW = 'attacker'; // 最初に表示する視点（分解5コマの静止画も、この視点で用意する）
  const wazaUrl = (root, id) => `${root}${id}/`;
  const homeUrl = root => root || './';
  const termUrl = (root, id) => `${root}yogo/${id}/`;
  const glossary = () => (typeof GLOSSARY !== 'undefined' ? GLOSSARY : []);
  const videos = () => (typeof SITE_VIDEOS !== 'undefined' ? SITE_VIDEOS : []);
  const readyWaza = () => WAZA_LIST.filter(w => w.status === 'ready');
  // ページがある技：ready＝3D付き、text＝文章のみ（3Dは準備中）
  const isPublic = w => w.status === 'ready' || w.status === 'text';
  const publicWaza = () => WAZA_LIST.filter(isPublic);
  // 用語名から用語ページを探す（例：「出ばな」→「起こり・出ばな」）
  const findTerm = name => glossary().find(g => g.term.split('・').includes(name) || g.term === name);

  // YouTube 動画：最初はサムネイルだけを表示し、押したときに読み込む（ページを軽く保つ）
  function videoHTML(v) {
    return `
        <figure class="yt-wrap">
          <div class="yt" data-id="${v.id}">
            <button class="yt-play" aria-label="動画を再生：${v.title}">
              <img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="${v.title}" width="480" height="360" loading="lazy">
              <span class="yt-btn" aria-hidden="true">▶</span>
            </button>
          </div>
          <figcaption>${v.title}（${v.length}）｜<a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">YouTubeで見る</a></figcaption>
        </figure>`;
  }

  function termLinksHTML(root, ids) {
    return `<ul class="term-links">${ids.map(id => glossary().find(g => g.id === id)).filter(Boolean)
      .map(g => `<li><a href="${termUrl(root, g.id)}"><b>${g.term}</b><small>${g.kana}</small></a></li>`).join('')}</ul>`;
  }

  /* ---------- 一覧 ---------- */
  function card(w, root) {
    const ready = isPublic(w);
    const textOnly = w.status === 'text';
    const inner = `
        <div class="card-top">
          <span class="part part-${partClass(w.part)}">${w.part}</span>
          <span class="badge ${textOnly ? 'text' : ready ? 'ready' : 'soon'}">${textOnly ? '解説のみ（3D準備中）' : ready ? '公開中' : '準備中'}</span>
        </div>
        <h3>${w.name}${w.alias ? `<small>（${w.alias}）</small>` : ''}</h3>
        <p class="kana">${w.kana}</p>
        <p class="summary">${w.summary}</p>
        <p class="level"><span class="stars">${stars(w.level)}</span>${LEVEL[w.level]}</p>`;
    return ready
      ? `<a class="card is-ready" href="${wazaUrl(root, w.id)}">${inner}<span class="go">詳しく見る →</span></a>`
      : `<div class="card is-soon" aria-disabled="true">${inner}</div>`;
  }

  function groupsHTML(root, state = { q: '', cat: 'all' }) {
    const q = state.q.trim();
    const html = WAZA_GROUPS
      .filter(g => state.cat === 'all' || g.category === state.cat)
      .map(g => {
        const items = WAZA_LIST.filter(w => w.group === g.id && (!q || w.name.includes(q) || w.kana.includes(q) || (w.alias || '').includes(q)));
        if (!items.length) return '';
        return `
            <section class="group">
              <div class="group-head">
                <span class="cat-tag ${g.category === '応じ技' ? 'oji' : 'shikake'}">${g.category}</span>
                <h2>${g.name}</h2>
                <p>${g.desc}</p>
              </div>
              <div class="cards">${items.map(w => card(w, root)).join('')}</div>
            </section>`;
      }).join('');
    return html || '<p class="empty">該当する技がありません</p>';
  }

  function listHTML(root) {
    return `
      <header class="hero">
        <p class="eyebrow">KENDO WAZA ZUKAN</p>
        <h1>剣道 技図鑑</h1>
        <p class="hero-lead">1つの技を、動き・スロー・攻める側と受ける側のコツ・一本になる条件まで、ひとつのページで。</p>
      </header>
      <div class="toolbar">
        <input id="q" type="search" placeholder="技の名前で探す（例：こて、面）" aria-label="技を検索">
        <div class="chips" role="tablist">
          <button class="chip is-on" data-cat="all">すべて</button>
          <button class="chip" data-cat="しかけ技">しかけ技</button>
          <button class="chip" data-cat="応じ技">応じ技</button>
        </div>
      </div>
      <div id="groups">${groupsHTML(root)}</div>
      ${videos().length ? `
      <section class="group">
        <div class="group-head"><h2>紹介動画</h2><p>剣道 技図鑑でできることを、1分30秒で紹介しています。</p></div>
        ${videoHTML(videos()[0])}
      </section>` : ''}
      ${glossary().length ? `
      <section class="group">
        <div class="group-head"><h2>剣道用語の解説</h2><p>技のページに出てくる言葉を、1つずつ詳しく解説しています。<a href="${root}yogo/">用語の一覧 →</a></p></div>
        ${termLinksHTML(root, glossary().map(g => g.id))}
      </section>` : ''}
      <p class="note">※ 現在は${readyWaza().map(w => `「${w.name}」`).join('')}の3D付きページと、${WAZA_LIST.filter(w => w.status === 'text').map(w => `「${w.name}」`).join('')}の解説ページ（3Dアニメは準備中）を公開しています（試作版）。他の技は順次追加予定です。</p>`;
  }

  /* ---------- 技の詳細 ---------- */
  function detailHTML(id, root, opts = {}) {
    const w = WAZA_LIST.find(x => x.id === id);
    const d = WAZA_DETAIL[id];
    const g = groupOf(w.group);
    const anim = d.anim;
    const hasAnim = !!anim; // 3Dのない「文章のみ」の技は anim を持たない
    const roleChip = r => `<span class="role role-${r.mark}"><i></i>${r.name}<small>（${r.sub}）</small></span>`;

    const vids = videos().filter(v => (v.waza || []).includes(id));
    const terms = glossary().filter(t => (t.waza || []).includes(id));
    const related = publicWaza().filter(x => x.id !== id);
    const kwTerm = k => { const t = findTerm(k.term); return t ? `<a href="${termUrl(root, t.id)}">${k.term}</a>` : k.term; };

    const motion3D = hasAnim ? `
      <section id="sec-motion" class="sec">
        <h2><span class="num">1</span>${w.name}の打ち方（動作）</h2>
        <div class="legend">${roleChip(d.roles.A)}${roleChip(d.roles.B)}</div>

        <div class="player">
          <div class="mode" role="tablist" aria-label="再生モード">
            <button data-speed="1" class="is-on">▶ 等速</button>
            <button data-speed="0.5">スロー（1/2）</button>
            <button data-speed="0.25">🐢 超スロー（1/4）</button>
          </div>
          <div class="views" role="tablist" aria-label="視点">
            <span class="views-label">視点</span>
            ${VIEW_LABELS.map(([k, label]) => `<button data-view="${k}" class="${k === DEFAULT_VIEW ? 'is-on' : ''}">${label}</button>`).join('')}
          </div>
          <div class="stage" id="stage">
            ${opts.no3d ? '<p class="no3d">3D表示に必要なライブラリを読み込めませんでした。インターネットに接続した状態で開いてください。</p>' : ''}
            <div class="ov-kiai" id="kiaiA" hidden></div>
            <div class="ov-kiai" id="kiaiB" hidden></div>
            <div class="ov-ippon" id="ippon"><span class="flags"><i></i><i></i><i></i></span>${anim.ippon ? anim.ippon.label : ''}</div>
            <p class="ov-hint" id="hint" hidden>ドラッグで回転・ホイールで拡大縮小</p>
            <button class="big-play" id="bigPlay" aria-label="再生">▶</button>
          </div>
          <div class="controls">
            <button id="playBtn" class="ctl" aria-label="再生/一時停止">▶</button>
            <button id="prevBtn" class="ctl" aria-label="コマ戻し">◀︎|</button>
            <button id="nextBtn" class="ctl" aria-label="コマ送り">|▶︎</button>
            <input id="seek" type="range" min="0" max="${anim.duration}" step="0.01" value="0" aria-label="再生位置">
            <span id="time" class="time">0.00s</span>
            <label class="toggle"><input type="checkbox" id="trail"> 剣先の軌跡</label>
            <label class="toggle"><input type="checkbox" id="sound"> 音</label>
          </div>
          <ol class="phases">${anim.phases.map(p => `<li><button data-t="${p.from + 0.001}"><b>${p.no}</b>${p.title}</button></li>`).join('')}</ol>
          <div class="now">
            <p class="now-title" id="nowTitle"><b>${anim.phases[0].no}</b>${anim.phases[0].title}</p>
            <p class="now-text" id="nowText">${anim.phases[0].text}</p>
          </div>
          <div class="checks" aria-live="polite">
            <p class="checks-title">有効打突チェック <small>— 再生に合わせて点灯します</small></p>
            <ul>${anim.checks.map(c => `<li data-key="${c.key}"><span class="dot"></span><b>${c.label}</b><small>${c.note}</small></li>`).join('')}</ul>
          </div>
        </div>

        <h3 class="sub">分解して見る（5コマ）<small class="sub-note" id="stillView"></small></h3>
        <ol class="steps">
          ${d.steps.map((s, i) => `
            <li class="step">
              <div class="still-wrap">
                <img class="still-img" src="${root}img/waza/${id}/step${i + 1}.jpg" alt="${w.name}のSTEP${i + 1}「${s.title}」：${s.text}" width="960" height="540" loading="lazy">
                <canvas class="still" data-i="${i}" aria-label="${s.title}" hidden></canvas>
              </div>
              <div class="step-body">
                <p class="step-no">STEP ${i + 1}</p>
                <h4>${s.title}</h4>
                <p>${s.text}</p>
              </div>
            </li>`).join('')}
        </ol>
      </section>
    ` : '';
    const motionText = !hasAnim ? `
      <section id="sec-motion" class="sec">
        <h2><span class="num">1</span>${w.name}の打ち方（動作の流れ）</h2>
        <p class="no3d-note">※ ${w.name}の3Dアニメーションは準備中です。公開までは、動きの流れを文章で解説します。</p>
        <ol class="steps steps-text">
          ${d.steps.map((s, i) => `
            <li class="step">
              <div class="step-body">
                <p class="step-no">STEP ${i + 1}</p>
                <h4>${s.title}</h4>
                <p>${s.text}</p>
              </div>
            </li>`).join('')}
        </ol>
      </section>
    ` : '';

    return `
      <nav class="crumbs" aria-label="現在地"><a href="${homeUrl(root)}">剣道 技図鑑</a><span>›</span><span>${g.name}</span><span>›</span><span aria-current="page">${w.name}</span></nav>
      <header class="waza-hero">
        <div class="waza-tags">
          <span class="cat-tag shikake">${g.category}</span><span class="tag">${g.name}</span><span class="tag">打突部位：${w.part}</span><span class="tag">${stars(w.level)} ${LEVEL[w.level]}</span>
        </div>
        <h1>${w.name}<span class="kana-l">${w.kana}</span></h1>
        <p class="catch">${d.catch}</p>
      </header>

      <nav class="toc" aria-label="ページ内メニュー">
        <a href="#sec-motion" data-sec="sec-motion">${hasAnim ? '動作' : '打ち方の流れ'}</a><a href="#sec-overview" data-sec="sec-overview">概要</a><a href="#sec-attacker" data-sec="sec-attacker">技を出す側</a><a href="#sec-receiver" data-sec="sec-receiver">受ける側</a><a href="#sec-match" data-sec="sec-match">試合・一本の条件</a>
      </nav>

      ${hasAnim ? motion3D : motionText}

      <section id="sec-overview" class="sec">
        <h2><span class="num">2</span>${w.name}とは（概要）</h2>
        <p class="lead">${d.overview.lead}</p>
        ${d.overview.body.map(p => `<p>${p}</p>`).join('')}
        <dl class="facts">${d.overview.facts.map(f => `<div><dt>${f.label}</dt><dd>${f.value}</dd></div>`).join('')}</dl>
        <h3 class="sub">覚えておきたい言葉</h3>
        <dl class="glossary">${d.overview.keywords.map(k => `<div><dt>${kwTerm(k)}</dt><dd>${k.desc}</dd></div>`).join('')}</dl>
      </section>

      <section id="sec-attacker" class="sec">
        <h2><span class="num">3</span>${w.name}を打つときのコツ（技を出す側） <small class="role-inline role-red"><i></i>掛かり手</small></h2>
        <ol class="points">${d.attacker.points.map(p => `<li><h4>${p.title}</h4><p>${p.text}</p></li>`).join('')}</ol>
        <div class="ng-box">
          <p class="ng-title">よくある失敗</p>
          <ul>${d.attacker.mistakes.map(m => `<li>${m}</li>`).join('')}</ul>
        </div>
      </section>

      <section id="sec-receiver" class="sec">
        <h2><span class="num">4</span>受ける側（元立ち）が気にすること <small class="role-inline role-white"><i></i>元立ち</small></h2>
        <p class="lead">${d.receiver.intro}</p>
        <ol class="points">${d.receiver.points.map(p => `<li><h4>${p.title}</h4><p>${p.text}</p></li>`).join('')}</ol>
        <p class="lesson">${d.receiver.lesson}</p>
      </section>

      <section id="sec-match" class="sec">
        <h2><span class="num">5</span>${w.name}が一本になる条件・ならない理由</h2>
        <blockquote class="rule"><p>${d.match.rule.quote}</p><cite>${d.match.rule.source}</cite></blockquote>
        ${glossary().some(t => t.id === 'yuko-datotsu') ? `<p class="more"><a href="${termUrl(root, 'yuko-datotsu')}">有効打突について詳しく →</a></p>` : ''}
        <p>竹刀が当たっただけでは一本になりません。${w.name}の場合、6つの条件はそれぞれ次のように見られます。</p>
        <div class="table-wrap">
          <table class="criteria">
            <thead><tr><th>条件</th><th class="ok">○ 一本になる${w.name}</th><th class="ng">× 一本にならない例</th></tr></thead>
            <tbody>${d.match.criteria.map(c => `<tr><th>${c.label}</th><td data-h="○ 一本になる">${c.ok}</td><td data-h="× ならない例">${c.ng}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <h3 class="sub">審判の判定</h3>
        <ul class="bullets">${d.match.judging.map(j => `<li>${j}</li>`).join('')}</ul>
        <h3 class="sub">${w.name}を一本にするコツ</h3>
        <ol class="points">${d.match.tips.map(p => `<li><h4>${p.title}</h4><p>${p.text}</p></li>`).join('')}</ol>
        <div class="watch">
          <p class="watch-title">${d.match.watch.title}</p>
          <ol>${d.match.watch.items.map(x => `<li>${x}</li>`).join('')}</ol>
        </div>
      </section>

      <section class="sec related" aria-label="関連">
        ${related.length ? `<h2>関連する技</h2>
        <div class="cards">${related.map(x => card(x, root)).join('')}</div>` : ''}
        ${terms.length ? `<h2>${w.name}に関係する剣道用語</h2>${termLinksHTML(root, terms.map(t => t.id))}` : ''}
        ${vids.length ? `<h2>関連動画</h2>${vids.map(videoHTML).join('')}` : ''}
      </section>

      <footer class="foot">
        <p>※ 本ページの解説は一般的な指導内容をもとにした試作版です。細かな考え方は指導者・地域によって異なる場合があります。公開前に指導者・有段者による監修を推奨します。</p>
        ${opts.analyticsNote ? `<p>${opts.analyticsNote}</p>` : ''}
        <a class="back" href="${homeUrl(root)}">← 技の一覧に戻る</a>
      </footer>`;
  }

  /* ---------- 用語のページ ---------- */
  function termHTML(id, root) {
    const t = glossary().find(g => g.id === id);
    const waza = (t.waza || []).map(wid => WAZA_LIST.find(w => w.id === wid)).filter(w => w && isPublic(w));
    return `
      <nav class="crumbs" aria-label="現在地"><a href="${homeUrl(root)}">剣道 技図鑑</a><span>›</span><a href="${root}yogo/">剣道用語</a><span>›</span><span aria-current="page">${t.term}</span></nav>
      <header class="waza-hero">
        <div class="waza-tags"><span class="tag">剣道用語</span></div>
        <h1>${t.term}<span class="kana-l">${t.kana}</span></h1>
        <p class="catch">${t.summary}</p>
      </header>

      <section class="sec">
        <h2>${t.term}（${t.kana}）とは</h2>
        ${t.body.map(p => `<p>${p}</p>`).join('')}
      </section>

      <section class="sec">
        <h2>${t.term}のポイント</h2>
        <ol class="points">${t.points.map(p => `<li><h4>${p.title}</h4><p>${p.text}</p></li>`).join('')}</ol>
      </section>

      <section class="sec related">
        ${waza.length ? `<h2>${t.term}が大切になる技</h2>
        <div class="cards">${waza.map(w => card(w, root)).join('')}</div>` : ''}
        ${(t.related || []).length ? `<h2>関連する用語</h2>${termLinksHTML(root, t.related)}` : ''}
      </section>

      <footer class="foot">
        <p>※ 一般的な指導内容をもとにした解説です。細かな考え方は指導者・地域によって異なる場合があります。</p>
        <a class="back" href="${root}yogo/">← 剣道用語の一覧</a>　<a class="back" href="${homeUrl(root)}">← 技の一覧</a>
      </footer>`;
  }

  function termIndexHTML(root) {
    return `
      <nav class="crumbs" aria-label="現在地"><a href="${homeUrl(root)}">剣道 技図鑑</a><span>›</span><span aria-current="page">剣道用語</span></nav>
      <header class="waza-hero">
        <h1>剣道用語の解説</h1>
        <p class="catch">技の解説に出てくる剣道の言葉を、1つずつ分かりやすく。</p>
      </header>
      <section class="sec">
        <dl class="glossary term-index">${glossary().map(g => `<div><dt><a href="${termUrl(root, g.id)}">${g.term}</a><small>${g.kana}</small></dt><dd>${g.summary}</dd></div>`).join('')}</dl>
      </section>
      <footer class="foot"><a class="back" href="${homeUrl(root)}">← 技の一覧</a></footer>`;
  }

  return { DEFAULT_VIEW, listHTML, groupsHTML, detailHTML, termHTML, termIndexHTML, wazaUrl, homeUrl, termUrl };
})();
if (typeof module !== 'undefined') module.exports = Templates;
