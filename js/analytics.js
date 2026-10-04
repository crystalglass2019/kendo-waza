/*
 * アクセス数の計測（GoatCounter：無料・Cookie不使用のアクセス解析）
 * 使い方：GoatCounter で登録したコードを下の GOATCOUNTER_CODE に入れる。
 *   例）管理画面のURLが https://kendo-waza.goatcounter.com なら 'kendo-waza'
 * 空のままなら何もしない。手元（localhost / ファイル直接）で開いたときも計測しない。
 * 技のページ（#men など）を開くごとに、そのページへのアクセスとして記録される。
 */
(() => {
  const GOATCOUNTER_CODE = 'kendo-waza';
  if (!GOATCOUNTER_CODE || location.protocol === 'file:' || /^(localhost|127\.)/.test(location.hostname)) return;

  window.ANALYTICS_NOTE = 'アクセス数の計測に GoatCounter（Cookieを使わないアクセス解析）を利用しています。';
  const path = () => location.pathname + (location.hash.length > 1 ? location.hash : '');
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  s.onload = () => {
    const count = () => window.goatcounter && window.goatcounter.count({ path: path(), title: document.title });
    // 画面の組み立て後に数える（タイトルが技名になってから）
    setTimeout(count, 300);
    window.addEventListener('hashchange', () => setTimeout(count, 300));
  };
  document.head.appendChild(s);
})();
