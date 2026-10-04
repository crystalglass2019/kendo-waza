/*
 * 剣道 技アニメーション 3D エンジン（three.js r128）
 * - 技ごとのキーフレーム（data.js の anim）から、2人の剣士の全身の姿勢を計算して描画する
 * - 座標系: 単位 ≒ cm、床 y=0、上 +y。技を出す側(A)は -x 側から +x 方向を向く
 * - キーフレームは各剣士の「自分の向き」基準で書く（p=前進量, s=右への移動量 など）
 */
const Kendo3D = (() => {
  const D2R = Math.PI / 180;
  const HIP = 90, ANK = 8;
  const L = { torso: 46, head: 70, upper: 31, fore: 32, thigh: 48, shin: 48, shinai: 118, tsuka: 27, rhand: 21, monouchi: 93 };
  const FIELDS = ['p', 's', 'crouch', 'lean', 'yaw', 'rf', 'rfs', 'rfy', 'lf', 'lfs', 'lfy', 'heel', 'gx', 'gy', 'gz', 'a', 'b', 'idle'];
  const DEFAULT_KEY = { p: 0, s: 0, crouch: 0, lean: 0, yaw: 0, rf: 16, rfs: 7, rfy: 0, lf: -22, lfs: -6, lfy: 0, heel: 18, gx: 26, gy: 14, gz: 0, a: 11, b: 0, idle: 1 };

  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => t * t * (3 - 2 * t);

  /* ================= キーフレーム補間（単調3次エルミート） ================= */
  function normalizeKeys(keys) {
    let prev = { ...DEFAULT_KEY };
    return keys.map(k => {
      const o = { ...prev, ...k };
      prev = { ...o };
      delete prev.aim; delete prev.sharp;
      if (!k.aim) delete o.aim;
      if (!k.sharp) delete o.sharp;
      return o;
    });
  }

  function buildTracks(keys) {
    const ts = keys.map(k => k.t);
    const n = keys.length;
    const tracks = {};
    for (const f of FIELDS) {
      const v = keys.map(k => k[f]);
      const d = [];
      for (let i = 0; i < n - 1; i++) d.push((v[i + 1] - v[i]) / (ts[i + 1] - ts[i] || 1));
      const mL = new Array(n).fill(0), mR = new Array(n).fill(0);
      for (let i = 1; i < n - 1; i++) {
        const m = d[i - 1] * d[i] <= 0 ? 0 : 2 / (1 / d[i - 1] + 1 / d[i]);
        mL[i] = mR[i] = m;
        // 打突の瞬間など：加速しながら到達して、ピタッと止まる
        if (keys[i].sharp) { mL[i] = 1.7 * d[i - 1]; mR[i] = 0; }
      }
      tracks[f] = { v, mL, mR };
    }
    return { ts, tracks };
  }

  function sampleState(T, t) {
    const { ts, tracks } = T;
    const n = ts.length;
    const o = {};
    if (t <= ts[0] || t >= ts[n - 1]) {
      const i = t <= ts[0] ? 0 : n - 1;
      for (const f of FIELDS) o[f] = tracks[f].v[i];
      return o;
    }
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (const f of FIELDS) {
      const tr = tracks[f];
      o[f] = h00 * tr.v[i] + h10 * h * tr.mR[i] + h01 * tr.v[i + 1] + h11 * h * tr.mL[i + 1];
    }
    return o;
  }

  /* ================= 姿勢計算 ================= */
  function ik(a, b, l1, l2, pole) {
    const ab = b.clone().sub(a);
    const d = ab.length() || 0.001;
    const dir = ab.clone().divideScalar(d);
    if (d >= l1 + l2 - 0.01) return a.clone().addScaledVector(dir, d * l1 / (l1 + l2));
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    return a.clone().addScaledVector(dir, x).addScaledVector(perp, h);
  }

  function computePose(st, P, t) {
    const dir = P.dir;
    const f0 = V(dir, 0, 0), r0 = V(0, 0, dir);
    const yaw = st.yaw * D2R, lean = st.lean * D2R;
    const F = f0.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(r0, Math.sin(yaw));
    const R = r0.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(f0, -Math.sin(yaw));
    const T = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(F, Math.sin(lean));
    const X = F.clone().multiplyScalar(Math.cos(lean)).addScaledVector(UP, -Math.sin(lean));
    const O = V(P.base, 0, 0);
    const ph = P.phase || 0;
    const breathe = 0.5 * Math.sin(t * 2.3 + ph);

    const hip = O.clone().addScaledVector(f0, st.p).addScaledVector(r0, st.s);
    hip.y = HIP - st.crouch + breathe;
    const chest = hip.clone().addScaledVector(T, L.torso);
    const head = hip.clone().addScaledVector(T, L.head);

    // 構えの「生きた」微動（剣先がわずかに動く）
    const a = (st.a + st.idle * 0.8 * Math.sin(t * 5.3 + ph)) * D2R;
    const b = (st.b + st.idle * 0.5 * Math.sin(t * 3.1 + ph * 2)) * D2R;
    const grip = hip.clone().addScaledVector(F, st.gx).addScaledVector(R, st.gz);
    grip.y = hip.y + st.gy;
    const S = F.clone().multiplyScalar(Math.cos(b)).addScaledVector(R, Math.sin(b)).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize();
    const along = d => grip.clone().addScaledVector(S, d);
    const rhand = along(L.rhand);
    // 腕を前へ伸ばすほど肩（肩甲骨）も前に出る
    const reachF = grip.clone().sub(chest).dot(F);
    const pro = clamp((reachF - 18) / 22, 0, 1);
    const shR = chest.clone().addScaledVector(R, 16 - 3 * pro).addScaledVector(X, -2 + 8 * pro);
    const shL = chest.clone().addScaledVector(R, -16).addScaledVector(X, -2 + 4 * pro);

    // 肘の向き：構えでは下・やや外、振りかぶりでは前・やや外に自然に向く
    const poleR = V().addScaledVector(UP, -1).addScaledVector(R, 0.4).addScaledVector(F, 0.5);
    const poleL = V().addScaledVector(UP, -1).addScaledVector(R, -0.4).addScaledVector(F, 0.5);
    const elR = ik(shR, rhand, L.upper, L.fore, poleR);
    const elL = ik(shL, grip, L.upper, L.fore, poleL);

    const ankR = O.clone().addScaledVector(f0, st.rf).addScaledVector(r0, st.rfs); ankR.y = ANK + st.rfy;
    const ankL = O.clone().addScaledVector(f0, st.lf).addScaledVector(r0, st.lfs); ankL.y = ANK + st.lfy;
    const hipR = hip.clone().addScaledVector(R, 9), hipL = hip.clone().addScaledVector(R, -9);
    const knR = ik(hipR, ankR, L.thigh, L.shin, F.clone().addScaledVector(R, 0.2));
    const knL = ik(hipL, ankL, L.thigh, L.shin, F.clone().addScaledVector(R, -0.2));

    // 小手の打突部位：右手首から肘側へ少し、前腕の上面
    const kote = rhand.clone().lerp(elR, 7 / L.fore).addScaledVector(UP, 3).addScaledVector(R, 2);
    // 面の打突部位（正面）：頭頂部のやや前
    const men = head.clone().addScaledVector(T, 11).addScaledVector(F, 3);

    return {
      dir, F, R, T, X, f0, r0, hip, chest, head, men, shR, shL, elR, elL, grip, rhand, S, kote,
      tip: along(L.shinai), mono: along(L.monouchi), tsuba: along(L.tsuka),
      ankR, ankL, hipR, hipL, knR, knL, st,
    };
  }

  const POINTS = ['tip', 'mono', 'kote', 'rhand', 'grip', 'head', 'hip', 'ankR', 'ankL', 'tsuba'];
  function getPoint(poses, ref) {
    const [who, name] = ref.split('.');
    const alias = { monouchi: 'mono', lhand: 'grip', rf: 'ankR', lf: 'ankL' };
    const P = poses[who];
    return (P[alias[name] || name] || P.hip).clone();
  }

  /* ================= アニメーション定義の準備 ================= */
  function prepare(def) {
    const players = {};
    let ph = 0;
    for (const id in def.players) {
      const p = def.players[id];
      players[id] = { ...p, phase: (ph += 1.7), keys: normalizeKeys(p.keys) };
    }
    const anim = { ...def, players };
    // aim 指定: 相手の部位に「物打ち」が当たるよう握りの位置を逆算
    for (const id in players) {
      const P = players[id];
      for (const k of P.keys) {
        if (!k.aim) continue;
        const [tid] = k.aim.target.split('.');
        const tp = players[tid];
        tp.T = tp.T || buildTracks(tp.keys);
        const tPose = { [tid]: computePose(sampleState(tp.T, k.t), tp, k.t) };
        const target = getPoint(tPose, k.aim.target);
        target.y += k.aim.dy || 0;
        // 握り（左手）の位置を、物打ちが目標に当たるよう逆算して k に書き込む
        const setGrip = () => {
          const tmp = computePose({ ...k, idle: 0 }, P, k.t);
          const g = target.clone().addScaledVector(tmp.S, -L.monouchi);
          const rel = g.clone().sub(tmp.hip);
          k.gx = rel.dot(tmp.F);
          k.gz = rel.dot(tmp.R);
          k.gy = g.y - tmp.hip.y;
          return computePose({ ...k, idle: 0 }, P, k.t);
        };
        let tmp = setGrip();
        // extend: 打突の瞬間に腕が伸びきるよう、踏み込みの位置（腰・両足）を前後に調整する
        if (k.aim.extend) {
          const reach = (L.upper + L.fore) * (k.aim.reach || 0.995);
          for (let it = 0; it < 30; it++) {
            const d = tmp.rhand.distanceTo(tmp.shR);
            if (Math.abs(d - reach) < 0.05) break;
            const delta = (d - reach) * 0.7;
            k.p += delta; k.rf += delta; k.lf += delta;
            tmp = setGrip();
          }
        }
      }
      P.T = buildTracks(P.keys);
    }
    return anim;
  }

  function posesAt(anim, t) {
    const o = {};
    for (const id in anim.players) {
      const P = anim.players[id];
      o[id] = computePose(sampleState(P.T, t), P, t);
    }
    return o;
  }

  /* ================= テクスチャ（すべてコードで生成） ================= */
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tx = new THREE.CanvasTexture(c);
    tx.encoding = THREE.sRGBEncoding;
    tx.anisotropy = 4;
    if (repeat) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(repeat[0], repeat[1]); }
    return tx;
  }
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  const TEX = {};
  function makeTextures() {
    if (TEX.ready) return TEX;
    // 床板
    TEX.floor = canvasTex(1024, 1024, (g, w, h) => {
      const rows = 8;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 400;
        while (x < w) {
          const len = 380 + rnd() * 420;
          const base = 168 + rnd() * 26;
          g.fillStyle = `rgb(${base + 40},${base - 5},${base - 70})`;
          g.fillRect(x, r * h / rows, len, h / rows);
          for (let i = 0; i < 26; i++) {
            g.strokeStyle = `rgba(110,70,30,${0.04 + rnd() * 0.07})`;
            g.lineWidth = 1 + rnd() * 2;
            const yy = r * h / rows + rnd() * h / rows;
            g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + rnd() * 6 - 3, x + len * 0.7, yy + rnd() * 6 - 3, x + len, yy); g.stroke();
          }
          g.fillStyle = 'rgba(70,40,15,.45)';
          g.fillRect(x, r * h / rows, 2, h / rows);
          x += len;
        }
        g.fillStyle = 'rgba(70,40,15,.5)';
        g.fillRect(0, r * h / rows, w, 2);
      }
    }, [5, 5]);
    // 袴のひだ
    TEX.pleat = canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 7; i++) {
        const x = i * w / 7;
        const grd = g.createLinearGradient(x, 0, x + w / 7, 0);
        grd.addColorStop(0, '#8d93a3'); grd.addColorStop(0.18, '#ffffff'); grd.addColorStop(0.85, '#e6e8ee'); grd.addColorStop(1, '#7c8292');
        g.fillStyle = grd; g.fillRect(x, 0, w / 7, h);
      }
    });
    // 刺子・布団（細かい縫い目）
    TEX.quilt = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.4;
      for (let y = 4; y < h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1;
      for (let y = 6; y < h; y += 8) { g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }, [1, 3]);
    TEX.quiltV = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1.6;
      for (let x = 5; x < w; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    });
    // 布地（剣道着）
    TEX.cloth = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`; g.fillRect(rnd() * w, rnd() * h, 2, 1); }
    }, [3, 3]);
    // 竹（4枚の竹の継ぎ目と節）
    TEX.bamboo = canvasTex(64, 512, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(120,80,20,.35)';
      for (let i = 0; i < 4; i++) g.fillRect(i * w / 4, 0, 1.5, h);
      for (const y of [90, 230, 380]) { g.fillStyle = 'rgba(120,80,20,.35)'; g.fillRect(0, y, w, 4); }
    });
    // 道場の壁
    TEX.wall = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#efe7d6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#8a5d34'; g.fillRect(0, h * 0.62, w, h * 0.38);
      for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(50,25,8,.25)'; g.fillRect(x, h * 0.62, 2, h * 0.38); }
      g.fillStyle = '#6e4626'; g.fillRect(0, h * 0.6, w, h * 0.03);
      for (let x = 0; x < w; x += w / 4) { g.fillStyle = '#7a5130'; g.fillRect(x, 0, 18, h * 0.62); }
      g.fillStyle = '#6e4626'; g.fillRect(0, h * 0.06, w, 10);
    }, [3, 1]);
    TEX.ready = true;
    return TEX;
  }

  function zekkenTex(top, name) {
    return canvasTex(128, 160, (g, w, h) => {
      g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b2240'; g.fillRect(0, 0, w, 38);
      g.fillStyle = '#ffffff'; g.font = 'bold 24px "Yu Gothic","Meiryo",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(top, w / 2, 20);
      g.fillStyle = '#111'; g.font = 'bold 58px "Yu Mincho","Hiragino Mincho ProN",serif';
      g.fillText(name[0], w / 2, 70); g.fillText(name[1], w / 2, 126);
    });
  }

  /* ================= 剣士モデル ================= */
  const Y = V(0, 1, 0);
  function between(mesh, a, b) {
    const d = b.clone().sub(a);
    const len = d.length() || 0.001;
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(Y, d.divideScalar(len));
    mesh.scale.set(1, len, 1);
  }
  function lin(mat) { mat.color.convertSRGBToLinear(); return mat; }
  function std(color, o = {}) { return lin(new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o })); }
  function shadowAll(obj) { obj.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }

  class Kendoka {
    constructor(scene, opts) {
      const tx = makeTextures();
      const navy = 0x1f2a48;
      const M = {
        gi: std(navy, { map: tx.cloth }),
        sleeve: std(0x223050, { map: tx.cloth }),
        hakama: std(0x1c2645, { map: tx.pleat }),
        futon: std(0x1d2744, { map: tx.quilt }),
        tare: std(0x1b2441, { map: tx.quiltV }),
        doLac: lin(new THREE.MeshPhysicalMaterial({ color: opts.doColor || 0x4a150e, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide })),
        mune: std(0x181a24, { map: tx.quilt, roughness: 0.7, side: THREE.DoubleSide }),
        leather: std(0x5a3a26, { roughness: 0.62 }),
        leatherDark: std(0x2c211b, { roughness: 0.6 }),
        metal: std(0xd1d6de, { metalness: 0.9, roughness: 0.32 }),
        face: std(0x0b0c12, { roughness: 1 }),
        skin: std(0xdcae88, { roughness: 0.7 }),
        bamboo: std(0xd8b36c, { map: tx.bamboo, roughness: 0.5 }),
        tsuka: std(0xf1e9d6, { roughness: 0.75 }),
        tsuba: std(0x141414, { roughness: 0.5 }),
        saki: std(0xf6f1e4, { roughness: 0.7 }),
        tsuru: std(0x3b2d1f),
        mark: std(opts.mark === 'red' ? 0xd2302a : 0xf5f5f1, { roughness: 0.6 }),
        himo: std(0x2d3d6e),
      };
      this.M = M;
      const root = new THREE.Group();
      scene.add(root);
      this.root = root;
      const add = (geo, mat, parent = root) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };

      /* --- 脚・袴 --- */
      const hakamaGeo = new THREE.CylinderGeometry(12.5, 17, 1, 28, 1, true);
      this.hakamaR = add(hakamaGeo, std(0x1c2645, { map: tx.pleat, side: THREE.DoubleSide }));
      this.hakamaL = add(hakamaGeo, this.hakamaR.material);
      const footGeo = new THREE.SphereGeometry(1, 16, 10);
      this.footR = new THREE.Group(); root.add(this.footR);
      this.footL = new THREE.Group(); root.add(this.footL);
      for (const ft of [this.footR, this.footL]) {
        const sole = add(footGeo, M.skin, ft); sole.scale.set(12.5, 3.6, 5); sole.position.set(6, -4.5, 0);
        const ankle = add(footGeo, M.skin, ft); ankle.scale.set(5, 5, 4.2); ankle.position.set(0, -1, 0);
      }

      /* --- 腰・胴体（胴体ローカル: x 前, y 上, z 右） --- */
      this.waist = new THREE.Group(); root.add(this.waist);
      const hipBall = add(new THREE.SphereGeometry(1, 24, 16), M.hakama, this.waist); hipBall.scale.set(16, 14, 22);
      const koshiita = add(new THREE.BoxGeometry(2.5, 13, 22), M.hakama, this.waist); koshiita.position.set(-16, 6, 0); koshiita.rotation.z = -0.12;

      this.torso = new THREE.Group(); root.add(this.torso);
      const core = add(new THREE.CylinderGeometry(1, 0.82, 1, 20), M.gi, this.torso); core.scale.set(13.5, 52, 19); core.position.y = 24;
      // 垂
      const obi = add(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), M.tare, this.torso); obi.scale.set(15.5, 7, 21); obi.position.y = 2;
      const flapGeo = new THREE.BoxGeometry(1.6, 24, 11);
      for (const z of [-11.5, 0, 11.5]) {
        const f = add(flapGeo, M.tare, this.torso); f.position.set(16.5, -11, z); f.rotation.z = 0.06;
      }
      for (const z of [-21, 21]) {
        const f = add(new THREE.BoxGeometry(12, 22, 1.6), M.tare, this.torso); f.position.set(3, -10, z);
      }
      const zk = add(new THREE.PlaneGeometry(9.5, 12), new THREE.MeshStandardMaterial({ map: zekkenTex(opts.club, opts.name), roughness: 0.9 }), this.torso);
      zk.position.set(17.5, -9, 0); zk.rotation.y = Math.PI / 2; zk.rotation.x = 0; zk.rotateX(0); zk.rotation.z = 0;
      zk.rotation.set(0, Math.PI / 2, 0.06);
      // 胴（漆塗りの胴台）
      const doProf = [];
      for (let i = 0; i <= 10; i++) { const u = i / 10; doProf.push(new THREE.Vector2(0.86 + 0.16 * Math.sin(u * Math.PI * 0.85), u * 34)); }
      const doGeo = new THREE.LatheGeometry(doProf, 32, Math.PI / 2 - 1.75, 3.5);
      const doM = add(doGeo, M.doLac, this.torso); doM.scale.set(17, 1, 19.5); doM.position.y = 8;
      const muneProf = [new THREE.Vector2(0.98, 0), new THREE.Vector2(0.9, 6), new THREE.Vector2(0.72, 13)];
      const mune = add(new THREE.LatheGeometry(muneProf, 28, Math.PI / 2 - 1.55, 3.1), M.mune, this.torso); mune.scale.set(17, 1, 19); mune.position.y = 41;
      const shGeo = new THREE.SphereGeometry(8.8, 16, 12);
      // 目印（背中の胴紐に結ぶ）
      this.markKnot = add(new THREE.SphereGeometry(2.2, 10, 8), M.mark, this.torso); this.markKnot.position.set(-15, 40, 0);

      /* --- 面 --- */
      this.headG = new THREE.Group(); root.add(this.headG);
      const men = add(new THREE.SphereGeometry(12, 28, 20), M.futon, this.headG); men.scale.set(1.0, 1.12, 0.96);
      const face = add(new THREE.SphereGeometry(1, 24, 16), M.face, this.headG); face.scale.set(8.5, 11, 8.5); face.position.set(5.5, -1, 0);
      const buchi = add(new THREE.TorusGeometry(10.5, 1.5, 8, 32), M.leatherDark, this.headG); buchi.scale.set(1, 1.16, 1); buchi.rotation.y = Math.PI / 2; buchi.position.set(8.5, -1, 0);
      // 面金（横金14本＋縦金1本）
      for (let i = 0; i < 14; i++) {
        const y = -11 + i * 22 / 13;
        const r = 9.3 * Math.sqrt(Math.max(0.08, 1 - (y + 1) * (y + 1) / 165)) + 1.2;
        const arc = 2.1;
        const g = new THREE.Group(); g.position.set(5.2, y - 1, 0); g.rotation.y = arc / 2;
        const bar = add(new THREE.TorusGeometry(r, 0.34, 5, 22, arc), M.metal, g); bar.rotation.x = Math.PI / 2;
        this.headG.add(g);
      }
      const tg = new THREE.Group(); tg.position.set(4.6, -1, 0); tg.rotation.z = -1.25;
      add(new THREE.TorusGeometry(12.8, 0.55, 6, 26, 2.5), M.metal, tg);
      this.headG.add(tg);
      // 面布団（肩を覆う）
      const ftProf = [new THREE.Vector2(11.5, -1), new THREE.Vector2(14, -9), new THREE.Vector2(18.5, -17), new THREE.Vector2(22, -23)];
      const futon = add(new THREE.LatheGeometry(ftProf, 30, Math.PI / 2 + 0.9, 2 * Math.PI - 1.8), std(0x1d2744, { map: tx.quilt, side: THREE.DoubleSide }), this.headG);
      futon.scale.set(1, 1, 1.05);
      // 突き垂
      const tsukidare = add(new THREE.LatheGeometry([new THREE.Vector2(9.5, -11), new THREE.Vector2(10.5, -19)], 12, Math.PI / 2 - 0.6, 1.2), std(0x1d2744, { map: tx.quiltV, side: THREE.DoubleSide }), this.headG);
      tsukidare.position.x = 2;

      /* --- 腕・小手 --- */
      this.shR = add(shGeo, M.sleeve); this.shL = add(shGeo, M.sleeve);
      const upGeo = new THREE.CylinderGeometry(9.2, 7.4, 1, 16, 1, true);
      const sleeveMat = std(0x223050, { map: tx.cloth, side: THREE.DoubleSide });
      this.upR = add(upGeo, sleeveMat); this.upL = add(upGeo, sleeveMat);
      const elGeo = new THREE.SphereGeometry(5.6, 12, 10);
      this.elR = add(elGeo, M.futon); this.elL = add(elGeo, M.futon);
      const foreGeo = new THREE.CylinderGeometry(5.6, 5.0, 1, 14);
      this.foreR = add(foreGeo, M.futon); this.foreL = add(foreGeo, M.futon);
      const koteGeo = new THREE.CylinderGeometry(6.6, 6.2, 1, 16);
      this.koteR = add(koteGeo, M.futon); this.koteL = add(koteGeo, M.futon);
      const fistGeo = new THREE.SphereGeometry(1, 16, 12);
      this.fistR = add(fistGeo, M.leather); this.fistL = add(fistGeo, M.leather);
      for (const f of [this.fistR, this.fistL]) f.scale.set(6.4, 7.5, 6.4);

      /* --- 竹刀（ローカル: +y が剣先、+x が弦側＝峰） --- */
      this.shinai = new THREE.Group(); root.add(this.shinai);
      const sh = this.shinai;
      const tsuka = add(new THREE.CylinderGeometry(1.7, 1.75, 30, 12), M.tsuka, sh); tsuka.position.y = 12;
      const tsuba = add(new THREE.CylinderGeometry(4.6, 4.6, 0.9, 24), M.tsuba, sh); tsuba.position.y = 27.5;
      const dome = add(new THREE.CylinderGeometry(2.2, 2.2, 1.6, 12), M.tsuba, sh); dome.position.y = 28.8;
      const bamboo = add(new THREE.CylinderGeometry(1.25, 1.65, 84, 12), M.bamboo, sh); bamboo.position.y = 29.5 + 42;
      const naka = add(new THREE.CylinderGeometry(1.55, 1.55, 2.2, 12), M.saki, sh); naka.position.y = L.shinai - 29;
      const saki = add(new THREE.CylinderGeometry(1.35, 1.3, 5, 12), M.saki, sh); saki.position.y = L.shinai - 2.5;
      const tsuru = add(new THREE.CylinderGeometry(0.22, 0.22, 88, 4), M.tsuru, sh); tsuru.position.set(1.6, 70, 0);

      /* --- 面紐・目印の房（揺れもの） --- */
      const segGeo = new THREE.CylinderGeometry(0.55, 0.55, 1, 6);
      this.himo = [0, 1].map(() => [0, 1, 2, 3].map(() => add(segGeo, M.himo)));
      const ribGeo = new THREE.BoxGeometry(0.6, 1, 3);
      this.tails = [0, 1].map(() => [0, 1, 2].map(() => add(ribGeo, M.mark)));

      shadowAll(root);
      this.tmpM = new THREE.Matrix4();
    }

    update(P, hist) {
      const { F, R, T, X, hip } = P;
      const m = this.tmpM;
      // 腰（ひねりのみ）
      this.waist.position.copy(hip);
      m.makeBasis(F, UP, R); this.waist.quaternion.setFromRotationMatrix(m);
      // 胴体（前傾込み）
      this.torso.position.copy(hip);
      m.makeBasis(X, T, R); this.torso.quaternion.setFromRotationMatrix(m);
      // 頭：前傾の一部を打ち消して、目線を相手に向ける
      const lean = P.st.lean * D2R * 0.45;
      const Fh = F.clone().multiplyScalar(Math.cos(lean)).addScaledVector(UP, -Math.sin(lean));
      const Th = UP.clone().multiplyScalar(Math.cos(lean)).addScaledVector(F, Math.sin(lean));
      this.headG.position.copy(P.head);
      m.makeBasis(Fh, Th, R); this.headG.quaternion.setFromRotationMatrix(m);

      // 脚：袴は腰から裾まで一直線の円錐（膝は袴の中）
      const hemOf = (hipJ, ank) => {
        const h = ank.clone(); h.y = Math.max(ank.y + 3, 5);
        return h.addScaledVector(F, 1);
      };
      const topR = P.hipR.clone().addScaledVector(UP, 4), topL = P.hipL.clone().addScaledVector(UP, 4);
      between(this.hakamaL, hemOf(P.hipL, P.ankL), topL);
      between(this.hakamaR, hemOf(P.hipR, P.ankR), topR);
      const footPose = (g, ank, pitch) => {
        g.position.copy(ank);
        m.makeBasis(P.F, UP, P.R); g.quaternion.setFromRotationMatrix(m);
        g.rotateZ(pitch);
      };
      footPose(this.footR, P.ankR, clamp(P.st.rfy * 1.6, 0, 18) * D2R);
      footPose(this.footL, P.ankL, -P.st.heel * D2R);
      // 左かかとを上げると足首位置がずれるので、つま先を床に合わせる
      this.footL.position.y = P.ankL.y + Math.sin(P.st.heel * D2R) * 5 - 1;

      // 腕
      this.shR.position.copy(P.shR); this.shL.position.copy(P.shL);
      between(this.upR, P.shR, P.elR); between(this.upL, P.shL, P.elL);
      this.elR.position.copy(P.elR); this.elL.position.copy(P.elL);
      between(this.foreR, P.elR, P.rhand); between(this.foreL, P.elL, P.grip);
      between(this.koteR, P.elR.clone().lerp(P.rhand, 0.42), P.elR.clone().lerp(P.rhand, 0.9));
      between(this.koteL, P.elL.clone().lerp(P.grip, 0.42), P.elL.clone().lerp(P.grip, 0.9));

      // 竹刀の向き：+y を剣先方向、+x を弦（上側）に
      const S = P.S;
      const up = UP.clone().addScaledVector(S, -UP.dot(S));
      if (up.lengthSq() < 1e-4) up.copy(P.F).negate();
      up.normalize();
      const Z = up.clone().cross(S);
      m.makeBasis(up, S, Z);
      this.shinai.position.copy(P.grip).addScaledVector(S, -3);
      this.shinai.quaternion.setFromRotationMatrix(m);
      this.fistR.position.copy(P.rhand); this.fistR.quaternion.copy(this.shinai.quaternion);
      this.fistL.position.copy(P.grip).addScaledVector(S, 1); this.fistL.quaternion.copy(this.shinai.quaternion);

      // 面紐：頭の後ろから垂れ、動きに遅れてなびく（長さ一定の鎖として計算）
      const chain = (anchors, seg, n, back) => {
        const pts = [anchors[0]];
        for (let k = 1; k <= n; k++) {
          const lag = anchors[Math.min(k, anchors.length - 1)].clone().sub(anchors[0]);
          const pull = V(0, -1, 0).addScaledVector(back, 0.35).addScaledVector(lag, 0.06 * k);
          pts.push(pts[k - 1].clone().addScaledVector(pull.normalize(), seg));
        }
        return pts;
      };
      [-3, 3].forEach((zOff, i) => {
        const anchors = hist.map(H => H.head.clone().addScaledVector(H.F, -11).addScaledVector(H.R, zOff).addScaledVector(UP, 2));
        const pts = chain(anchors, 6.5, 4, F.clone().negate());
        this.himo[i].forEach((s, k) => between(s, pts[k], pts[k + 1]));
      });
      // 目印：背中の胴紐から垂れる2本の房
      [-1, 1].forEach((side, i) => {
        const anchors = hist.map(H => H.chest.clone().addScaledVector(H.X, -15).addScaledVector(H.T, -6));
        const pts = chain(anchors, 5.5, 3, F.clone().negate().addScaledVector(R, side * 0.5));
        this.tails[i].forEach((s, k) => between(s, pts[k], pts[k + 1]));
      });
    }
  }

  /* ================= 視点 ================= */
  const VIEWS = {
    side: { label: '横から', pos: V(0, 122, 430), target: V(0, 98, 0), follow: true },
    attacker: { label: '攻撃側から', pos: V(-320, 178, 170), target: V(45, 114, -12) },
    receiver: { label: '相手側から', pos: V(320, 178, -170), target: V(-45, 114, 12) },
  };

  /* ================= ステージ（シーン一式） ================= */
  class Stage {
    constructor(container, anim) {
      this.anim = anim;
      this.container = container;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.prepend(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe9dfcc);
      scene.fog = new THREE.Fog(0xe9dfcc, 900, 1700);
      this.scene = scene;
      const camera = new THREE.PerspectiveCamera(32, 16 / 9, 10, 4000);
      this.camera = camera;

      // 照明
      scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a6a45, 0.55));
      const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
      sun.position.set(160, 520, 300);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -320, right: 320, top: 320, bottom: -320, near: 100, far: 1200 });
      sun.shadow.bias = -0.0004;
      sun.shadow.radius = 4;
      scene.add(sun);
      const rim = new THREE.DirectionalLight(0xdfe8ff, 0.35);
      rim.position.set(-300, 260, -400);
      scene.add(rim);

      // 床・試合場の線・壁
      const tx = makeTextures();
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: tx.floor, roughness: 0.55, metalness: 0 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const tape = std(0xf7f7f2, { roughness: 0.6 });
      for (const x of [-70, 70]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(5, 60), tape);
        l.rotation.x = -Math.PI / 2; l.position.set(x, 0.15, 0); l.receiveShadow = true; scene.add(l);
      }
      for (const r of [Math.PI / 4, -Math.PI / 4]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(5, 30), tape);
        l.rotation.set(-Math.PI / 2, 0, r); l.position.set(0, 0.15, 0); scene.add(l);
      }
      for (const [x, z, w, d] of [[0, -550, 1100, 7], [0, 550, 1100, 7], [-550, 0, 7, 1100], [550, 0, 7, 1100]]) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape);
        l.rotation.x = -Math.PI / 2; l.position.set(x, 0.15, z); scene.add(l);
      }
      const wallMat = new THREE.MeshStandardMaterial({ map: tx.wall, roughness: 0.9 });
      for (const [x, z, ry] of [[0, -900, 0], [0, 900, Math.PI], [-900, 0, Math.PI / 2], [900, 0, -Math.PI / 2]]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1800, 520), wallMat);
        w.position.set(x, 260, z); w.rotation.y = ry; scene.add(w);
      }

      // 剣士
      this.figs = {};
      for (const id in anim.players) {
        const p = anim.players[id];
        this.figs[id] = new Kendoka(scene, p);
      }

      // 打突の閃光・踏み込みの波紋・剣先の軌跡
      const flashTex = canvasTex(128, 128, (g, w, h) => {
        const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.25, 'rgba(255,225,120,.9)'); grd.addColorStop(1, 'rgba(255,200,60,0)');
        g.fillStyle = grd; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,230,140,.9)'; g.lineWidth = 4;
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); }
      });
      this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthTest: false, depthWrite: false }));
      this.flash.renderOrder = 10;
      scene.add(this.flash);
      this.ripple = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
      this.ripple.rotation.x = -Math.PI / 2;
      scene.add(this.ripple);
      this.trailGeo = new THREE.BufferGeometry();
      this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 200), 3));
      this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: 0xe0362b, transparent: true, opacity: 0.85, depthTest: false }));
      this.trail.renderOrder = 9;
      this.trail.frustumCulled = false;
      scene.add(this.trail);

      // カメラ
      this.view = 'side';
      this.camPos = VIEWS.side.pos.clone();
      this.camTarget = VIEWS.side.target.clone();
      this.camFrom = null;
      this.orbit = { az: 0, el: 0.12, r: 500 };
      this._bindOrbit();
    }

    setView(name) {
      if (name === this.view) return;
      if (name === 'free') {
        // 現在のカメラ位置から自由視点を開始
        const off = this.camPos.clone().sub(this.camTarget);
        this.orbit.r = off.length();
        this.orbit.az = Math.atan2(off.x, off.z);
        this.orbit.el = Math.asin(clamp(off.y / this.orbit.r, -0.2, 1.2));
        this.view = 'free';
        return;
      }
      this.camFrom = { pos: this.camPos.clone(), target: this.camTarget.clone(), t0: performance.now() };
      this.view = name;
    }

    _bindOrbit() {
      const el = this.renderer.domElement;
      let drag = null;
      el.addEventListener('pointerdown', e => {
        if (this.view !== 'free') return;
        drag = { x: e.clientX, y: e.clientY, az: this.orbit.az, el: this.orbit.el, moved: false };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        this.orbit.az = drag.az - dx * 0.008;
        this.orbit.el = clamp(drag.el + dy * 0.006, -0.05, 1.3);
      });
      const end = () => { if (drag) this.lastDragMoved = drag.moved; drag = null; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', e => {
        if (this.view !== 'free') return;
        e.preventDefault();
        this.orbit.r = clamp(this.orbit.r * (1 + e.deltaY * 0.001), 220, 900);
      }, { passive: false });
    }

    // 2人の中間点（横からの視点・自由視点はこれを追う）
    _mid() {
      const ps = Object.values(this.poses || {});
      if (!ps.length) return 0;
      return ps.reduce((a, p) => a + p.hip.x, 0) / ps.length;
    }
    viewAt(name) {
      const v = VIEWS[name];
      if (!v.follow) return v;
      const dx = this._mid();
      return { pos: v.pos.clone().setX(v.pos.x + dx), target: v.target.clone().setX(v.target.x + dx) };
    }

    _updateCamera() {
      if (this.view === 'free') {
        const { az, el, r } = this.orbit;
        const mx = this._mid();
        this.camTarget.set(mx, 100, 0);
        this.camPos.set(mx + Math.sin(az) * Math.cos(el) * r, 100 + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
      } else {
        const v = this.viewAt(this.view);
        if (this.camFrom) {
          const k = clamp((performance.now() - this.camFrom.t0) / 650, 0, 1);
          const e = smooth(k);
          this.camPos.copy(this.camFrom.pos).lerp(v.pos, e);
          this.camTarget.copy(this.camFrom.target).lerp(v.target, e);
          if (k >= 1) this.camFrom = null;
        } else {
          this.camPos.copy(v.pos);
          this.camTarget.copy(v.target);
        }
      }
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    }

    setCameraTo(name) {
      // 静止画用：遷移なしで指定視点へ
      if (name === 'free') { this._updateCamera(); return; }
      const v = this.viewAt(name);
      this.camera.position.copy(v.pos);
      this.camera.lookAt(v.target);
      this.camera.updateMatrixWorld();
    }

    resize() {
      const w = this.container.clientWidth;
      const h = Math.round(w * 9 / 16);
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.size = { w, h };
    }

    pose(t, opts = {}) {
      const anim = this.anim;
      const poses = posesAt(anim, t);
      for (const id in this.figs) {
        const hist = [0, 0.035, 0.07, 0.105, 0.14].map(d => (d === 0 ? poses[id] : posesAt(anim, Math.max(0, t - d))[id]));
        this.figs[id].update(poses[id], hist);
      }
      // 打突の閃光
      const im = (anim.impacts || [])[0];
      const dt = im ? t - im.t : -1;
      if (im && dt >= 0 && dt < 0.28) {
        const p = getPoint(posesAt(anim, im.t), im.at);
        const k = dt / 0.28;
        this.flash.visible = true;
        this.flash.position.copy(p);
        const s = 14 + 30 * Math.sqrt(k);
        this.flash.scale.set(s, s, 1);
        this.flash.material.opacity = 1 - k;
      } else this.flash.visible = false;
      // 踏み込みの波紋
      const st = anim.stomp;
      const ds = st ? t - st.t : -1;
      if (st && ds >= 0 && ds < 0.35) {
        const p = getPoint(posesAt(anim, st.t), st.at);
        const k = ds / 0.35;
        this.ripple.visible = true;
        this.ripple.position.set(p.x + 6, 0.3, p.z);
        const s = 8 + 34 * k;
        this.ripple.scale.set(s, s, s);
        this.ripple.material.opacity = 0.7 * (1 - k);
      } else this.ripple.visible = false;
      // 剣先の軌跡
      const tr = anim.trail;
      if (opts.trail && tr && t > tr.from) {
        const arr = this.trailGeo.attributes.position.array;
        const end = Math.min(t, tr.to);
        let n = 0;
        for (let u = tr.from; u <= end && n < 199; u += 1 / 100) {
          const p = getPoint(posesAt(anim, u), tr.point);
          arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z; n++;
        }
        const p = getPoint(poses, tr.point);
        arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z; n++;
        this.trailGeo.setDrawRange(0, n);
        this.trailGeo.attributes.position.needsUpdate = true;
        this.trail.visible = n > 1;
      } else this.trail.visible = false;
      this.poses = poses;
      return poses;
    }

    project(p) {
      const v = p.clone().project(this.camera);
      return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, behind: v.z > 1 };
    }

    render() { this.renderer.render(this.scene, this.camera); }
  }

  /* ================= 効果音（踏み込み・打突音） ================= */
  const Sound = {
    ctx: null,
    on: false,
    ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); },
    noise(dur, filterType, freq, gain, q = 1) {
      const c = this.ctx;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(c.destination);
      src.start();
    },
    stomp() { if (!this.on) return; this.ensure(); this.noise(0.22, 'lowpass', 260, 2.2); },
    hit() { if (!this.on) return; this.ensure(); this.noise(0.07, 'bandpass', 2600, 2.5, 1.2); },
  };

  /* ================= プレイヤー ================= */
  class Player {
    constructor(container, anim, { onTick } = {}) {
      this.anim = anim;
      this.stage = new Stage(container, anim);
      this.t = 0;
      this.speed = 1;
      this.playing = false;
      this.trail = false;
      this.onTick = onTick;
      this._hold = 0;
      this._last = performance.now();
      this._resize = () => { this.stage.resize(); };
      window.addEventListener('resize', this._resize);
      this.stage.resize();
      this._loop = now => {
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        if (this.playing) {
          const prev = this.t;
          if (this.t >= anim.duration) {
            this._hold += dt;
            if (this._hold > 1.0) { this.t = 0; this._hold = 0; }
          } else {
            this.t = Math.min(anim.duration, this.t + dt * this.speed);
            for (const s of anim.sounds || []) if (prev < s.t && this.t >= s.t) Sound[s.type]();
          }
        }
        this.draw();
        this._raf = requestAnimationFrame(this._loop);
      };
      this._raf = requestAnimationFrame(this._loop);
    }
    draw() {
      this.poses = this.stage.pose(this.t, { trail: this.trail });
      this.stage._updateCamera();
      this.stage.render();
      if (this.onTick) this.onTick(this.t, this);
    }
    seek(t) { this.t = clamp(t, 0, this.anim.duration); this._hold = 0; }
    play() { if (this.t >= this.anim.duration) this.t = 0; this.playing = true; }
    pause() { this.playing = false; }
    setView(v) { this.stage.setView(v); }
    get view() { return this.stage.view; }
    project(ref) { return this.stage.project(getPoint(this.poses, ref)); }
    // 分解画像：指定時刻・指定視点で描画して 2D キャンバスへ写す
    snapshot(canvas, t, view, marks) {
      const st = this.stage;
      const poses = st.pose(t, { trail: false });
      const keep = { pos: st.camera.position.clone(), q: st.camera.quaternion.clone() };
      st.setCameraTo(view);
      st.flash.visible = false; st.ripple.visible = false;
      st.render();
      const ctx = canvas.getContext('2d');
      ctx.drawImage(st.renderer.domElement, 0, 0, canvas.width, canvas.height);
      drawMarks(ctx, canvas.width, canvas.height, marks || [], ref => st.project(getPoint(poses, ref)));
      st.camera.position.copy(keep.pos); st.camera.quaternion.copy(keep.q);
    }
    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener('resize', this._resize);
      this.stage.renderer.dispose();
      this.stage.renderer.domElement.remove();
    }
  }

  function drawMarks(ctx, w, h, marks, proj) {
    for (const m of marks) {
      const q = proj(m.at);
      if (q.behind) continue;
      const x = q.x * w, y = q.y * h;
      const r = Math.max(10, w * 0.032);
      ctx.save();
      ctx.lineWidth = Math.max(2, w * 0.006);
      ctx.strokeStyle = '#f0a30a';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      const f = Math.max(11, w * 0.033);
      ctx.font = `700 ${f}px "Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif`;
      const tw = ctx.measureText(m.label).width;
      const lx = clamp(x - tw / 2 - f * 0.5, 4, w - tw - f - 4);
      const ly = y - r - f * 2.2 < 4 ? y + r + f * 0.6 : y - r - f * 2.2;
      ctx.beginPath(); ctx.moveTo(x, ly < y ? y - r : y + r); ctx.lineTo(clamp(x, lx + 6, lx + tw + f - 6), ly < y ? ly + f * 1.6 : ly); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f0a30a';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, ly, tw + f, f * 1.6, f * 0.4) : ctx.rect(lx, ly, tw + f, f * 1.6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label, lx + f * 0.5, ly + f * 0.82);
      ctx.restore();
    }
  }

  return { prepare, Player, VIEWS, Sound, available: () => typeof THREE !== 'undefined' };
})();
