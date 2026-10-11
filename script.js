(() => {
  'use strict';

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const veil = document.getElementById('veil');

  // Capas pintadas una sola vez (se repintan al cambiar el tamaño)
  const skyLayer = document.createElement('canvas');
  const groundLayer = document.createElement('canvas');

  // La escena se diseña en el "cuadro" del video original (576 x 1250).
  // En pantallas anchas el cuadro queda centrado y el cielo y el suelo se extienden a los lados.
  const FW = 576, FH = 1250;
  let W = 0, H = 0, DPR = 1;
  let s = 1, ox = 0, oy = 0;
  const X = (fx) => ox + fx * s;
  const Y = (fy) => oy + fy * s;
  // El suelo se estira a lo ancho lejos del niño; la cima queda intacta
  let hx = 1;
  const XG = (fx) => {
    const d = fx - 300, a = Math.abs(d);
    return X(a <= 120 ? fx : 300 + Math.sign(d) * (120 + (a - 120) * hx));
  };

  let vortices = [];
  let stars = [];
  let moon = null;
  let particles = [];
  let petals = [];
  let shooting = null;
  const pointer = { x: -9999, y: -9999, active: false };

  // ---------- utilidades ----------
  let seed = 7;
  function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rr = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[(rand() * arr.length) | 0];

  // Colores tomados del video
  const PAL = {
    deep: ['#081a6e', '#0d2a96', '#06165a', '#11299a', '#1a37a8', '#0a2084'],
    mid: ['#1f4fc0', '#2a62d0', '#1844b0', '#3474dc', '#2356c6'],
    light: ['#3fa7e6', '#5cc0ee', '#2f8fdc', '#7fd2f2', '#4ab3ea'],
    band: ['#4fd0f0', '#7fe3f5', '#38b8ec', '#a8eef8', '#5ec8e8', '#2fa0e0'],
    core: ['#d8f0f8', '#bfe6f5', '#f2efc8', '#9fdcf3', '#e9e3b0'],
    yellow: ['#ffc93a', '#ffd95e', '#f5b42a', '#ffe68a'],
    orange: ['#f7a01e', '#ffb52e', '#f08a10', '#ffc94a', '#fdbb3c'],
    teal: ['#62d0c8', '#8fe0d0', '#4fb8d8', '#b0e8c8', '#6cc8e0'],
    petal: ['#f7c52d', '#ffd84a', '#f5b51f', '#ffe27a', '#f0a81c']
  };

  // ---------- campo de flujo (remolinos) ----------
  function bandFy(fx) {
    // franja turquesa que cruza detrás del niño y sube hacia la derecha
    const c = Math.max(-250, Math.min(fx, 850));
    return 800 - 0.17 * c + 15 * Math.sin(fx / 140);
  }

  function flow(x, y, live) {
    const fx = (x - ox) / s, fy = (y - oy) / s;
    let vx = 1;
    let vy = 0.16 * Math.sin(fx / 95 + fy / 130) - 0.17;
    for (let i = 0; i < vortices.length; i++) {
      const v = vortices[i];
      const dx = x - v.x, dy = y - v.y;
      const d2 = dx * dx + dy * dy;
      const f = v.k * Math.exp(-d2 / (v.r * v.r));
      if (f < 0.002) continue;
      const d = Math.sqrt(d2) + 1;
      vx += (-dy / d) * f * 3 * v.dir - (dx / d) * f * 0.3;
      vy += (dx / d) * f * 3 * v.dir - (dy / d) * f * 0.3;
    }
    if (live && pointer.active) {
      const dx = x - pointer.x, dy = y - pointer.y;
      const d2 = dx * dx + dy * dy;
      const r = 130 * s;
      const f = 2.2 * Math.exp(-d2 / (r * r));
      const d = Math.sqrt(d2) + 1;
      vx += (-dy / d) * f * 3;
      vy += (dx / d) * f * 3;
    }
    return Math.atan2(vy, vx);
  }

  function skyColor(x, y) {
    const fx = (x - ox) / s, fy = (y - oy) / s;
    const bd = Math.abs(fy - bandFy(fx));
    let inCore = false;
    for (let i = 0; i < vortices.length; i++) {
      const v = vortices[i];
      if (v.big && Math.hypot(x - v.x, y - v.y) < v.r * 0.55) inCore = true;
    }
    // la franja turquesa pasa por encima del borde de los remolinos
    if (!inCore && bd < 75 && rand() < 0.92) return pick(rand() < 0.2 ? PAL.core : PAL.band);
    for (let i = 0; i < vortices.length; i++) {
      const v = vortices[i];
      if (!v.big) continue;
      const d = Math.hypot(x - v.x, y - v.y) / v.r;
      // dentro del remolino: azul medio; los brazos claros se pintan aparte
      if (d < 0.12 && rand() < 0.8) return pick(PAL.core);
      if (d < 0.9) return pick(rand() < 0.35 ? PAL.light : PAL.mid);
      if (d < 1.1 && rand() < 0.6) return pick(PAL.deep);
    }
    if (bd < 100 && rand() < 0.6) return pick(PAL.light);
    if (fy > 820 && rand() < 0.8) return pick(PAL.band);
    if (fy < 280) return pick(rand() < 0.78 ? PAL.deep : PAL.mid);
    return pick(rand() < 0.6 ? PAL.deep : PAL.mid);
  }

  // Pincelada cónica: gruesa al centro, fina en las puntas, sigue el campo
  function dab(c, x, y, len, width, color, angleFn, steps = 5) {
    const pts = [[x, y]];
    const seg = len / steps;
    for (let i = 0; i < steps; i++) {
      const a = angleFn(x, y);
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      pts.push([x, y]);
    }
    const left = [], right = [];
    for (let i = 0; i <= steps; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, steps)];
      const o = pts[Math.max(i - 1, 0)];
      const a = Math.atan2(q[1] - o[1], q[0] - o[0]);
      const w = width * 0.5 * (0.25 + 0.75 * Math.sin((i / steps) * Math.PI));
      const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      left.push([p[0] + nx, p[1] + ny]);
      right.push([p[0] - nx, p[1] - ny]);
    }
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) c.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
    c.closePath();
    c.fill();
  }

  // ---------- composición ----------
  function layout() {
    // en horizontal se amplía un poco y se recorta sobre todo el primer plano
    s = Math.min((H / FH) * (W > H ? 1.12 : 1), W / FW);
    ox = (W - FW * s) / 2;
    const over = H - FH * s;
    oy = over < 0 ? over * 0.25 : over;
    hx = Math.max(1, Math.min(2.4, (W / s - 100) / FW));

    const big = (fx, fy, r, k) => ({ x: X(fx), y: Y(fy), r: r * s, k, dir: 1, big: true });
    vortices = [
      big(240, 420, 175, 1.7),
      big(420, 600, 120, 1.5),
      { x: X(60), y: Y(300), r: 110 * s, k: 0.5, dir: -1 },
      { x: X(330), y: Y(60), r: 120 * s, k: 0.4, dir: 1 }
    ];

    // estrellas del video: [x, y, radio, tipo]
    const S = [
      [430, 95, 40, 'gold'], [130, 190, 27, 'teal'], [225, 200, 24, 'teal'],
      [352, 182, 26, 'teal'], [415, 295, 38, 'gold'], [140, 580, 46, 'cream'],
      [130, 718, 25, 'pale'], [8, 190, 26, 'teal']
    ];

    // relleno a los lados en pantallas anchas
    const sideW = ox / s;
    if (sideW > 30) {
      // repartidos en celdas para que no se amontonen
      const cells = Math.max(1, Math.round(sideW / 260));
      const cw = sideW / cells;
      for (let i = 0; i < cells; i++) {
        for (const side of [-1, 1]) {
          const off = i * cw + rr(0.2, 0.8) * cw;
          const fx = side < 0 ? -off : FW + 60 + off;
          S.push([fx, rr(120, 520), rr(20, 34), pick(['teal', 'gold', 'teal'])]);
          if (i % 2 === 0) vortices.push(big(fx + rr(-60, 60), rr(380, 560), rr(90, 130), 1.3));
        }
      }
    }
    // relleno arriba en pantallas muy altas
    const topH = oy / s;
    for (let i = 0; i < Math.ceil(topH / 200) * 2; i++) {
      S.push([rr(0, FW), -rr(30, topH), rr(18, 32), 'teal']);
    }

    stars = S.map(([fx, fy, r, kind]) => ({
      x: X(fx), y: Y(fy), r: r * s, kind,
      phase: rand() * Math.PI * 2,
      spin: rr(0.12, 0.3) * (rand() < 0.5 ? 1 : -1),
      arcs: Array.from({ length: 10 }, () => ({
        rad: rr(0.25, 1.1), a: rr(0, Math.PI * 2), len: rr(0.35, 0.8), w: rr(3, 6)
      }))
    }));
    stars.forEach((st) => vortices.push({ x: st.x, y: st.y, r: st.r * 2, k: 0.9, dir: 1 }));

    moon = { x: X(615), y: Y(235), r: 108 * s, phase: 0 };
    vortices.push({ x: moon.x, y: moon.y, r: moon.r * 1.6, k: 1, dir: 1 });
  }

  function starColor(kind, d) {
    // d = distancia / radio
    if (kind === 'gold') return d < 0.6 ? pick(PAL.yellow) : d < 1 ? pick(PAL.teal) : pick(PAL.light);
    if (kind === 'teal') return d < 0.4 ? pick(PAL.yellow) : d < 1 ? pick(PAL.teal) : pick(PAL.light);
    if (kind === 'cream') return d < 0.5 ? pick(['#f5f0b0', '#ffe68a', '#e8f0c0']) : d < 1 ? pick(['#cfe8b8', '#a8dcc8', '#f2e7a0']) : pick(PAL.light);
    return d < 0.5 ? pick(['#e8f0d0', '#cfe8e0']) : pick(PAL.light);
  }

  function paintHalo(c, x, y, r, colorFn) {
    // borde azul oscuro que separa la estrella del cielo
    // resplandor difuso
    const glow = c.createRadialGradient(x, y, 0, x, y, r * 1.5);
    glow.addColorStop(0, 'rgba(255,225,130,0.55)');
    glow.addColorStop(0.6, 'rgba(150,220,210,0.25)');
    glow.addColorStop(1, 'rgba(150,220,210,0)');
    c.fillStyle = glow;
    c.beginPath();
    c.arc(x, y, r * 1.5, 0, Math.PI * 2);
    c.fill();
    const n = Math.floor((r * r) / (s * s) * 0.07) + 30;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(rand()) * r * 1.25;
      const a = rand() * Math.PI * 2;
      const arc = rr(0.5, 1.1) * Math.min(1.6, r / Math.max(d, r * 0.25));
      const w = rr(4, 8) * s;
      const ang0 = a;
      c.fillStyle = colorFn(d / r);
      // pincelada curva tangencial
      c.beginPath();
      const steps = 6;
      for (let k = 0; k <= steps; k++) {
        const t = ang0 + (arc * k) / steps;
        const ww = w * 0.5 * (0.3 + 0.7 * Math.sin((k / steps) * Math.PI));
        c.lineTo(x + Math.cos(t) * (d + ww), y + Math.sin(t) * (d + ww));
      }
      for (let k = steps; k >= 0; k--) {
        const t = ang0 + (arc * k) / steps;
        const ww = w * 0.5 * (0.3 + 0.7 * Math.sin((k / steps) * Math.PI));
        c.lineTo(x + Math.cos(t) * Math.max(0, d - ww), y + Math.sin(t) * Math.max(0, d - ww));
      }
      c.closePath();
      c.fill();
    }
  }

  // Difumina el contenido de una capa (sin soporte de ctx.filter, no hace nada)
  function soften(c, cv, px, clear) {
    if (!('filter' in c)) return;
    const tmp = document.createElement('canvas');
    tmp.width = cv.width;
    tmp.height = cv.height;
    tmp.getContext('2d').drawImage(cv, 0, 0);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) c.clearRect(0, 0, cv.width, cv.height);
    c.filter = `blur(${px}px)`;
    c.drawImage(tmp, 0, 0);
    c.restore();
  }

  function sparkle(c, x, y, r) {
    c.save();
    c.translate(x, y);
    c.fillStyle = '#ffd86b';
    c.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? (i % 4 === 0 ? r : r * 0.55) : r * 0.13;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
    c.restore();
  }

  function paintSky() {
    const c = skyLayer.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, Y(900));
    g.addColorStop(0, '#0b2080');
    g.addColorStop(0.5, '#1a46b4');
    g.addColorStop(1, '#2f8ed8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    const fieldFn = (x, y) => flow(x, y, false) + rr(-0.06, 0.06);
    const skyBottom = Y(1000);
    const area = W * skyBottom;
    // 1) cuerpo de color: pinceladas largas y anchas
    const passes = [
      { len: [60, 110], w: [18, 28], per: 2400 },
      { len: [35, 70], w: [11, 18], per: 850 }
    ];
    for (const p of passes) {
      const count = Math.floor(area / (p.per * s * s));
      for (let i = 0; i < count; i++) {
        const x = rand() * W, y = rand() * skyBottom;
        dab(c, x, y, rr(p.len[0], p.len[1]) * s, rr(p.w[0], p.w[1]) * s, skyColor(x, y), fieldFn, 6);
      }
    }

    // 2) brazos claros en espiral: trazos largos que siguen el giro
    for (const v of vortices) {
      if (!v.big) continue;
      const base = rand() * Math.PI * 2;
      const n = Math.floor((v.r * v.r) / (s * s) * 0.014) + 90;
      for (let i = 0; i < n; i++) {
        const arm = (rand() * 2) | 0;
        const t = Math.sqrt(rand());
        const ang = base + arm * Math.PI - t * Math.PI * 2.4 + rr(-0.3, 0.3);
        const rad = v.r * (0.04 + 0.85 * t);
        const x = v.x + Math.cos(ang) * rad, y = v.y + Math.sin(ang) * rad;
        const col = t < 0.3 ? pick(PAL.core) : rand() < 0.3 ? pick(PAL.core) : pick(PAL.light);
        dab(c, x, y, rr(35, 75) * s, rr(8, 15) * s, col, fieldFn, 6);
      }
    }

    // 3) estrellas y luna con su resplandor
    paintHalo(c, moon.x, moon.y, moon.r, (d) =>
      d < 0.75 ? pick(['#f7a01e', '#f59a1a', '#ffb52e', '#f08a10', '#fdbb3c']) : d < 0.95 ? pick(['#ffc94a', '#e8c86a', '#9fd8b0']) : pick(PAL.teal));
    stars.forEach((st) => paintHalo(c, st.x, st.y, st.r, (d) => starColor(st.kind, d)));

    // 4) difuminar para mezclar los colores como óleo
    soften(c, skyLayer, 2 * s * DPR, false);

    // 5) detalle nítido encima: trazos finos y algunos acentos en las estrellas
    const fine = Math.floor(area / (300 * s * s));
    for (let i = 0; i < fine; i++) {
      const x = rand() * W, y = rand() * skyBottom;
      c.globalAlpha = rr(0.55, 0.9);
      dab(c, x, y, rr(18, 40) * s, rr(4, 8) * s, skyColor(x, y), fieldFn, 5);
    }
    c.globalAlpha = 1;
    for (const st of [...stars, moon]) {
      const isMoon = st === moon;
      for (let i = 0; i < (isMoon ? 60 : 14); i++) {
        const d = Math.sqrt(rand()) * st.r;
        const a = rand() * Math.PI * 2;
        const col = isMoon ? pick(PAL.orange) : d < st.r * 0.5 ? pick(PAL.yellow) : pick(PAL.teal);
        const x = st.x + Math.cos(a) * d, y = st.y + Math.sin(a) * d;
        dab(c, x, y, rr(8, 16) * s, rr(3, 5) * s, col, () => a + Math.PI / 2, 3);
      }
    }

    // motas amarillas
    const specks = Math.floor(area / (2600 * s * s));
    for (let i = 0; i < specks; i++) {
      const x = rand() * W, y = rand() * Y(860);
      dab(c, x, y, rr(5, 10) * s, rr(3, 5) * s, pick(PAL.yellow), fieldFn, 2);
    }

    sparkle(c, X(26), Y(472), 24 * s);
    if (ox > 30 * s) sparkle(c, X(FW + ox / s * 0.6), Y(420), 18 * s);
  }

  // ---------- suelo por planos de color ----------
  const FAR = 3000; // se extiende más allá del cuadro para pantallas anchas

  function poly(pts) {
    const path = new Path2D();
    path.moveTo(XG(pts[0][0]), Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) path.lineTo(XG(pts[i][0]), Y(pts[i][1]));
    path.closePath();
    return path;
  }

  function plane(c, pts, base, palette, angle, opts = {}) {
    c.save();
    const path = poly(pts);
    c.fillStyle = base;
    c.fill(path);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [fx, fy] of pts) {
      minX = Math.min(minX, XG(fx)); maxX = Math.max(maxX, XG(fx));
      minY = Math.min(minY, Y(fy)); maxY = Math.max(maxY, Y(fy));
    }
    minX = Math.max(minX, -20); maxX = Math.min(maxX, W + 20);
    minY = Math.max(minY, -20); maxY = Math.min(maxY, H + 20);
    const area = (maxX - minX) * (maxY - minY);
    const per = (opts.per || 500) * s * s;
    const n = Math.floor(area / per);
    const len = opts.len || [25, 55];
    const w = opts.w || [9, 16];
    for (let i = 0; i < n; i++) {
      const x = rr(minX, maxX), y = rr(minY, maxY);
      // sin recorte: las pinceladas que nacen dentro pueden salirse y suavizan el borde
      if (!c.isPointInPath(path, x * DPR, y * DPR)) continue;
      const a = angle + rr(-0.25, 0.25);
      dab(c, x, y, rr(len[0], len[1]) * s, rr(w[0], w[1]) * s, pick(palette), () => a + rr(-0.05, 0.05), 3);
    }
    c.restore();
  }

  function leaf(c, x, y, l, w, rot, color) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-l, 0);
    c.quadraticCurveTo(0, -w, l, 0);
    c.quadraticCurveTo(0, w, -l, 0);
    c.fill();
    c.restore();
  }

  function paintGround() {
    const c = groundLayer.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);

    // montañas lejanas a la derecha con pueblo
    plane(c, [[330, 925], [420, 892], [500, 896], [576, 905], [FAR, 915], [FAR, 1150], [330, 1150]],
      '#23489f', ['#23489f', '#2f5ab5', '#1a3a8a', '#3a6ac0', '#1c3c94'], -0.15, { per: 420 });
    c.save();
    for (let i = 0; i < 200; i++) {
      const fx = rr(430, 700);
      const fy = rr(905, 990);
      const col = rand() < 0.12 ? pick(['#f7d35a', '#ffe9a0']) : pick(['#6aa0e0', '#1a2f80', '#9fc8f0', '#3a5ab8']);
      c.fillStyle = col;
      c.fillRect(XG(fx), Y(fy), rr(3, 6) * s, rr(3, 5) * s);
    }
    c.restore();

    // montañas lejanas a la izquierda
    plane(c, [[-FAR, 905], [0, 895], [28, 862], [62, 878], [110, 898], [165, 935], [240, 962], [240, 1150], [-FAR, 1150]],
      '#14307f', ['#14307f', '#1c3c94', '#0f2670', '#2448a8', '#18358c'], -0.3, { per: 420 });

    // campanario y ciprés
    // ancho fijo: solo la posición sigue el estiramiento del suelo
    const spike = (cx, pts) => {
      const bx0 = XG(cx);
      c.beginPath();
      pts.forEach(([dx, fy], i) => (i ? c.lineTo : c.moveTo).call(c, bx0 + dx * s, Y(fy)));
      c.closePath();
      c.fill();
    };
    c.fillStyle = '#0d1f5e';
    spike(30, [[-10, 1000], [-4, 890], [0, 818], [4, 890], [10, 1000]]);
    spike(78, [[-16, 1000], [-6, 910], [0, 872], [6, 910], [16, 1000]]);
    c.strokeStyle = '#3f7fd0';
    c.lineWidth = 2 * s;
    c.beginPath();
    c.moveTo(XG(30), Y(824));
    c.lineTo(XG(30) + 6 * s, Y(880));
    c.stroke();

    // cara izquierda del pico: rosa, morado, óxido
    plane(c, [[228, 882], [150, 955], [60, 1005], [-300, 1110], [-FAR, 1110], [-FAR, 1300], [260, 1300], [300, 1000], [262, 930]],
      '#8c5e9a', ['#a35f7a', '#8c5ea8', '#c0786a', '#7a4f8f', '#b4709a', '#6a5aa8', '#4f6ac0'], 2.0);
    // cara frontal azul
    plane(c, [[262, 930], [300, 1000], [260, 1300], [520, 1300], [455, 1060], [385, 960], [335, 900], [300, 885]],
      '#3a6ac8', ['#3a6ac8', '#4a7ad8', '#2f58b0', '#5a8ae0', '#6a6ab8', '#7a5ea8'], 1.75);
    // ladera derecha azul-morada
    plane(c, [[335, 880], [405, 892], [445, 918], [525, 978], [900, 1080], [FAR, 1080], [FAR, 1300], [520, 1300], [455, 1060], [385, 960], [335, 900]],
      '#4a6ac0', ['#3f6fc8', '#5a62b0', '#2f5aa8', '#7a6ab8', '#4a8ad0'], 0.55);
    // cresta verde que baja a la derecha
    plane(c, [[300, 965], [380, 935], [430, 940], [480, 968], [560, 1000], [900, 1080], [FAR, 1080], [FAR, 1110], [900, 1115], [540, 1035], [440, 1002], [340, 990]],
      '#4fae4a', ['#5cc04a', '#8fd650', '#46a83e', '#3f9a5a', '#4a8ad0', '#6cc8a0', '#3a7ac0'], 0.38, { per: 380 });
    // ladera verde izquierda baja
    plane(c, [[-FAR, 1150], [-300, 1140], [60, 1010], [120, 1028], [150, 1052], [80, 1080], [-300, 1185], [-FAR, 1190]],
      '#3f9a52', ['#4fb04a', '#7acc4a', '#3a9a52', '#2f7a8a', '#3a6ac0'], -0.35, { per: 380 });
    // primer plano: azul con toques verdes
    plane(c, [[-FAR, 1170], [-300, 1170], [90, 1105], [300, 1135], [576, 1112], [900, 1150], [FAR, 1150], [FAR, 1300], [-FAR, 1300]],
      '#24489f', ['#2a5aa8', '#1f3f98', '#3f6fc0', '#3f9a4a', '#4a7ad0', '#64b84a', '#2f4fa8'], -0.25);
    // cresta verde diagonal del primer plano
    plane(c, [[-FAR, 1240], [-300, 1235], [40, 1205], [200, 1170], [380, 1140], [470, 1128], [900, 1150], [FAR, 1155], [FAR, 1175], [900, 1172], [460, 1150], [300, 1175], [100, 1220], [-300, 1260], [-FAR, 1265]],
      '#4ab04a', ['#5cc04a', '#7fd650', '#46a83e', '#3f9a5a'], -0.25, { per: 320, len: [30, 60], w: [7, 11] });

    soften(c, groundLayer, 2 * s * DPR, true);
    // el campanario y el ciprés se repintan nítidos
    c.fillStyle = '#0d1f5e';
    spike(30, [[-10, 1000], [-4, 890], [0, 818], [4, 890], [10, 1000]]);
    spike(78, [[-16, 1000], [-6, 910], [0, 872], [6, 910], [16, 1000]]);
    // algunos trazos nítidos encima de los planos difuminados (solo sobre la colina)
    c.globalAlpha = 0.7;
    for (let i = 0; i < 500; i++) {
      const fx = rr(0, 576), fy = rr(960, 1250);
      if (fx < 200 && fy < 1010) continue;
      const col = fy < 1100 && fx < 280 ? pick(['#b4709a', '#8c5ea8', '#5b6fc0'])
        : fx > 330 && fy < 1060 ? pick(['#8fd650', '#5cc04a', '#4a8ad0']) : pick(['#4a7ad0', '#64b84a', '#2f58b0']);
      const a = fx < 280 ? 2.0 : 0.4;
      dab(c, XG(fx), Y(fy), rr(18, 36) * s, rr(3, 6) * s, col, () => a + rr(-0.2, 0.2), 3);
    }
    c.globalAlpha = 1;

    // cima cubierta de pétalos amarillos
    for (let i = 0; i < 420; i++) {
      const fx = rr(225, 420);
      const fy = 878 + Math.abs(fx - 315) * 0.08 + rr(0, 20);
      dab(c, XG(fx), Y(fy), rr(8, 16) * s, rr(4, 7) * s, pick(PAL.petal), () => rr(-0.4, 0.4), 2);
    }
    // pétalos que caen por las laderas
    for (let i = 0; i < 260; i++) {
      const t = rand();
      const goRight = rand() < 0.6;
      const fx = goRight ? 400 + t * 120 + rr(-25, 25) : 230 - t * 200 + rr(-25, 25);
      const fy = goRight ? 892 + t * 75 + rr(-10, 15) : 885 + t * 115 + rr(-12, 12);
      leaf(c, XG(fx), Y(fy), rr(3, 6) * s, rr(1.5, 3) * s, rand() * Math.PI, pick(PAL.petal));
    }
    // pétalos sueltos por toda la colina
    for (let i = 0; i < 180; i++) {
      const fx = rr(-ox / s, FW + ox / s), fy = rr(900, 1240);
      leaf(c, X(fx), Y(fy), rr(3, 6) * s, rr(1.5, 2.8) * s, rand() * Math.PI, pick(PAL.petal));
    }
  }

  // ---------- partículas animadas del cielo ----------
  function spawnParticle(p) {
    p = p || {};
    p.x = rand() * W;
    p.y = rand() * Y(900);
    p.age = 0;
    p.life = rr(90, 240);
    p.w = rr(3.5, 7) * s;
    p.len = rr(22, 45) * s;
    p.speed = rr(0.35, 0.9) * s;
    p.color = skyColor(p.x, p.y);
    return p;
  }

  function spawnPetal(p, initial) {
    p = p || {};
    if (initial) {
      p.x = rand() * W;
      p.y = rr(Y(600), H);
    } else if (rand() < 0.75) {
      p.x = X(rr(230, 420));
      p.y = Y(rr(870, 900));
    } else {
      p.x = rr(-30, W * 0.3);
      p.y = rr(Y(700), H);
    }
    p.vx = rr(0.5, 1.8) * s;
    p.vy = rr(-0.5, 0.6) * s;
    p.rot = rand() * Math.PI * 2;
    p.vr = rr(-0.06, 0.06);
    p.size = rr(3.5, 6.5) * s;
    p.phase = rand() * Math.PI * 2;
    p.color = pick(PAL.petal);
    return p;
  }

  // ---------- el niño ----------
  function drawBoy(c, t) {
    const sway = Math.sin(t * 1.3);
    c.save();
    c.translate(X(300), Y(884));
    c.scale(s * 1.12, s * 1.12);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // botas
    c.fillStyle = '#6e2b22';
    roundRect(c, -22, -26, 16, 26, 4);
    roundRect(c, 5, -26, 16, 26, 4);
    c.fillStyle = '#9a4434';
    c.fillRect(-19, -24, 4, 14);
    c.fillRect(8, -24, 4, 14);

    // piernas
    c.fillStyle = '#7d9cc0';
    c.fillRect(-20, -66, 14, 42);
    c.fillRect(5, -66, 14, 42);
    c.fillStyle = '#5a7aa8';
    c.fillRect(-20, -66, 5, 42);
    c.fillRect(5, -66, 5, 42);

    // abrigo
    c.save();
    c.beginPath();
    c.moveTo(-26, -172);
    c.quadraticCurveTo(-40, -118, -52 - sway * 2, -58);
    c.quadraticCurveTo(-34, -50, -16, -60);
    c.quadraticCurveTo(0, -52, 15, -59);
    c.quadraticCurveTo(32, -51, 46 - sway * 2, -62);
    c.quadraticCurveTo(36, -118, 27, -172);
    c.closePath();
    // tela verde: sombra azulada a la izquierda, luz amarilla a la derecha
    const cg = c.createLinearGradient(-55, 0, 48, 0);
    cg.addColorStop(0, '#2a5f4c');
    cg.addColorStop(0.35, '#3f8a3e');
    cg.addColorStop(0.7, '#6cb340');
    cg.addColorStop(1, '#c4e25e');
    c.fillStyle = cg;
    c.fill();
    c.clip();
    // pliegues: trazos largos y suaves
    let cs = 11;
    const rnd = () => { cs = (cs * 9301 + 49297) % 233280; return cs / 233280; };
    c.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = -50 + rnd() * 96, y = -170 + rnd() * 70;
      c.strokeStyle = x > 5 ? (i % 2 ? '#d6ec78' : '#8fcc4a') : (i % 2 ? '#24584a' : '#5aa040');
      c.globalAlpha = 0.55;
      c.lineWidth = 2 + rnd() * 2.5;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x - 3 + rnd() * 6, y + 30, x + (x / 10) + rnd() * 4, y + 55 + rnd() * 40);
      c.stroke();
    }
    c.globalAlpha = 1;
    // estrellitas amarillas bordadas
    c.fillStyle = '#f2d04a';
    for (const [sx, sy, sr] of [[-22, -108, 5], [14, -84, 4], [28, -132, 3.5], [-8, -140, 3]]) {
      c.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rad = k % 2 ? sr * 0.35 : sr;
        c.lineTo(sx + Math.cos(a) * rad, sy + Math.sin(a) * rad);
      }
      c.closePath();
      c.fill();
    }
    // sombra a la izquierda y luz a la derecha
    const sh = c.createLinearGradient(-55, 0, 48, 0);
    sh.addColorStop(0, 'rgba(15,45,70,0.45)');
    sh.addColorStop(0.45, 'rgba(15,45,70,0)');
    sh.addColorStop(0.8, 'rgba(230,255,150,0)');
    sh.addColorStop(1, 'rgba(230,255,150,0.25)');
    c.fillStyle = sh;
    c.fillRect(-60, -180, 110, 130);
    c.fillStyle = 'rgba(20,60,50,0.35)';
    c.fillRect(-60, -70, 110, 20);
    c.restore();

    // tallo de la rosa (como bastón)
    c.strokeStyle = '#2f7a3a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(55, 0);
    c.quadraticCurveTo(58, -120, 58 + sway * 1.5, -226);
    c.stroke();
    c.save();
    c.translate(59 + sway, -196);
    c.rotate(-0.6 + sway * 0.1);
    c.fillStyle = '#3f9a45';
    c.beginPath();
    c.ellipse(7, 0, 9, 4, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // brazo derecho levantado
    c.strokeStyle = '#5aa63e';
    c.lineWidth = 15;
    c.beginPath();
    c.moveTo(18, -162);
    c.quadraticCurveTo(40, -150, 52, -158);
    c.stroke();
    c.strokeStyle = '#a8d85a';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(24, -164);
    c.quadraticCurveTo(38, -156, 48, -162);
    c.stroke();
    c.fillStyle = '#f4c9a0';
    c.beginPath();
    c.arc(57, -160, 6, 0, Math.PI * 2);
    c.fill();

    // rosa
    const rx = 58 + sway * 1.5, ry = -233;
    c.fillStyle = '#8f1a2b';
    c.beginPath();
    c.arc(rx, ry, 12, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c4283c';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      c.beginPath();
      c.arc(rx + Math.cos(a) * 5, ry + Math.sin(a) * 5, 7, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = '#7a1022';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(rx, ry, 4, 0, Math.PI * 1.5);
    c.stroke();
    c.beginPath();
    c.arc(rx + 1, ry, 8, Math.PI, Math.PI * 2.3);
    c.stroke();
    c.fillStyle = '#e55360';
    c.beginPath();
    c.arc(rx - 4, ry - 5, 3, 0, Math.PI * 2);
    c.fill();

    // bufanda tipo capucha que cae por la espalda
    c.fillStyle = '#e8a824';
    c.beginPath();
    c.moveTo(-24, -176);
    c.quadraticCurveTo(0, -166, 24, -176);
    c.quadraticCurveTo(14, -150, 3 + sway * 3, -128);
    c.quadraticCurveTo(-10, -150, -24, -176);
    c.closePath();
    c.fill();
    c.fillStyle = '#f7d046';
    c.beginPath();
    c.moveTo(-18, -174);
    c.quadraticCurveTo(0, -168, 16, -174);
    c.quadraticCurveTo(8, -156, 2 + sway * 3, -140);
    c.closePath();
    c.fill();
    c.fillStyle = '#f2c230';
    c.beginPath();
    c.ellipse(0, -177, 26, 9, 0, 0, Math.PI * 2);
    c.fill();
    // punta que ondea con el viento
    c.beginPath();
    c.moveTo(18, -180);
    c.quadraticCurveTo(34, -188 + sway * 4, 46 + sway * 3, -178 + sway * 5);
    c.quadraticCurveTo(32, -174, 18, -172);
    c.closePath();
    c.fill();

    // cabeza
    c.fillStyle = '#f4c9a0';
    c.beginPath();
    c.arc(3, -200, 21, 0, Math.PI * 2);
    c.fill();

    // pelo dorado alborotado
    const hairCols = ['#f7a531', '#ffc24d', '#e9852a', '#ffb53a'];
    // base esponjosa que cubre la nuca
    c.fillStyle = '#ee8f26';
    c.beginPath();
    c.ellipse(-2, -203, 25, 24, 0, 0, Math.PI * 2);
    c.fill();
    // mechones cortos en todas direcciones, peinados por el viento
    for (let i = 0; i < 22; i++) {
      const a = Math.PI * 0.55 + (i / 21) * Math.PI * 1.75;
      const tip = 26 + ((i * 7) % 5) * 1.8;
      const bend = 0.3 + Math.sin(t * 2.2 + i) * 0.08;
      c.fillStyle = hairCols[i % hairCols.length];
      c.beginPath();
      c.moveTo(-2 + Math.cos(a - 0.22) * 16, -203 + Math.sin(a - 0.22) * 16);
      c.quadraticCurveTo(
        -2 + Math.cos(a + bend * 0.4) * (tip - 4), -203 + Math.sin(a + bend * 0.4) * (tip - 4),
        -2 + Math.cos(a + bend) * tip, -203 + Math.sin(a + bend) * tip);
      c.lineTo(-2 + Math.cos(a + 0.22) * 16, -203 + Math.sin(a + 0.22) * 16);
      c.closePath();
      c.fill();
    }
    // brillos dorados y sombra en la parte baja
    c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 1.05 + i * 0.17;
      c.strokeStyle = i % 2 ? '#ffd76a' : '#ffe9a0';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(-2 + Math.cos(a) * 5, -203 + Math.sin(a) * 5);
      c.quadraticCurveTo(-2 + Math.cos(a + 0.15) * 14, -203 + Math.sin(a + 0.15) * 14,
        -2 + Math.cos(a + 0.35) * 22, -203 + Math.sin(a + 0.35) * 22);
      c.stroke();
    }
    c.strokeStyle = 'rgba(190,90,20,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(-2, -203, 18, Math.PI * 0.35, Math.PI * 0.95);
    c.stroke();
    c.fillStyle = '#f0b48a';
    c.beginPath();
    c.ellipse(21, -196, 4.5, 6.5, 0.2, 0, Math.PI * 2);
    c.fill();

    c.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    c.fill();
  }

  // ---------- bucle ----------
  function drawGlows(t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const st of [...stars, moon]) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + st.phase);
      const R = st.r * 1.8;
      const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, R);
      g.addColorStop(0, `rgba(255,220,120,${0.1 + pulse * 0.1})`);
      g.addColorStop(0.6, `rgba(255,200,80,${0.03 + pulse * 0.03})`);
      g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(st.x, st.y, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // anillos que giran despacio dentro de cada estrella
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.6;
    for (const st of stars) {
      for (let i = 0; i < st.arcs.length; i++) {
        const a = st.arcs[i];
        const ang = a.a + t * st.spin;
        ctx.strokeStyle = a.rad < 0.5 ? PAL.yellow[i % 4] : PAL.teal[i % 5];
        ctx.lineWidth = a.w * s;
        ctx.beginPath();
        ctx.arc(st.x, st.y, a.rad * st.r, ang, ang + a.len);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawShooting(dt) {
    if (!shooting && Math.random() < 0.0015) {
      shooting = { x: rr(W * 0.1, W * 0.6), y: rr(Y(30), Y(220)), life: 0 };
    }
    if (!shooting) return;
    shooting.life += dt;
    const p = shooting.life / 1.1;
    if (p >= 1) { shooting = null; return; }
    const len = 110 * s;
    const hx = shooting.x + p * 240 * s, hy = shooting.y + p * 80 * s;
    const g = ctx.createLinearGradient(hx - len, hy - len * 0.33, hx, hy);
    g.addColorStop(0, 'rgba(255,255,220,0)');
    g.addColorStop(1, `rgba(255,250,210,${1 - p})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(hx - len, hy - len * 0.33);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now / 1000;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(skyLayer, 0, 0, W, H);

    // manchas que se deslizan por los remolinos
    const limit = Y(960);
    for (const p of particles) {
      p.age++;
      if (p.age > p.life) spawnParticle(p);
      const a = flow(p.x, p.y, true);
      p.x += Math.cos(a) * p.speed;
      p.y += Math.sin(a) * p.speed;
      if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > limit) {
        spawnParticle(p);
        continue;
      }
      ctx.globalAlpha = Math.sin((p.age / p.life) * Math.PI) * 0.75;
      dab(ctx, p.x, p.y, p.len, p.w, p.color, (x, y) => flow(x, y, true), 4);
    }
    ctx.globalAlpha = 1;

    drawGlows(t);
    drawShooting(dt);

    ctx.drawImage(groundLayer, 0, 0, W, H);

    const half = petals.length >> 1;
    drawPetals(0, half, t);
    drawBoy(ctx, t);
    drawPetals(half, petals.length, t);

    requestAnimationFrame(frame);
  }

  function drawPetals(from, to, t) {
    for (let i = from; i < to; i++) {
      const p = petals[i];
      const gust = 1 + 0.6 * Math.sin(t * 0.7 + p.phase * 0.2);
      p.x += p.vx * gust;
      p.y += p.vy + Math.sin(t * 2 + p.phase) * 0.35 * s;
      p.rot += p.vr;
      if (p.x > W + 20 || p.y < -20 || p.y > H + 20) spawnPetal(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(t * 3 + p.phase)));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(-p.size, 0);
      ctx.quadraticCurveTo(0, -p.size * 0.6, p.size, 0);
      ctx.quadraticCurveTo(0, p.size * 0.6, -p.size, 0);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- inicio y redimensionado ----------
  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const cv of [canvas, skyLayer, groundLayer]) {
      cv.width = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
    }
    seed = 7;
    layout();
    paintSky();
    paintGround();
    const pc = Math.min(Math.floor((W * Y(900)) / (2600 * s * s)), 1400);
    particles = Array.from({ length: pc }, () => {
      const p = spawnParticle();
      p.age = Math.floor(rand() * p.life);
      return p;
    });
    const nPetals = Math.min(Math.floor(70 + W / (8 * s)), 240);
    petals = Array.from({ length: nPetals }, () => spawnPetal(null, true));
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 200);
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  });
  canvas.addEventListener('pointerleave', () => { pointer.active = false; });

  build();
  requestAnimationFrame((n) => {
    last = n;
    veil.classList.add('hidden');
    frame(n);
  });
})();
