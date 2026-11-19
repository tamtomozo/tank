(function (global) {
  'use strict';

  // HQ operator radio: every on-screen report (mission flow, alerts, supply notices, control-mode
  // changes) is delivered as a typed-out radio message from the operator, shown at upper centre.
  // Driven by the game loop (update(dt) only runs while the game runs), so messages never play out
  // unseen behind a modal menu; they simply resume when the menu closes.

  const CHARS_PER_SEC = global.Typewriter.CHARS_PER_SEC; // Mio's typing speed (typewriter.js)
  const BASE_HOLD = 2.6; // seconds a finished message stays up (+ a little per character)
  const HOLD_PER_CHAR = L(0.035, 0.015); // English: more characters for the same line
  const HOLD_WHEN_QUEUED = 1.3; // shorter hold when more reports are waiting
  // Panel appearing from hidden: its HUD frame draws first (css/hudframe.css, --bt 0.5); typing starts after
  const BOOT_TIME = 0.7;
  // Closing sequence length at the panel's --bt 0.5 (HudFrame.CLOSE_MS is for --bt 1)
  const CLOSE_TIME = 0.35;

  const { pick } = global.TankUtil;

  class RadioComms {
    constructor(panelEl, audio) {
      this.panel = panelEl || null;
      this.audio = audio;
      this.textEl = this.panel ? this.panel.querySelector('.radio-text') : null;
      this.srEl = this.panel ? this.panel.querySelector('.radio-sr') : null;
      this.queue = [];
      this.current = null;
      this.shown = 0;
      this.hold = 0;
      this.bootWait = 0;
      this.closeWait = 0;
    }

    // opts.priority === 'high': jump ahead of waiting reports (alerts)
    // opts.key: only the newest report with this key is kept (e.g. repeated control-mode toggles)
    // opts.onDone: called once this report has been fully shown and its hold time has passed
    // opts.lockControls: the player can't drive or fire while this report is waiting or on screen
    say(text, opts = {}) {
      if (!this.panel || !text) {
        if (opts.onDone) opts.onDone(); // no radio panel: don't block what follows the report
        return;
      }
      const msg = { text, key: opts.key || null, onDone: opts.onDone || null, lockControls: !!opts.lockControls };
      if (msg.key) {
        this.queue = this.queue.filter((m) => m.key !== msg.key);
        if (this.current && this.current.key === msg.key) this.current = null; // replace on screen
      }
      if (opts.priority === 'high') this.queue.unshift(msg);
      else this.queue.push(msg);
    }

    // Nothing being transmitted and nothing waiting
    get isIdle() {
      return !this.current && this.queue.length === 0;
    }

    // A control-locking report (area secured / back at the HQ) is on screen or still queued
    get controlsLocked() {
      return (!!this.current && this.current.lockControls) || this.queue.some((m) => m.lockControls);
    }

    clear() {
      this.queue = [];
      this.current = null;
      this.bootWait = 0;
      this.closeWait = 0;
      if (!this.panel) return;
      this.panel.classList.remove('is-visible', 'is-typing', 'is-booting', 'is-closing', 'is-locked');
      if (this.textEl) this.textEl.textContent = '';
      if (this.srEl) this.srEl.textContent = '';
    }

    update(dt) {
      if (!this.panel || !this.textEl) return;

      // Closing sequence playing: let it finish before the panel hides (or shows the next report)
      if (this.closeWait > 0) {
        this.closeWait -= dt;
        if (this.closeWait > 0) return;
        // Keep `is-closing` until the next boot-up: it holds the panel invisible with no slide-out
        this.panel.classList.remove('is-visible', 'is-locked');
      }

      if (!this.current) {
        if (this.queue.length === 0) return;
        this.current = this.queue.shift();
        this.shown = 0; // every report is always typed out one character at a time
        this.hold = BASE_HOLD + this.current.text.length * HOLD_PER_CHAR;
        this.textEl.textContent = '';
        if (this.srEl) this.srEl.textContent = this.current.text; // screen readers get the full line at once
        if (!this.panel.classList.contains('is-visible')) {
          // Popping up from hidden: replay the HUD frame boot-up, then start typing
          global.HudFrame.boot(this.panel);
          this.bootWait = BOOT_TIME;
        }
        this.panel.classList.add('is-visible', 'is-typing');
        if (this.audio && this.audio.playRadio) this.audio.playRadio();
      }
      this.panel.classList.toggle('is-locked', this.controlsLocked);

      if (this.bootWait > 0) {
        this.bootWait -= dt;
        return;
      }

      const text = this.current.text;
      if (this.shown < text.length) {
        const before = Math.floor(this.shown);
        this.shown = Math.min(text.length, this.shown + CHARS_PER_SEC * dt);
        // Only touch the text when another character has appeared (not on every frame: each
        // write makes the browser lay the panel out again)
        if (Math.floor(this.shown) !== before) this.textEl.textContent = text.slice(0, Math.floor(this.shown));
        if (this.shown < text.length) return;
      }
      if (this.textEl.textContent !== text) this.textEl.textContent = text;
      this.panel.classList.remove('is-typing');

      if (this.queue.length > 0) this.hold = Math.min(this.hold, HOLD_WHEN_QUEUED);
      this.hold -= dt;
      if (this.hold > 0) return;
      const done = this.current.onDone;
      this.current = null;
      if (done) done();
      // Keep the panel up when another report is waiting; otherwise play the closing sequence
      if (this.queue.length === 0) {
        this.panel.classList.remove('is-locked');
        global.HudFrame.shutDown(this.panel);
        this.closeWait = CLOSE_TIME;
      }
    }
  }

  // English lines that start with a name ("the collaborator") need its first letter in capitals
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Report scripts (original lines for this game's HQ operator, Mio)
  RadioComms.script = {
    // Sortie begins (selection = { planet, operation }): the operation's own lines, in order
    missionStart(selection) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.start) return op.radio.start;
      const n = op && op.sites ? op.sites.length : 0;
      return L([`こちら作戦本部、オペレーターのミオです。作戦を開始します。敵拠点は全${n}か所、すべて制圧してください。`], [`This is HQ, operator Mio. The operation is underway. There are ${n} enemy compounds; capture them all.`]);
    },

    controlMode(isDirect) {
      return isDirect
        ? L('操縦モードを「方向移動」に切り替えました。押した方向へそのまま進みます。', 'Control mode switched to Direct Move. The tank goes straight where you press.')
        : L('操縦モードを「戦車操縦」に戻しました。前後進と旋回で操作してください。', 'Control mode back to Tank Drive. Drive forward and back, and turn.');
    },

    baseAlert(baseName) {
      return pick([
        L(`警報！ 敵拠点${baseName}がこちらに気づきました。待機車両が出撃してきます、注意してください！`, `Alert! Enemy compound ${baseName} has spotted us. Their standby vehicles are coming out, be careful!`),
        L(`敵拠点${baseName}に動きあり！ 待機していた車両が出撃しました。迎撃してください！`, `Movement at enemy compound ${baseName}! Their standby vehicles have sortied. Intercept them!`)
      ]);
    },

    // Compound captured: one short line in the form "◯は△です"
    baseCaptured(baseName) {
      return L(`拠点${baseName}は制圧完了です。`, `${baseName} is captured.`);
    },

    // After the first capture of a sortie: captured compounds serve as supply depots
    supplyAvailable(baseName) {
      return L(`制圧した拠点では、白旗まわりの円に入ると補給と僚機の補充が可能です。拠点${baseName}も利用できます。`, `At a captured compound, drive into the circle around the white flag to resupply and replace wingmen. ${baseName} is available now.`);
    },

    // Objective done: separate transmissions, in order (returns an array of lines).
    // The platoon is ordered back to the operations HQ.
    areaSecured(selection, planetName) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.complete) return op.radio.complete;
      return [
        L(`${planetName}の目標は全拠点制圧です。現刻をもって作戦行動完了です。`, `Every compound on ${planetName} is captured. As of now, the operation is complete.`),
        L('作戦本部へ帰還してください、隊長。本部の位置を送ります。', 'Please return to HQ, Commander. Sending you its position.')
      ];
    },

    // ---- sweep operation (js/sweep.js) ----
    sweepCaptured(baseName, left) {
      return L(`拠点${baseName}を制圧。この波の残りは${left}か所です。`, `${baseName} captured. ${left} left in this wave.`);
    },

    // A wave has fallen: its lap time, and where to recover (returns an array of lines)
    sweepRoundClear(wave, rounds, lapText, baseName) {
      return [
        L(`第${wave}波、全拠点の制圧を確認！ ラップは${lapText}です。`, `Wave ${wave}: every compound captured! Lap time ${lapText}.`),
        L(`最後に落とした拠点${baseName}の白旗で、回復してから次の波へ進めます。回復せずに進むこともできます。残りは${rounds - wave}波です。`,
          `At the white flag of ${baseName}, the last one you took, you can recover before the next wave, or go on without it. ${rounds - wave} waves to go.`)
      ];
    },

    sweepRoundStart(wave, rounds, count) {
      return wave === rounds
        ? L(`最終波です！ 敵拠点${count}か所を確認、計測開始。これで最後です、隊長！`, `Final wave! ${count} enemy compounds sighted, the clock is running. This is the last of them, Commander!`)
        : L(`第${wave}波、新たな敵拠点${count}か所を確認。計測開始です！`, `Wave ${wave}: ${count} new enemy compounds sighted. The clock is running!`);
    },

    // The last wave has fallen (returns an array of lines)
    sweepComplete(total, timeText) {
      return [
        L(`全${total}拠点、制圧完了です！ 合計タイムは${timeText}。`, `All ${total} compounds captured! Total time ${timeText}.`),
        L('この星に残る敵は、もういません。……お疲れさまでした、隊長。', 'There are no enemies left on this world. ...Well done, Commander.')
      ];
    },

    // ---- hold the area (operation.hold) ----
    holdStart(selection, hold) {
      const op = selection && selection.operation;
      if (op && op.radio && op.radio.holdStart) return op.radio.holdStart;
      return L([`拠点を確保しました。${hold.duration}秒間、まわりの円から離れずに守り抜いてください！`], [`Compound secured. Hold it for ${hold.duration} seconds without leaving the circle!`]);
    },

    holdLeft() {
      return L('封鎖線から離れています！ 黄色い円の中に戻ってください。カウントが止まっています！', 'You\'re off the line! Get back inside the yellow circle. The count has stopped!');
    },

    holdBack() {
      return L('封鎖線に戻りました。カウントを再開します。', 'Back on the line. The count resumes.');
    },

    holdHalf(left) {
      return L(`あと${left}秒です！ 持ちこたえてください！`, `${left} seconds left! Hold on!`);
    },

    holdWave() {
      return L('敵の増援を確認！ 四方から接近してきます！', 'Enemy reinforcements sighted! They\'re closing in from all sides!');
    },

    bossArrived(kind) {
      if (kind === 'ace') {
        return L('大型の熱源が接近……雪原迷彩のエース機です！ 遠くからは見えにくい、熱源とレーダーで捉えてください！', 'A large heat source approaching... it\'s the snow-camo ace! It\'s hard to see from afar; track it by heat and radar!');
      }
      if (kind === 'proto') {
        return L('工場のシャッターが開きます……試作超重戦車です！ 正面から撃ち合わないで、僚機と囲んでください！', 'The factory shutters are opening... it\'s the prototype super-heavy tank! Don\'t trade fire head-on; surround it with your wingmen!');
      }
      return L('敵の指揮官車が出てきました！ 気をつけて、隊長！', 'The enemy command tank is out! Be careful, Commander!');
    },

    // ---- industrial planet (js/combat/city.js) ----
    ambush() {
      return pick([
        L('マンホールから歩兵です！ ロケットを持っています、気をつけて！', 'Infantry from a manhole! They have rockets, watch out!'),
        L('地下から敵歩兵が出てきました！ 轢くか、撃って倒してください！', 'Enemy infantry coming up from below! Run them over or shoot them!')
      ]);
    },

    iedSpotted() {
      return L('道路に即席爆弾を発見！ 赤く光っているものです。踏まないで、撃って処理してください。', 'IED spotted on the road! It\'s the thing glowing red. Don\'t drive over it; shoot it.');
    },

    iedBlast() {
      return L('即席爆弾です！ 被害を確認してください……道路の赤い光に注意を！', 'That was an IED! Check your damage... watch for red lights on the road!');
    },

    iedCleared() {
      return L('即席爆弾を処理しました。', 'IED cleared.');
    },

    escortMet(escort) {
      return L(`${escort.name}と合流しました！ ${escort.to.name}まで送り届けてください。歩きなので、離れすぎないように。`, `We\'ve met ${escort.name}! Take them to the ${escort.to.name}. They\'re on foot, so don\'t get too far ahead.`);
    },

    escortDone(escort) {
      return L(`${escort.name}が${escort.to.name}に入りました。地下トンネルの地図を受け取りました！ マンホールの位置がレーダーに映ります。`, `${cap(escort.name)} has reached the ${escort.to.name}. We\'ve received the tunnel map! Manholes now show on the radar.`);
    },

    escortLost(escort) {
      return L(`${escort.name}が……やられました。トンネルの地図は手に入りません。住民に知られたら……いえ、先へ進みましょう。`, `${cap(escort.name)}... is down. We won\'t get the tunnel map. If the people hear of this... no. Let\'s keep going.`);
    },

    powerDown(count) {
      return count > 0
        ? L(`発電所を制圧、電源が落ちました！ 高架の砲台${count}基、沈黙です。`, `Power plant captured, the power is down! ${count} overpass turrets have gone silent.`)
        : L('発電所を制圧、電源が落ちました！', 'Power plant captured, the power is down!');
    },

    siteAppears(name) {
      return L(`政府は降伏しました……ですが、一部の部隊が降伏を拒否しています！ ${name}を確認、レーダーに送ります！`, `The government has surrendered... but some units refuse to! ${name} located, sending it to your radar!`);
    },

    civilLost(count, support) {
      if (count === 1) return L(`民間の建物が崩れました……住民の協力度が下がっています（${support}%）。撃つ方向に気をつけてください。`, `A civilian building has collapsed... civilian support is dropping (${support}%). Watch where you fire.`);
      return L(`また民間の建物が……住民の協力度、${support}%です。`, `Another civilian building... civilian support is at ${support}%.`);
    },

    fuelBlast() {
      return L('燃料タンクが爆発！ 周りの建物と車両を巻き込んでいます！', 'A fuel tank exploded! It\'s taking the buildings and vehicles around it with it!');
    },

    // ---- survey / feint ----
    surveyed(name, left, kind) {
      if (kind === 'patrol') {
        if (left > 0) return L(`${name}、異常なし。残る巡回点は${left}か所です。`, `${name}, all clear. ${left} patrol points to go.`);
        return L(`${name}も異常なし。巡回、完了です。`, `${name}, all clear too. Patrol complete.`);
      }
      if (left > 0) return L(`${name}の氷厚を計測しました。戦車の重さに耐えられます。残る観測点は${left}か所です。`, `Ice measured at ${name}. It will bear a tank\'s weight. ${left} survey points to go.`);
      return L(`${name}の計測完了。湖を渡れるルートが確定しました！ 止まらなければ、戦車でも渡れます。`, `${name} measured. We have a route across the lake! Tanks can cross, as long as they don\'t stop.`);
    },

    feintSpotted(baseName, distance) {
      return L(`${baseName}が食いつきました！ 敵の主力が出てきます。撃ち合わずに${distance}以上引き離してください！`, `${baseName} has taken the bait! Their main force is coming out. Don\'t fight; pull them at least ${distance} away!`);
    },

    feintDone(baseName) {
      return L(`陽動成功です。敵は${baseName}の守りに戻っていきます。主力は峠に釘付けです。`, `The feint worked. The enemy is heading back to guard ${baseName}. Their main force is pinned at the pass.`);
    },

    // ---- ice / ammunition ----
    iceCrack() {
      return L('氷にひびが入っています！ 止まらないで、動いてください！', 'The ice is cracking! Don\'t stop, keep moving!');
    },

    iceBreak(isAlly) {
      return isAlly
        ? L('僚機が氷を踏み抜きました……！ 湖の上では止まらないでください！', 'A wingman broke through the ice...! Don\'t stop on the lake!')
        : L('敵車両が氷を踏み抜きました！ 重い戦車ほど、薄い氷に弱いようです。', 'An enemy vehicle broke through the ice! The heavier the tank, the worse it does on thin ice.');
    },

    outOfAmmo() {
      return L('砲弾が尽きました！ 敵を撃破すれば、残骸から砲弾を回収できます。僚機の援護を頼ってください！', 'Out of shells! Destroy enemies to recover shells from the wrecks. Lean on your wingmen!');
    },

    // ---- environment (js/game/hazards.js) ----
    blizzardRising(thermal) {
      return thermal
        ? L('吹雪が強まっています。視界がほぼありません。熱源センサーを頼りにしてください。', 'The blizzard is getting worse. Visibility is almost zero. Rely on the heat sensor.')
        : L('吹雪が強まっています。視界がほぼありません。', 'The blizzard is getting worse. Visibility is almost zero.');
    },

    smogRising() {
      return L('スモッグが濃くなっています。視界が落ちます。敵からも見えにくいはずです。', 'The smog is thickening. Visibility is dropping, but the enemy should have trouble seeing us too.');
    },

    smogEasing() {
      return L('スモッグが少し晴れました。視界が戻ります。', 'The smog has cleared a little. Visibility is coming back.');
    },

    blizzardEasing() {
      return L('吹雪が少し弱まりました。視界が戻ります。', 'The blizzard has eased a little. Visibility is coming back.');
    },

    coldWarning() {
      return L('車体が冷え切っています。砲塔の旋回とエンジンが鈍っています。少し走って暖めてください。', 'The tank is chilled through. The turret and engine are sluggish. Drive a little to warm up.');
    },

    stormIncoming() {
      return pick([
        L('砂嵐が来ます！ 視界がほぼなくなります。敵からもこちらは見えません、接近するなら今です。', 'A sandstorm is coming! Visibility will be nearly gone, and the enemy can\'t see us either. If you\'re closing in, now\'s the time.'),
        L('砂嵐、接近中です！ 嵐の中なら気づかれずに拠点へ近づけます。', 'Sandstorm approaching! Inside the storm you can reach the compounds unseen.')
      ]);
    },

    stormPassing() {
      return L('砂嵐が抜けていきます。視界が戻ります。敵にも見つかりやすくなりますよ。', 'The sandstorm is passing. Visibility is returning, so the enemy can spot you more easily too.');
    },

    heatWarning() {
      return L('エンジン温度が上がっています。少し速度を落としてください。', 'Engine temperature is rising. Please ease off a little.');
    },

    overheat() {
      return L('オーバーヒートです！ エンジンが冷えるまで速度が落ちます！', 'Overheat! You\'ll be slower until the engine cools!');
    },

    heatRecovered() {
      return L('エンジン温度、正常に戻りました。', 'Engine temperature back to normal.');
    },

    // The player has driven back onto the HQ pad after securing the planet
    hqReturned() {
      return L('作戦本部への帰還を確認しました。お疲れさまでした、隊長。', 'Return to HQ confirmed. Good work, Commander.');
    },

    supplyBlocked(baseName) {
      return L(`交戦中です。補給は敵を退けてからにしてください。拠点${baseName}で待っています。`, `You\'re in combat. Resupply once the enemy is driven off. ${baseName} will be waiting.`);
    }
  };

  global.RadioComms = RadioComms;
})(window);
