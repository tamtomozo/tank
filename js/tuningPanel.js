(function (global) {
  'use strict';

  // 車両調整 step of the briefing: one radar chart per unit (自機 / 僚機) to spread the tuning
  // points over the four axes (js/data/tuning.js). A level is set by clicking / dragging along an
  // axis of the chart or with the − / ＋ buttons; raising an axis needs points left, so the player
  // lowers another one first. Every change is reported through onChange (tanks are re-fitted).

  const { TUNING_AXES, TUNING_RULES, TUNING_UNITS } = global.GameData;
  const { el } = global.TankUtil;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R = 92; // chart radius at the max level (viewBox units)
  const LABEL_R = R + 10;

  function svg(tag, attrs = {}, cls = '') {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (cls) e.setAttribute('class', cls);
    return e;
  }

  // Axis i points clockwise from the top
  function axisDir(i) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / TUNING_AXES.length;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  function levelRadius(lv) {
    return (lv / TUNING_RULES.max) * R;
  }

  function polygonPath(levels) {
    return TUNING_AXES.map((ax, i) => {
      const d = axisDir(i);
      const r = levelRadius(levels[ax.id]);
      return `${i ? 'L' : 'M'}${(d.x * r).toFixed(1)} ${(d.y * r).toFixed(1)}`;
    }).join(' ') + ' Z';
  }

  class TuningPanel {
    // container: element the two cards are built into; onChange(unit) after every change
    constructor(container, tuning, { audio = null, onChange = null } = {}) {
      this.container = container;
      this.tuning = tuning;
      this.audio = audio;
      this.onChange = onChange;
      this.units = {};
      container.replaceChildren(...TUNING_UNITS.map((u) => this._buildCard(u)));
      this.render();
    }

    _buildCard(unit) {
      const card = el('article', `tuning-card is-${unit.id}`);
      const head = el('header', 'tuning-card-head');
      const title = el('div', 'tuning-card-title');
      const note = el('span', 'tuning-card-note', unit.note); // player: the main gun at this tuning
      title.append(el('h4', '', unit.name), note);
      const points = el('span', 'tuning-points');
      head.append(title, points);

      // ---- radar chart
      const chart = svg('svg', { viewBox: '-140 -122 280 244' }, 'tuning-radar');
      chart.setAttribute('role', 'img');
      for (let lv = 1; lv <= TUNING_RULES.max; lv++) {
        const r = levelRadius(lv);
        const pts = TUNING_AXES.map((_, i) => {
          const d = axisDir(i);
          return `${(d.x * r).toFixed(1)},${(d.y * r).toFixed(1)}`;
        }).join(' ');
        chart.append(svg('polygon', { points: pts }, lv === TUNING_RULES.max ? 'tr-ring is-outer' : 'tr-ring'));
      }
      // Standard spread (Lv3 on every axis) as a dashed reference
      chart.append(svg('path', { d: polygonPath(TUNING_RULES.standard) }, 'tr-standard'));
      TUNING_AXES.forEach((ax, i) => {
        const d = axisDir(i);
        chart.append(svg('line', { x1: 0, y1: 0, x2: (d.x * R).toFixed(1), y2: (d.y * R).toFixed(1) }, 'tr-axis'));
        // Top label sits above its tip, bottom label below, side labels centred on the axis
        const lx = d.x * LABEL_R;
        const ly = d.y < -0.5 ? -LABEL_R - 2 : d.y > 0.5 ? LABEL_R + 15 : 6;
        const label = svg('text', { x: lx.toFixed(1), y: ly.toFixed(1) }, 'tr-label');
        label.setAttribute('text-anchor', Math.abs(d.x) < 0.3 ? 'middle' : d.x > 0 ? 'start' : 'end');
        label.textContent = ax.short;
        chart.append(label);
      });
      const shape = svg('path', { d: polygonPath(this.tuning.levels[unit.id]) }, 'tr-shape');
      chart.append(shape);
      const handles = TUNING_AXES.map(() => {
        const h = svg('circle', { r: 5.5, cx: 0, cy: 0 }, 'tr-handle');
        chart.append(h);
        return h;
      });
      this._bindPointer(chart, unit.id);

      // ---- per-axis steppers
      const list = el('ul', 'tuning-axes');
      const rows = TUNING_AXES.map((ax) => {
        const li = el('li', 'tuning-axis');
        li.title = ax.desc;
        const name = el('strong', 'tuning-axis-name', ax.name);
        const ctrl = el('div', 'tuning-axis-ctrl');
        const minus = el('button', 'tuning-step', '−');
        minus.type = 'button';
        minus.setAttribute('aria-label', `${unit.name} ${ax.name} を下げる`);
        const value = el('span', 'tuning-axis-lv');
        const plus = el('button', 'tuning-step', '＋');
        plus.type = 'button';
        plus.setAttribute('aria-label', `${unit.name} ${ax.name} を上げる`);
        minus.addEventListener('click', () => this._set(unit.id, ax.id, this.tuning.levels[unit.id][ax.id] - 1));
        plus.addEventListener('click', () => this._set(unit.id, ax.id, this.tuning.levels[unit.id][ax.id] + 1));
        ctrl.append(minus, value, plus);
        li.append(name, ctrl);
        list.append(li);
        return { ax, minus, plus, value };
      });

      // ---- resulting stats + reset (in the chart's corner)
      const stats = el('dl', 'tuning-stats');
      const reset = el('button', 'btn-hud tuning-reset', '標準に戻す');
      reset.type = 'button';
      reset.title = `${unit.name}を標準配分（全項目Lv${TUNING_RULES.standard.cannon}）に戻す`;
      reset.addEventListener('click', () => {
        if (this.tuning.reset(unit.id)) this._changed(unit.id);
      });

      const body = el('div', 'tuning-card-body');
      body.append(chart, reset);
      card.append(head, body, stats, list);
      this.units[unit.id] = { unit, note, points, chart, shape, handles, rows, stats, reset };
      return card;
    }

    // Click / drag on the chart: the nearest axis to the pointer is set to the level under it
    _bindPointer(chart, unitId) {
      let dragAxis = -1;
      const toLocal = (e) => {
        const m = chart.getScreenCTM();
        if (!m) return null;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
      };
      const apply = (e) => {
        const p = toLocal(e);
        if (!p) return;
        let axis = dragAxis;
        if (axis < 0) {
          let best = -Infinity;
          TUNING_AXES.forEach((_, i) => {
            const d = axisDir(i);
            const dot = (p.x * d.x + p.y * d.y) / Math.max(1, Math.hypot(p.x, p.y));
            if (dot > best) {
              best = dot;
              axis = i;
            }
          });
        }
        const d = axisDir(axis);
        const along = p.x * d.x + p.y * d.y; // projection onto the axis
        const lv = Math.round((along / R) * TUNING_RULES.max);
        dragAxis = axis;
        this._set(unitId, TUNING_AXES[axis].id, lv);
      };
      chart.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragAxis = -1;
        chart.setPointerCapture(e.pointerId);
        apply(e);
      });
      chart.addEventListener('pointermove', (e) => {
        if (dragAxis >= 0 && chart.hasPointerCapture(e.pointerId)) apply(e);
      });
      const end = () => { dragAxis = -1; };
      chart.addEventListener('pointerup', end);
      chart.addEventListener('pointercancel', end);
    }

    _set(unitId, axisId, level) {
      if (this.tuning.set(unitId, axisId, level)) this._changed(unitId);
    }

    _changed(unitId) {
      if (this.audio && this.audio.playTune) this.audio.playTune();
      this.render();
      if (this.onChange) this.onChange(unitId);
    }

    // Refresh both cards from the tuning state
    render() {
      for (const u of Object.values(this.units)) this._renderUnit(u);
    }

    _renderUnit(u) {
      const id = u.unit.id;
      const tuning = this.tuning;
      const levels = tuning.levels[id];
      const left = tuning.remaining(id);
      u.points.textContent = `配分 ${tuning.used(id)} / ${tuning.budget}　残り ${left}`;
      u.points.classList.toggle('has-left', left > 0);

      u.shape.setAttribute('d', polygonPath(levels));
      TUNING_AXES.forEach((ax, i) => {
        const d = axisDir(i);
        const r = levelRadius(levels[ax.id]);
        u.handles[i].setAttribute('cx', (d.x * r).toFixed(1));
        u.handles[i].setAttribute('cy', (d.y * r).toFixed(1));
      });
      u.chart.setAttribute('aria-label',
        `${u.unit.name}の車両調整 ` + TUNING_AXES.map((ax) => `${ax.short} Lv${levels[ax.id]}`).join('、'));

      for (const row of u.rows) {
        const lv = levels[row.ax.id];
        row.value.textContent = `Lv${lv}`;
        row.minus.disabled = lv <= TUNING_RULES.min;
        row.plus.disabled = lv >= TUNING_RULES.max || left <= 0;
      }
      u.reset.disabled = tuning.isStandard(id);

      const st = tuning.stats(id);
      // [label, full name (tooltip), value]
      const items = [
        ['火力', '主砲ダメージ', String(st.damage)],
        ['装填', '装填時間', `${st.reloadTime.toFixed(2)}s`],
        ['速度', '最高速度', String(Math.round(st.maxSpeed))],
        ['耐久', '最大装甲（HP）', String(st.maxHp)],
        ['軽減', '被弾軽減率', `${Math.round(st.armorReduction * 100)}%`]
      ];
      if (id === 'player') u.note.textContent = `主砲 ${tuning.cannonName()}`;
      u.stats.replaceChildren(...items.map(([label, full, value]) => {
        const item = el('div', 'tuning-stat');
        item.title = full;
        item.append(el('dt', '', label), el('dd', '', value));
        return item;
      }));
    }
  }

  global.TuningPanel = TuningPanel;
})(window);
