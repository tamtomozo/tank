(function (global) {
  'use strict';

  // After-action report shown once the whole area has been secured (and Mio's final report ended).
  // Overall rank, mission time, per-district times, kills, accuracy, damage, platoon losses,
  // scrap and items, plus a closing comment from Mio typed out one character at a time.

  const KIND_NAMES = { light: '軽戦車', medium: '中戦車', bunker: 'トーチカ' };
  const CHARS_PER_SEC = 34;
  const OPEN_DELAY_MS = 700; // pause after Mio's final report before the window starts drawing
  const BOOT_INTRO_MS = 1900; // frame + contents reveal (styles.css HUD frame) before Mio comments

  const MIO_COMMENTS = {
    S: '見事な指揮でした、隊長。損害を最小限に抑えた、完璧な作戦です。',
    A: '作戦成功です。小隊の連携も上々でした。お疲れさまでした、隊長。',
    B: 'エリア1の制圧を確認しました。課題は残りますが、任務は完遂です。',
    C: 'なんとか制圧できましたね……次は損害をもっと抑えましょう、隊長。'
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
      this.rankEl = dialog.querySelector('#results-rank');
      this.scoreEl = dialog.querySelector('#results-score');
      this.mioText = dialog.querySelector('#results-mio-text');
      this.mioSr = dialog.querySelector('#results-mio-sr');
      this.onRestart = null;
      this._typer = null;
      this._sayTimer = null;
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

    // data: { stats, combat, squad, player, world, audio }
    open(data, onRestart) {
      this.onRestart = onRestart;
      const { stats, combat, squad, player, world } = data;
      const r = computeRank(stats, player.maxHp);

      this.rankEl.textContent = r.rank;
      this.rankEl.dataset.rank = r.rank;
      this.scoreEl.textContent = `SCORE ${r.score}`;

      const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
      };
      let cardIndex = 0;
      const card = (title, value, lines = []) => {
        const c = el('article', 'result-card');
        c.style.setProperty('--i', String(cardIndex++));
        c.append(el('h3', '', title), el('p', 'result-value', value));
        for (const line of lines) c.append(el('p', 'result-sub', line));
        return c;
      };

      const t = world.getTimeInfo();
      const totalKills = stats.killsByKind.light + stats.killsByKind.medium + stats.killsByKind.bunker;
      const capturedBases = combat.bases.filter((b) => b.cleared).length;
      // In-game clock time at which each district was secured
      const districtLines = combat.districts.map((d) => `${d.name}　${stampText(stats.districtClock[d.id])}`);
      const endStamp = { day: t.day, clock: t.clockText };
      const accuracyPct = Math.round(r.accuracy * 100);
      const aliveAllies = combat.allies.filter((a) => a.alive).length;

      this.body.replaceChildren(
        card('作戦時間（ゲーム内）', formatGameDuration(stats.elapsed, world.dayDuration), [
          `開始 ${stampText(stats.startClock)} → 終了 ${stampText(endStamp)}`
        ]),
        card('地区確保時刻（ゲーム内）', `${combat.districtsSecured} / ${combat.districts.length} 地区`, districtLines),
        card('制圧した拠点', `${capturedBases} / ${combat.bases.length}`, [`回収アイテム　${stats.itemsCollected} 個`]),
        card('撃破数', `${totalKills} 両`, [
          `${KIND_NAMES.light} ${stats.killsByKind.light} ／ ${KIND_NAMES.medium} ${stats.killsByKind.medium} ／ ${KIND_NAMES.bunker} ${stats.killsByKind.bunker}`,
          `自機 ${stats.killsBy.player} ／ 僚機 ${stats.killsBy.ally}${stats.killsBy.other ? ` ／ その他 ${stats.killsBy.other}` : ''}`
        ]),
        card('命中率', `${accuracyPct}%`, [`命中 ${stats.shotsHit} ／ 発射 ${stats.shotsFired}`]),
        card('自機の被ダメージ', `${Math.round(stats.damageTaken)}`, [`残り装甲　${Math.ceil(player.hp)} / ${player.maxHp}`]),
        card('小隊', `${1 + aliveAllies} / ${squad.maxSize} 両`, [
          `僚機の損失　${stats.alliesLost} 両`,
          `補充　${squad.reinforcements || 0} 両`
        ]),
        card('スクラップ', `⚙ ${stats.scrapEarned}`, [`獲得合計 ／ 残高 ⚙ ${combat.scrap}`])
      );

      this.mioText.textContent = '';
      if (this.dialog.open) {
        this._say(MIO_COMMENTS[r.rank], data.audio);
        return;
      }
      // Hold a moment, then draw the HUD frame first and reveal the contents (see styles.css)
      if (this._openTimer != null) clearTimeout(this._openTimer);
      this._openTimer = setTimeout(() => {
        this._openTimer = null;
        global.HudFrame.boot(this.dialog);
        this.dialog.showModal();
        this._say(MIO_COMMENTS[r.rank], data.audio, BOOT_INTRO_MS);
      }, OPEN_DELAY_MS);
    }

    _say(text, audio, delayMs = 0) {
      this._stopTyping();
      if (this.mioSr) this.mioSr.textContent = text;
      this.mioText.textContent = '';
      if (delayMs > 0) {
        this._sayTimer = setTimeout(() => {
          this._sayTimer = null;
          this._startTyping(text, audio);
        }, delayMs);
        return;
      }
      this._startTyping(text, audio);
    }

    _startTyping(text, audio) {
      if (audio && audio.playRadio) audio.playRadio();
      this.mioText.classList.add('is-typing');
      const started = performance.now();
      // Always typed out one character at a time
      this._typer = setInterval(() => {
        const shown = Math.min(text.length, Math.floor(((performance.now() - started) / 1000) * CHARS_PER_SEC));
        this.mioText.textContent = text.slice(0, shown);
        if (shown >= text.length) this._stopTyping();
      }, 30);
    }

    _stopTyping() {
      if (this._sayTimer) {
        clearTimeout(this._sayTimer);
        this._sayTimer = null;
      }
      if (this._typer) {
        clearInterval(this._typer);
        this._typer = null;
      }
      if (this.mioText) this.mioText.classList.remove('is-typing');
    }
  }

  ResultsReport.computeRank = computeRank;
  global.ResultsReport = ResultsReport;
})(window);
