(function (global) {
  'use strict';

  // After-action report shown once the whole planet has been secured and the platoon is back at the
  // operations HQ (and Mio's final report ended). Mission time runs until the moment the planet was
  // secured; the drive back isn't counted.
  // Overall score (the medal it earns is presented afterwards on the planet select,
  // js/medalAward.js), mission time, per-compound capture times, kills, accuracy, damage, platoon losses,
  // scrap and items, plus a closing comment from Mio typed out one character at a time.

  const { ENEMY_INFO, ENEMY_KIND_ORDER } = global.GameData; // js/data/enemies.js
  const { el } = global.TankUtil;
  const OPEN_DELAY_MS = 700; // pause after Mio's final report before the window starts drawing
  const BOOT_INTRO_MS = 1900; // frame + contents reveal (css/hudframe.css) before Mio comments

  // Mio's closing comment per rank (planet: name of the planet the sortie was fought on)
  const MIO_COMMENTS = {
    S: () => '見事な指揮でした、隊長。損害を最小限に抑えた、完璧な作戦です。',
    A: () => '作戦成功です。小隊の連携も上々でした。お疲れさまでした、隊長。',
    B: (planet) => `${planet}での作戦目標の達成を確認しました。課題は残りますが、任務は完遂です。`,
    C: () => 'なんとか制圧できましたね……次は損害をもっと抑えましょう、隊長。'
  };

  // Tactical play time (real seconds) expressed as in-game time: one in-game day lasts
  // world.dayDuration real seconds. e.g. "11時間12分", "1日3時間20分"
  function formatGameDuration(realSec, dayDuration) {
    const totalMin = Math.max(0, Math.round((realSec * 24 * 60) / Math.max(1, dayDuration)));
    const days = Math.floor(totalMin / (24 * 60));
    const hours = Math.floor((totalMin % (24 * 60)) / 60);
    const mins = totalMin % 60;
    return `${days > 0 ? `${days}日` : ''}${hours}時間${String(mins).padStart(2, '0')}分`;
  }

  const stampText = (stamp) => (stamp ? `DAY ${stamp.day} ${stamp.clock}` : '—');

  // Score out of ~100 from time, losses, damage taken and accuracy
  function computeRank(stats, playerMaxHp) {
    const minutes = stats.elapsed / 60;
    const accuracy = stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : 0;
    let score = 100;
    score -= Math.min(30, Math.max(0, minutes - 8) * 3); // slower than 8 minutes costs points
    score -= stats.alliesLost * 8;
    score -= Math.min(25, (stats.damageTaken / Math.max(1, playerMaxHp)) * 10);
    score += Math.max(-10, Math.min(15, (accuracy - 0.3) * 30));
    score = Math.round(Math.max(0, Math.min(100, score)));
    const rank = score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : 'C';
    return { rank, score, accuracy };
  }

  class ResultsReport {
    constructor(dialog) {
      this.dialog = dialog;
      this.body = dialog.querySelector('#results-body');
      this.scoreEl = dialog.querySelector('#results-score');
      // Mio's closing comment: a call floating at the screen centre until clicked (js/mioCall.js);
      // the audio comes with each open()
      this.mio = new global.MioCall(dialog, null);
      this.onRestart = null;
      this._openTimer = null;

      // The report is the end of the sortie: Esc must not dismiss it into a frozen game.
      // The restart button plays the frame's closing sequence before the window closes.
      global.HudFrame.animateCloses(dialog, { allowEsc: false });
      dialog.addEventListener('close', () => {
        this._stopTyping();
        const val = dialog.returnValue;
        dialog.returnValue = '';
        const cb = this.onRestart;
        this.onRestart = null;
        if (val === 'restart' && cb) cb();
      });
    }

    // True while shown OR waiting to appear (the game stays paused either way)
    get isOpen() {
      return this.dialog.open || this._openTimer != null;
    }

    // data: { stats, combat, squad, player, world, audio, planetName }
    open(data, onRestart) {
      this.onRestart = onRestart;
      const { stats, combat, squad, player, world } = data;
      const r = computeRank(stats, player.maxHp);

      this.scoreEl.textContent = String(r.score);

      let cardIndex = 0;
      const card = (title, value, lines = []) => {
        const c = el('article', 'result-card');
        c.style.setProperty('--i', String(cardIndex++));
        c.append(el('h3', '', title), el('p', 'result-value', value));
        for (const line of lines) c.append(el('p', 'result-sub', line));
        return c;
      };

      const t = world.getTimeInfo();
      const kinds = ENEMY_KIND_ORDER.filter((k) => stats.killsByKind[k] > 0);
      const totalKills = kinds.reduce((sum, k) => sum + stats.killsByKind[k], 0);
      const capturedBases = combat.bases.filter((b) => b.cleared).length;
      // In-game clock time at which each compound was captured
      const baseLines = combat.bases.map((b) => `拠点${b.name}　${b.cleared ? stampText(stats.baseClock[b.id]) : '未制圧'}`);
      const endStamp = stats.endClock || { day: t.day, clock: t.clockText }; // moment the planet was secured
      const accuracyPct = Math.round(r.accuracy * 100);
      const aliveAllies = combat.allies.filter((a) => a.alive).length;
      const op = combat.operation;

      this.body.replaceChildren(
        card('作戦時間（ゲーム内）', formatGameDuration(stats.elapsed, world.dayDuration), [
          `開始 ${stampText(stats.startClock)} → 制圧完了 ${stampText(endStamp)}`,
          op && op.endInPlace ? '現地で作戦終了（帰還なし）' : `作戦本部へ帰還 ${stampText(stats.returnClock)}（作戦時間に含まず）`
        ]),
        combat.bases.length > 0
          ? card('拠点制圧時刻（ゲーム内）', `${capturedBases} / ${combat.bases.length} 拠点`, baseLines)
          : card('作戦目標', '達成', [op && op.goal ? op.goal : '']),
        card('回収アイテム', `${stats.itemsCollected} 個`),
        card('撃破数', `${totalKills} 両`, [
          kinds.length ? kinds.map((k) => `${ENEMY_INFO[k].name} ${stats.killsByKind[k]}`).join(' ／ ') : '—',
          `自機 ${stats.killsBy.player} ／ 僚機 ${stats.killsBy.ally}${stats.killsBy.other ? ` ／ その他 ${stats.killsBy.other}` : ''}`
        ]),
        card('命中率', `${accuracyPct}%`, [`命中 ${stats.shotsHit} ／ 発射 ${stats.shotsFired}`]),
        card('自機の被ダメージ', `${Math.round(stats.damageTaken)}`, [`残り装甲　${Math.ceil(player.hp)} / ${player.maxHp}`]),
        card('小隊', `${1 + aliveAllies} / ${squad.maxSize} 両`, [
          `僚機の損失　${stats.alliesLost} 両`,
          `補充　${squad.reinforcements || 0} 両`
        ]),
        card('スクラップ', `⚙ ${stats.scrapEarned}`, [`獲得合計 ／ 残高 ⚙ ${combat.scrap}`]),
        ...(data.carry ? [this._carryCard(card, data.carry)] : [])
      );

      if (this.dialog.open) {
        this._say(MIO_COMMENTS[r.rank](data.planetName), data.audio);
        return;
      }
      // Hold a moment, then draw the HUD frame first and reveal the contents (see css/hudframe.css)
      if (this._openTimer != null) clearTimeout(this._openTimer);
      this._openTimer = setTimeout(() => {
        this._openTimer = null;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
        this._say(MIO_COMMENTS[r.rank](data.planetName), data.audio, BOOT_INTRO_MS);
      }, OPEN_DELAY_MS);
    }

    // What the platoon takes into the next operation (js/campaign.js recordSuccess)
    _carryCard(card, c) {
      const up = c.level > c.levelBefore;
      const c2 = card('小隊の記録（次の作戦へ）', `練度 Lv${c.level}${up ? ' ▲' : ''}`, [
        `経験値 +${c.xpGain}（${c.xp}${c.nextLevelXp ? ` / 次のLv ${c.nextLevelXp}` : '・最大'}）`
          + (up ? ` 車両調整ポイント +${c.level - c.levelBefore}` : ''),
        `自機の損耗 ${Math.round(c.wearBefore * 100)}% → ${Math.round(c.wear * 100)}%`,
        `僚機 ${c.allies} 両 ／ スクラップ ⚙ ${c.scrap} を持ち越し`,
        // Industrial planet: the people and the collaborator
        ...(c.civilLost > 0 || c.support < 100
          ? [`住民の協力度 ${c.supportBefore}% → ${c.support}%（民間の建物 ${c.civilLost} 棟を損壊）`]
          : []),
        ...(c.collaborator === true ? ['協力者を護衛 — 地下トンネルの地図を入手'] : []),
        ...(c.collaborator === false ? ['協力者を失った — トンネルの地図なし'] : []),
        ...(c.campaignDone ? ['★ 惑星カストラ解放 — 全作戦完了'] : [])
      ]);
      c2.classList.add('is-carry');
      return c2;
    }

    _say(text, audio, delayMs = 0) {
      this.mio.say(text, delayMs, audio);
    }

    _stopTyping() {
      this.mio.stop();
    }
  }

  ResultsReport.computeRank = computeRank;
  global.ResultsReport = ResultsReport;
})(window);
