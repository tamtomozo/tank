(function (global) {
  'use strict';

  // Night visibility: darkness strength, the player's headlight cone (also used for target lock-on)
  // and the darkness overlay with the lit cone cut out.
  // Part of HorizonWorld (js/planet/planet.js): the methods below are mixed into its prototype.

  const { lerp } = global.TankUtil;
  const { CYL_R, HORIZON_DY, HORIZON_THETA, WORLD_H, WORLD_W, wrapDelta } = global.HorizonWorld.shared;

  class WorldNight {
    // At night, darken the distant terrain while keeping the player's surroundings and headlight beam clearly visible
    getNightDarkStrength() {
      const pal = this.getPalette();
      return Math.max(0, Math.min(1, (pal.nightFactor - 0.28) / 0.72));
    }

    // Shared forward headlight beam geometry used for ground beam rendering, night cutout, and auto lock-on
    getHeadlightMetrics(range = 460) {
      const pal = this.getPalette();
      const nightFactor = pal.nightFactor;
      const beamLen = range;
      const startX = 18;
      const startHalfW = 14;
      const coneHalfAngle = 0.36;
      const endHalfW = startHalfW + (beamLen - startX) * Math.tan(coneHalfAngle);
      return { nightFactor, beamLen, startX, startHalfW, endHalfW, coneHalfAngle };
    }

    _projectGroundSafe(wx, wy, camX, camY, viewW, viewH) {
      const dx = wrapDelta(wx - camX, WORLD_W);
      let dy = wrapDelta(wy - camY, WORLD_H);
      if (-dy / CYL_R > HORIZON_THETA) {
        dy = HORIZON_DY;
      }
      return this.projectDelta(dx, dy, 0, viewW, viewH, true);
    }

    // Build curved ground-projected screen polygon for the forward headlight cone
    getHeadlightConePolygon(playerX, playerY, hullAngle, range, camX, camY, viewW, viewH, widthScale = 1) {
      const hl = this.getHeadlightMetrics(range);
      const cos = Math.cos(hullAngle);
      const sin = Math.sin(hullAngle);
      const perpX = -sin;
      const perpY = cos;

      const originPt = this._projectGroundSafe(
        playerX + cos * hl.startX,
        playerY + sin * hl.startX,
        camX, camY, viewW, viewH
      );
      const tipPt = this._projectGroundSafe(
        playerX + cos * hl.beamLen,
        playerY + sin * hl.beamLen,
        camX, camY, viewW, viewH
      );
      if (!originPt || !tipPt) return null;

      const leftPts = [];
      const rightPts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const d = lerp(hl.startX, hl.beamLen, u);
        const hw = lerp(hl.startHalfW, hl.endHalfW, u) * widthScale;
        const cx = playerX + cos * d;
        const cy = playerY + sin * d;
        const lp = this._projectGroundSafe(cx - perpX * hw, cy - perpY * hw, camX, camY, viewW, viewH);
        const rp = this._projectGroundSafe(cx + perpX * hw, cy + perpY * hw, camX, camY, viewW, viewH);
        if (lp && rp) {
          leftPts.push(lp);
          rightPts.push(rp);
        }
      }
      if (leftPts.length < 2) return null;
      return { originPt, tipPt, leftPts, rightPts, metrics: hl };
    }

    // Check whether a target sits inside the forward headlight cone up to firing range and clearly visible bounds
    isPointInHeadlightRange(tx, ty, targetRadius, playerX, playerY, hullAngle, range, camX, camY, viewW, viewH) {
      // 1. Cheap world-space cone test first (rejects almost every candidate without projecting)
      const dx = this.deltaX(playerX, tx);
      const dy = this.deltaY(playerY, ty);
      const cos = Math.cos(hullAngle);
      const sin = Math.sin(hullAngle);
      const localForward = dx * cos + dy * sin;

      const hl = this.getHeadlightMetrics(range);
      const pad = Math.min(20, (targetRadius || 0) * 0.45);
      if (localForward < hl.startX - pad || localForward > hl.beamLen + pad) return false;

      const localLateral = Math.abs(-dx * sin + dy * cos);
      const t = Math.max(0, Math.min(1, (localForward - hl.startX) / Math.max(1, hl.beamLen - hl.startX)));
      const maxHalfW = hl.startHalfW + (hl.endHalfW - hl.startHalfW) * t + pad;
      if (localLateral > maxHalfW) return false;

      // 2. Then require the target to be clearly visible on screen
      const targetProj = this.project(tx, ty, 0, camX, camY, viewW, viewH);
      if (!targetProj) return false;

      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.21;
      const sideMargin = Math.max(40, Math.min(80, viewW * 0.045));
      if (targetProj.sx < sideMargin || targetProj.sx > viewW - sideMargin) return false;
      return !(targetProj.sy < horizonY + 28 || targetProj.sy > viewH - 20);
    }

    drawNightVisibility(ctx, playerProj, hullAngle, beamRange, playerX, playerY, camX, camY, viewW, viewH) {
      const darkStrength = this.getNightDarkStrength();
      if (darkStrength <= 0.01 || typeof document === 'undefined') return;

      const cw = Math.max(1, Math.round(viewW));
      const ch = Math.max(1, Math.round(viewH));
      if (!this._nightCanvas) {
        this._nightCanvas = document.createElement('canvas');
        this._nightCtx = this._nightCanvas.getContext('2d');
      }
      if (this._nightCanvas.width !== cw || this._nightCanvas.height !== ch) {
        this._nightCanvas.width = cw;
        this._nightCanvas.height = ch;
      }

      const nCtx = this._nightCtx;
      nCtx.globalCompositeOperation = 'source-over';
      nCtx.clearRect(0, 0, cw, ch);

      const horizonProj = this._getHorizonProj(viewW, viewH);
      const horizonY = horizonProj ? horizonProj.sy : viewH * 0.21;
      const topY = Math.max(0, horizonY - 12);
      const maxAlpha = darkStrength * 0.91;
      const rampFrac = Math.min(0.25, 36 / Math.max(1, ch - topY));

      const darkGrad = nCtx.createLinearGradient(0, topY, 0, ch);
      darkGrad.addColorStop(0, 'rgba(2, 5, 14, 0)');
      darkGrad.addColorStop(rampFrac, `rgba(2, 5, 14, ${maxAlpha.toFixed(3)})`);
      darkGrad.addColorStop(1, `rgba(2, 5, 14, ${maxAlpha.toFixed(3)})`);
      nCtx.fillStyle = darkGrad;
      nCtx.fillRect(0, topY, cw, ch - topY);

      if (playerProj) {
        nCtx.globalCompositeOperation = 'destination-out';
        const px = playerProj.sx;
        const py = playerProj.sy;
        const s = playerProj.scale;

        // 1. Soft radial visibility zone centered around the tank
        const auraR = 215 * s;
        nCtx.save();
        nCtx.translate(px, py);
        nCtx.scale(1, 0.88);
        const auraGrad = nCtx.createRadialGradient(0, 0, auraR * 0.25, 0, 0, auraR);
        auraGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
        auraGrad.addColorStop(0.45, 'rgba(0, 0, 0, 0.92)');
        auraGrad.addColorStop(0.76, 'rgba(0, 0, 0, 0.44)');
        auraGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
        nCtx.fillStyle = auraGrad;
        nCtx.beginPath();
        nCtx.arc(0, 0, auraR, 0, Math.PI * 2);
        nCtx.fill();
        nCtx.restore();

        // 2. Soft feathered ground-projected forward headlight cone up to firing range
        for (let step = 0; step < 5; step++) {
          const widthScale = 1.24 - step * 0.14;
          const poly = this.getHeadlightConePolygon(
            playerX, playerY, hullAngle, (beamRange || 460) * 1.04,
            camX, camY, viewW, viewH, widthScale
          );
          if (!poly) break;
          const beamGrad = nCtx.createLinearGradient(
            poly.originPt.sx, poly.originPt.sy,
            poly.tipPt.sx, poly.tipPt.sy
          );
          beamGrad.addColorStop(0.0, 'rgba(0, 0, 0, 0.34)');
          beamGrad.addColorStop(0.68, 'rgba(0, 0, 0, 0.26)');
          beamGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
          nCtx.fillStyle = beamGrad;
          nCtx.beginPath();
          nCtx.moveTo(poly.leftPts[0].sx, poly.leftPts[0].sy);
          for (let i = 1; i < poly.leftPts.length; i++) {
            nCtx.lineTo(poly.leftPts[i].sx, poly.leftPts[i].sy);
          }
          for (let i = poly.rightPts.length - 1; i >= 0; i--) {
            nCtx.lineTo(poly.rightPts[i].sx, poly.rightPts[i].sy);
          }
          nCtx.closePath();
          nCtx.fill();
        }
      }

      ctx.drawImage(this._nightCanvas, 0, 0, viewW, viewH);
    }
  }

  global.TankUtil.mixin(global.HorizonWorld, WorldNight);
})(window);
