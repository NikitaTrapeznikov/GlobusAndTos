/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * МОДУЛЬ 3: ОТРИСОВКА СПРАЙТОВ И ВИЗУАЛЬНЫХ ЭФФЕКТОВ (Sprite & Canvas Renderer)
 * Изолированный модуль графики: отвечает за отрисовку выжившего с разным оружием,
 * 5 видов зомби, Штаба, стен, шипов, генераторов ресурсов, 3 типов турелей (уровни 1-3),
 * снарядов, частиц, всплывающего урона и освещения День/Ночь.
 */

import { BuildingType, WeaponId, BUILDING_BLUEPRINTS } from './character';

export type ZombieVariant = 'walker' | 'runner' | 'brute' | 'boomer' | 'boss';

export interface RenderPlayer {
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  weapon: WeaponId;
  walkCycle: number;
  muzzleFlash: number;
  hitFlash: number;
}

export interface RenderZombie {
  id: string;
  variant: ZombieVariant;
  x: number;
  y: number;
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  walkCycle: number;
  hitFlash: number;
  attackWindup: number;
}

export interface RenderBuilding {
  id: string;
  type: BuildingType;
  gx: number;
  gy: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  turretAngle: number;
  recoil: number;
  pulsePhase: number;
  teslaArcs?: { x1: number; y1: number; x2: number; y2: number }[];
  laserTimer?: number;
}

export interface RenderProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  isRocket: boolean;
}

export interface RenderParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface RenderFloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface RenderWorldState {
  worldWidth: number;
  worldHeight: number;
  gridSize: number;
  cameraX: number;
  cameraY: number;
  viewportWidth: number;
  viewportHeight: number;
  isNight: boolean;
  nightFactor: number; // 0.0 (день) -> 1.0 (ночь)
  time: number;
  player: RenderPlayer;
  buildings: RenderBuilding[];
  zombies: RenderZombie[];
  projectiles: RenderProjectile[];
  particles: RenderParticle[];
  floatingTexts: RenderFloatingText[];
  buildMode: boolean;
  selectedBuildType: BuildingType;
  hoverGrid: { gx: number; gy: number; valid: boolean; existingBuilding?: RenderBuilding } | null;
}

// Кэш 5 спрайтов квадратов травы (1 основной + 4 дополнительных) и 3 видов спрайтов камней,
// собранных на единую карту местности для идеальной производительности и отсутствия ряби
let cachedWorldTerrain: HTMLCanvasElement | null = null;

/**
 * Создает 5 разных спрайтов квадратов травы (48x48):
 * Индекс 0 — основной спокойный спрайт (72% карты, чтобы не рябило в глазах)
 * Индексы 1..4 — 4 дополнительных вариативных спрайта травы (по ~7% карты каждый)
 */
function createGrassTileSprites(gridSize: number): HTMLCanvasElement[] {
  const tiles: HTMLCanvasElement[] = [];

  for (let variant = 0; variant < 5; variant++) {
    const tile = document.createElement('canvas');
    tile.width = gridSize;
    tile.height = gridSize;
    const tctx = tile.getContext('2d')!;

    // Единая спокойная базовая заливка луговой травы
    tctx.fillStyle = '#243B24';
    tctx.fillRect(0, 0, gridSize, gridSize);

    if (variant === 0) {
      // ОСНОВНОЙ СПРАЙТ (спокойный, мягкий, без резкого контраста)
      tctx.fillStyle = '#223822';
      tctx.fillRect(6, 8, 16, 14);
      tctx.fillRect(26, 26, 15, 14);

      tctx.strokeStyle = '#2F4D2D';
      tctx.lineWidth = 1.2;
      const calmBlades = [
        [12, 16],
        [34, 14],
        [20, 36],
      ];
      for (const [bx, by] of calmBlades) {
        tctx.beginPath();
        tctx.moveTo(bx, by);
        tctx.lineTo(bx - 1.5, by - 4);
        tctx.moveTo(bx, by);
        tctx.lineTo(bx + 1.5, by - 3.5);
        tctx.stroke();
      }
    } else if (variant === 1) {
      // ДОП. СПРАЙТ 1: Густые пучки высокой травы
      tctx.fillStyle = '#203520';
      tctx.fillRect(8, 10, 28, 26);

      tctx.strokeStyle = '#3B6336';
      tctx.lineWidth = 1.4;
      const tufts = [
        [11, 14],
        [24, 12],
        [35, 22],
        [15, 33],
        [30, 37],
      ];
      for (const [bx, by] of tufts) {
        tctx.beginPath();
        tctx.moveTo(bx, by);
        tctx.lineTo(bx - 2.5, by - 5.5);
        tctx.moveTo(bx, by);
        tctx.lineTo(bx, by - 6);
        tctx.moveTo(bx, by);
        tctx.lineTo(bx + 2.5, by - 5);
        tctx.stroke();
      }
    } else if (variant === 2) {
      // ДОП. СПРАЙТ 2: Примятая трава с проплешиной земли
      tctx.fillStyle = '#2B3623';
      tctx.beginPath();
      tctx.ellipse(24, 25, 14, 10, 0.2, 0, Math.PI * 2);
      tctx.fill();

      tctx.fillStyle = '#36412B';
      tctx.beginPath();
      tctx.ellipse(22, 24, 8, 5, -0.1, 0, Math.PI * 2);
      tctx.fill();

      tctx.strokeStyle = '#355630';
      tctx.lineWidth = 1.3;
      tctx.beginPath();
      tctx.moveTo(10, 14);
      tctx.lineTo(12, 9);
      tctx.moveTo(37, 34);
      tctx.lineTo(39, 29);
      tctx.stroke();
    } else if (variant === 3) {
      // ДОП. СПРАЙТ 3: Мшистый темно-изумрудный клевер
      tctx.fillStyle = '#1D311F';
      tctx.beginPath();
      tctx.arc(16, 18, 9, 0, Math.PI * 2);
      tctx.arc(31, 30, 8, 0, Math.PI * 2);
      tctx.fill();

      tctx.fillStyle = '#3F6A3B';
      const leaves = [
        [15, 16],
        [18, 19],
        [13, 20],
        [30, 28],
        [33, 31],
      ];
      for (const [lx, ly] of leaves) {
        tctx.beginPath();
        tctx.arc(lx, ly, 1.8, 0, Math.PI * 2);
        tctx.fill();
      }
    } else {
      // ДОП. СПРАЙТ 4: Луговая трава со светлыми молодыми побегами
      tctx.fillStyle = '#274026';
      tctx.fillRect(5, 5, 18, 18);
      tctx.fillRect(24, 22, 18, 18);

      const sprouts = [
        [14, 14],
        [32, 18],
        [18, 34],
        [34, 34],
      ];
      tctx.strokeStyle = '#4A7843';
      tctx.lineWidth = 1.3;
      for (const [sx, sy] of sprouts) {
        tctx.beginPath();
        tctx.moveTo(sx, sy);
        tctx.lineTo(sx - 2, sy - 4);
        tctx.moveTo(sx, sy);
        tctx.lineTo(sx + 2, sy - 4);
        tctx.stroke();
      }
      tctx.fillStyle = '#659B5E';
      for (const [sx, sy] of sprouts) {
        tctx.fillRect(sx - 1, sy - 4, 2, 1.5);
      }
    }

    // Едва заметная тактическая грань квадрата сетки
    tctx.strokeStyle = 'rgba(14, 24, 14, 0.25)';
    tctx.lineWidth = 1;
    tctx.strokeRect(0.5, 0.5, gridSize - 1, gridSize - 1);

    tiles.push(tile);
  }

  return tiles;
}

/**
 * Создает 3 вида спрайтов небольших камешков (24x24 px)
 */
function createRockSprites(): HTMLCanvasElement[] {
  const rocks: HTMLCanvasElement[] = [];

  for (let type = 0; type < 3; type++) {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const rctx = c.getContext('2d')!;

    if (type === 0) {
      // ВИД КАМНЯ 1: Одиночный граненый серый булыжник с бликом
      rctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      rctx.beginPath();
      rctx.ellipse(12, 14, 6.5, 4.5, 0, 0, Math.PI * 2);
      rctx.fill();

      rctx.fillStyle = '#525B66';
      rctx.beginPath();
      rctx.moveTo(6, 13);
      rctx.lineTo(9, 8);
      rctx.lineTo(15, 8);
      rctx.lineTo(18, 12);
      rctx.lineTo(14, 16);
      rctx.lineTo(8, 16);
      rctx.closePath();
      rctx.fill();

      // Светлая верхняя грань
      rctx.fillStyle = '#7C8794';
      rctx.beginPath();
      rctx.moveTo(8, 12);
      rctx.lineTo(9.5, 8.8);
      rctx.lineTo(14.5, 8.8);
      rctx.lineTo(16, 11.5);
      rctx.closePath();
      rctx.fill();
    } else if (type === 1) {
      // ВИД КАМНЯ 2: Пара гладких речных камешков (средний + малый)
      rctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
      rctx.beginPath();
      rctx.ellipse(10, 14, 5.5, 3.8, -0.2, 0, Math.PI * 2);
      rctx.ellipse(17, 15, 3.2, 2.4, 0.3, 0, Math.PI * 2);
      rctx.fill();

      rctx.fillStyle = '#646E68';
      rctx.beginPath();
      rctx.ellipse(10, 12.5, 5, 3.5, -0.2, 0, Math.PI * 2);
      rctx.fill();

      rctx.fillStyle = '#849089';
      rctx.beginPath();
      rctx.ellipse(9.2, 11.6, 3.2, 1.8, -0.2, 0, Math.PI * 2);
      rctx.fill();

      // Малый камешек рядом
      rctx.fillStyle = '#4B5550';
      rctx.beginPath();
      rctx.ellipse(16.8, 14.2, 2.8, 2.1, 0.3, 0, Math.PI * 2);
      rctx.fill();
    } else {
      // ВИД КАМНЯ 3: Россыпь из 3 мелких осколков породы со мхом
      const shards = [
        { x: 8, y: 11, r: 2.6, col: '#576058' },
        { x: 14, y: 14, r: 3.1, col: '#69726A' },
        { x: 15, y: 9, r: 2.0, col: '#485049' },
      ];
      for (const sh of shards) {
        rctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
        rctx.beginPath();
        rctx.arc(sh.x + 0.8, sh.y + 1.2, sh.r, 0, Math.PI * 2);
        rctx.fill();

        rctx.fillStyle = sh.col;
        rctx.beginPath();
        rctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
        rctx.fill();
      }
      // Капелька мха на камне
      rctx.fillStyle = '#4D7C43';
      rctx.beginPath();
      rctx.arc(13, 13, 1.3, 0, Math.PI * 2);
      rctx.fill();
    }

    rocks.push(c);
  }

  return rocks;
}

/**
 * Генерирует и кэширует полную карту травы и камешков
 */
function getWorldTerrainCanvas(worldWidth: number, worldHeight: number, gridSize: number): HTMLCanvasElement {
  if (
    cachedWorldTerrain &&
    cachedWorldTerrain.width === worldWidth &&
    cachedWorldTerrain.height === worldHeight
  ) {
    return cachedWorldTerrain;
  }

  const worldCanvas = document.createElement('canvas');
  worldCanvas.width = worldWidth;
  worldCanvas.height = worldHeight;
  const wctx = worldCanvas.getContext('2d')!;

  const grassSprites = createGrassTileSprites(gridSize);
  const rockSprites = createRockSprites();

  const cols = Math.ceil(worldWidth / gridSize);
  const rows = Math.ceil(worldHeight / gridSize);

  // Детерминированный генератор псевдослучайных чисел, чтобы трава и камни не мигали
  let seed = 133742;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // 1. Заполняем карту квадратами травы: ~72% основной спрайт #0, ~28% — 4 дополнительных спрайта (#1..#4)
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const r = nextRand();
      let spriteIndex = 0;
      if (r >= 0.72) {
        spriteIndex = 1 + (Math.floor(nextRand() * 4) % 4);
      }
      wctx.drawImage(grassSprites[spriteIndex], gx * gridSize, gy * gridSize);
    }
  }

  // 2. Раскидываем небольшие камешки (3 вида спрайтов) в рандомных местах по карте
  const pebbleCount = 190;
  for (let i = 0; i < pebbleCount; i++) {
    const rx = 24 + nextRand() * (worldWidth - 48);
    const ry = 24 + nextRand() * (worldHeight - 48);
    const rockType = Math.floor(nextRand() * 3) % 3;
    wctx.drawImage(rockSprites[rockType], Math.round(rx - 12), Math.round(ry - 12));
  }

  cachedWorldTerrain = worldCanvas;
  return worldCanvas;
}

export const SpriteRenderer = {
  /**
   * Главная функция отрисовки кадра игрового мира
   */
  renderWorld(ctx: CanvasRenderingContext2D, state: RenderWorldState) {
    const { viewportWidth, viewportHeight, cameraX, cameraY } = state;

    ctx.save();
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    // 1. Заливка подложки за пределами карты
    ctx.fillStyle = '#142214';
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.translate(-cameraX, -cameraY);

    // 2. Отрисовка квадратов травы (1 основной + 4 доп.) и 3 видов камешков
    this.drawTerrainAndGrid(ctx, state);

    // 3. Напольные постройки (шипы и двери) рисуются под персонажами
    for (const b of state.buildings) {
      if (b.type === 'spikes' || b.type === 'door') {
        this.drawBuildingSprite(ctx, b, state.gridSize, state.time, state.player);
      }
    }

    // 4. Подсветка сетки при строительстве
    if (state.buildMode && state.hoverGrid) {
      this.drawBuildPreview(ctx, state);
    }

    // 5. Основные постройки (Штаб, стены, генераторы, турели, Тесла, HIMARS)
    for (const b of state.buildings) {
      if (b.type !== 'spikes' && b.type !== 'door') {
        this.drawBuildingSprite(ctx, b, state.gridSize, state.time, state.player);
      }
    }

    // 6. Электрические дуги башни Тесла (Цепная молния)
    for (const b of state.buildings) {
      if (b.laserTimer && b.laserTimer > 0 && b.teslaArcs && b.teslaArcs.length > 0) {
        this.drawTeslaLightningArcs(ctx, b.teslaArcs, b.laserTimer);
      }
    }

    // 7. Частицы на земле
    this.drawParticles(ctx, state.particles);

    // 8. Отрисовка зомби
    for (const z of state.zombies) {
      this.drawZombieSprite(ctx, z);
    }

    // 9. Отрисовка выжившего игрока
    this.drawPlayerSprite(ctx, state.player);

    // 10. Отрисовка снарядов и ракет HIMARS
    this.drawProjectiles(ctx, state.projectiles);

    // 11. Ночное освещение (плавный переход День -> Ночь и источники света)
    if (state.nightFactor > 0.02) {
      this.drawNightLighting(ctx, state);
    }

    // 12. Всплывающие числа урона и добычи ресурсов
    this.drawFloatingTexts(ctx, state.floatingTexts);

    ctx.restore();
  },

  /**
   * Отрисовка зигзагообразных электрических молний башни Тесла
   */
  drawTeslaLightningArcs(
    ctx: CanvasRenderingContext2D,
    arcs: { x1: number; y1: number; x2: number; y2: number }[],
    timer: number
  ) {
    ctx.save();
    const alpha = Math.min(1, timer * 6.5);

    for (const arc of arcs) {
      const segments = 6;
      const dx = (arc.x2 - arc.x1) / segments;
      const dy = (arc.y2 - arc.y1) / segments;

      // Внешнее голубое свечение молнии
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha * 0.65})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      const pts: [number, number][] = [];
      for (let i = 1; i < segments; i++) {
        const jx = arc.x1 + dx * i + (Math.random() - 0.5) * 18;
        const jy = arc.y1 + dy * i + (Math.random() - 0.5) * 18;
        pts.push([jx, jy]);
        ctx.lineTo(jx, jy);
      }
      ctx.lineTo(arc.x2, arc.y2);
      ctx.stroke();

      // Яркая бело-голубая сердцевина разряда
      ctx.strokeStyle = `rgba(224, 242, 254, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(arc.x1, arc.y1);
      for (const [px, py] of pts) {
        ctx.lineTo(px, py);
      }
      ctx.lineTo(arc.x2, arc.y2);
      ctx.stroke();

      // Вспышка в точке удара молнии
      ctx.fillStyle = `rgba(125, 211, 252, ${alpha})`;
      ctx.beginPath();
      ctx.arc(arc.x2, arc.y2, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  drawTerrainAndGrid(ctx: CanvasRenderingContext2D, state: RenderWorldState) {
    const { worldWidth, worldHeight, gridSize, cameraX, cameraY, viewportWidth, viewportHeight } = state;

    // Отрисовываем кэшированную карту из 5 видов травы и 3 видов камешков
    const terrainCanvas = getWorldTerrainCanvas(worldWidth, worldHeight, gridSize);
    ctx.drawImage(terrainCanvas, 0, 0);

    // Декоративные тактические круги вокруг центрального Штаба
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, gridSize * 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, gridSize * 9.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Дополнительная четкая сетка в режиме строительства
    if (state.buildMode) {
      const startX = Math.max(0, Math.floor(cameraX / gridSize) * gridSize);
      const endX = Math.min(worldWidth, Math.ceil((cameraX + viewportWidth) / gridSize) * gridSize);
      const startY = Math.max(0, Math.floor(cameraY / gridSize) * gridSize);
      const endY = Math.min(worldHeight, Math.ceil((cameraY + viewportHeight) / gridSize) * gridSize);

      ctx.strokeStyle = 'rgba(167, 243, 208, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();
    }

    // Опасная граница карты
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, worldWidth - 4, worldHeight - 4);
  },

  drawBuildPreview(ctx: CanvasRenderingContext2D, state: RenderWorldState) {
    if (!state.hoverGrid) return;
    const { gx, gy, valid, existingBuilding } = state.hoverGrid;
    const gs = state.gridSize;
    const px = gx * gs;
    const py = gy * gs;
    const cx = px + gs / 2;
    const cy = py + gs / 2;

    ctx.save();
    if (existingBuilding) {
      ctx.strokeStyle = '#F59E0B';
      ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
    } else if (valid) {
      ctx.strokeStyle = '#10B981';
      ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
    } else {
      ctx.strokeStyle = '#EF4444';
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
    }

    ctx.lineWidth = 2;
    ctx.fillRect(px + 2, py + 2, gs - 4, gs - 4);
    ctx.strokeRect(px + 2, py + 2, gs - 4, gs - 4);

    // Радиус действия для турелей, Теслы и HIMARS
    const targetType = existingBuilding ? existingBuilding.type : state.selectedBuildType;
    const bp = BUILDING_BLUEPRINTS[targetType];
    if (bp?.range) {
      const bonusRange = existingBuilding ? bp.range * (1 + (existingBuilding.level - 1) * 0.1) : bp.range;
      ctx.beginPath();
      ctx.arc(cx, cy, bonusRange, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.32)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },

  /**
   * Отрисовка спрайтов построек: Штаб, Стена, Дверь, Шипы, Генератор, Пулемет, Башня Тесла и РСЗО HIMARS
   */
  drawBuildingSprite(
    ctx: CanvasRenderingContext2D,
    b: RenderBuilding,
    gridSize: number,
    time: number,
    player?: RenderPlayer
  ) {
    const px = b.gx * gridSize;
    const py = b.gy * gridSize;
    const cx = b.x;
    const cy = b.y;
    const pad = 3;
    const size = gridSize - pad * 2;

    ctx.save();

    if (b.type === 'hq') {
      // Главное здание (Штаб-Генератор)
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(px - gridSize * 0.4, py - gridSize * 0.4, gridSize * 1.8, gridSize * 1.8, 10);
      ctx.fill();
      ctx.stroke();

      // Угловые опоры
      ctx.fillStyle = '#475569';
      const corners = [
        [cx - 32, cy - 32],
        [cx + 20, cy - 32],
        [cx - 32, cy + 20],
        [cx + 20, cy + 20],
      ];
      for (const [ox, oy] of corners) {
        ctx.fillRect(ox, oy, 12, 12);
      }

      // Вращающееся кольцо реактора
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 1.2);
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 1.4);
      ctx.stroke();
      ctx.restore();

      // Пульсирующее энергетическое ядро
      const pulse = 14 + Math.sin(time * 4) * 2.5;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, pulse + 6);
      grad.addColorStop(0, '#FEF08A');
      grad.addColorStop(0.55, '#F59E0B');
      grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, pulse + 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.type === 'wall') {
      // Стена с визуализацией уровня (1: Бетон, 2: Сталь, 3: Титан)
      const colors = ['#475569', '#64748B', '#0EA5E9'];
      const borderColors = ['#94A3B8', '#CBD5E1', '#38BDF8'];
      ctx.fillStyle = colors[Math.min(2, b.level - 1)];
      ctx.strokeStyle = borderColors[Math.min(2, b.level - 1)];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px + pad, py + pad, size, size, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.fillRect(px + 9, py + 9, size - 12, size - 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(px + 9, py + 9);
      ctx.lineTo(px + gridSize - 9, py + gridSize - 9);
      ctx.stroke();
    } else if (b.type === 'door') {
      // Сенсорная бронедверь
      const distToPlayer = player ? Math.hypot(player.x - cx, player.y - cy) : 999;
      const isOpenForPlayer = distToPlayer < 52;
      const slideOffset = isOpenForPlayer ? 10 : 0;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = b.level >= 2 ? '#38BDF8' : '#10B981';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(px + 3, py + 3, gridSize - 6, gridSize - 6, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 1.5;
      const leafWidth = (gridSize - 12) / 2 - slideOffset;
      if (leafWidth > 3) {
        ctx.fillRect(px + 6, py + 8, leafWidth, gridSize - 16);
        ctx.strokeRect(px + 6, py + 8, leafWidth, gridSize - 16);

        ctx.fillRect(px + gridSize - 6 - leafWidth, py + 8, leafWidth, gridSize - 16);
        ctx.strokeRect(px + gridSize - 6 - leafWidth, py + 8, leafWidth, gridSize - 16);
      }

      ctx.strokeStyle = isOpenForPlayer ? '#34D399' : '#10B981';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px + 8, cy);
      ctx.lineTo(px + gridSize - 8, cy);
      ctx.stroke();
    } else if (b.type === 'spikes') {
      // Напольные титановые шипы
      ctx.fillStyle = 'rgba(30, 41, 59, 0.75)';
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 1.5;
      ctx.fillRect(px + 4, py + 4, gridSize - 8, gridSize - 8);
      ctx.strokeRect(px + 4, py + 4, gridSize - 8, gridSize - 8);

      const offsets = [-11, 0, 11];
      for (const ox of offsets) {
        for (const oy of offsets) {
          ctx.fillStyle = b.level >= 2 ? '#F59E0B' : '#CBD5E1';
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, 3.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (b.type === 'generator') {
      // Автоматический генератор ресурсов
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px + pad, py + pad, size, size, 8);
      ctx.fill();
      ctx.stroke();

      const glow = 10 + Math.sin(time * 5 + b.pulsePhase) * 2.5;
      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.arc(cx, cy, glow, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#A7F3D0';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx, cy + 6);
      ctx.stroke();
    } else if (b.type === 'turret_sniper') {
      // 1) КАТУШКА ТЕСЛА («Разряд») — медные кольца, изоляторы и высоковольтная сфера с молниями
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = b.level === 3 ? '#F59E0B' : '#38BDF8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px + 4, py + 4, gridSize - 8, gridSize - 8, 8);
      ctx.fill();
      ctx.stroke();

      // Боковые конденсаторы-изоляторы
      ctx.fillStyle = '#0284C7';
      const isoOffsets = [
        [-12, -12],
        [12, -12],
        [-12, 12],
        [12, 12],
      ];
      for (const [ix, iy] of isoOffsets) {
        ctx.beginPath();
        ctx.arc(cx + ix, cy + iy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Медная обмотка катушки
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.stroke();

      // Электрическое поле и центральный шар Теслы
      const orbRadius = 7.5 + Math.sin(time * 10) * 1.5;
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, orbRadius + 7);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.5, '#38BDF8');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius + 7, 0, Math.PI * 2);
      ctx.fill();

      // Дежурные микро-искры вокруг катушки
      const sparkAngle = (time * 6) % (Math.PI * 2);
      ctx.strokeStyle = '#E0F2FE';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sparkAngle) * 5, cy + Math.sin(sparkAngle) * 5);
      ctx.lineTo(cx + Math.cos(sparkAngle + 0.4) * 14, cy + Math.sin(sparkAngle + 0.4) * 14);
      ctx.stroke();
    } else if (b.type === 'turret_rocket') {
      // 3) Пусковая установка РСЗО «HIMARS» (бронированное шасси + 6-трубный ракетный контейнер)
      ctx.fillStyle = '#1E2923';
      ctx.strokeStyle = b.level === 3 ? '#F59E0B' : b.level === 2 ? '#84CC16' : '#65A30D';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px + 4, py + 4, gridSize - 8, gridSize - 8, 7);
      ctx.fill();
      ctx.stroke();

      // Опорное кольцо лафета
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fill();

      // Поворотный бронированный пакет HIMARS на 6 ракетных направляющих
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.turretAngle);
      const recoilOffset = -b.recoil * 4.5;

      // Корпус пускового контейнера цвета военного хаки
      ctx.fillStyle = '#3F6212';
      ctx.strokeStyle = '#A3E635';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(-13 + recoilOffset, -11, 26, 22, 3);
      ctx.fill();
      ctx.stroke();

      // Тактические полосы на крышке пакета
      ctx.fillStyle = '#365314';
      ctx.fillRect(-9 + recoilOffset, -9, 18, 18);

      // 6 пусковых труб (2 ряда по 3 боеголовки спереди контейнера)
      const tubeY = [-6.5, 0, 6.5];
      for (const ty of tubeY) {
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(11 + recoilOffset, ty, 2.6, 0, Math.PI * 2);
        ctx.fill();

        // Оранжево-красные боеголовки внутри направляющих
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(11 + recoilOffset, ty, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // 2) Обычная пулеметная турель «Шквал» с плавным поворотом
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = b.level === 3 ? '#F59E0B' : b.level === 2 ? '#38BDF8' : '#64748B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px + 4, py + 4, gridSize - 8, gridSize - 8, 8);
      ctx.fill();
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(b.turretAngle);
      const recoilOffset = -b.recoil * 5;

      // Двуствольный скорострельный пулемет
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(4 + recoilOffset, -5, 16, 3.5);
      ctx.fillRect(4 + recoilOffset, 1.5, 16, 3.5);
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Индикатор уровня постройки (звездочки/точки 1..3)
    if (b.type !== 'hq' && b.level > 1) {
      for (let i = 0; i < b.level; i++) {
        ctx.fillStyle = '#FBBF24';
        ctx.beginPath();
        ctx.arc(px + 10 + i * 7, py + 9, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Полоска прочности, если постройка повреждена (или всегда для Штаба)
    if (b.hp < b.maxHp || b.type === 'hq') {
      const barW = b.type === 'hq' ? gridSize * 1.5 : gridSize - 10;
      const barH = b.type === 'hq' ? 6 : 4;
      const bx = cx - barW / 2;
      const by = b.type === 'hq' ? py - gridSize * 0.55 : py - 6;
      const ratio = Math.max(0, b.hp / b.maxHp);

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = ratio > 0.5 ? '#10B981' : ratio > 0.25 ? '#F59E0B' : '#EF4444';
      ctx.fillRect(bx, by, barW * ratio, barH);
    }

    ctx.restore();
  },

  /**
   * Отрисовка спрайта выжившего игрока и его текущего оружия
   */
  drawPlayerSprite(ctx: CanvasRenderingContext2D, p: RenderPlayer) {
    ctx.save();
    ctx.translate(p.x, p.y);

    // Тень под персонажем
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 15, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(p.angle);

    // Анимация шага (ботинки)
    const stride = Math.sin(p.walkCycle) * 5;
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(stride - 4, -11, 8, 5);
    ctx.fillRect(-stride - 4, 6, 8, 5);

    // Оружие в руках
    if (p.weapon === 'pistol') {
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(10, 2, 12, 4);
    } else if (p.weapon === 'shotgun') {
      ctx.fillStyle = '#78350F';
      ctx.fillRect(6, 1, 10, 5);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(14, 1.5, 13, 4);
    } else if (p.weapon === 'assault') {
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(8, 1, 14, 5);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(20, 2, 9, 3);
    } else if (p.weapon === 'launcher') {
      ctx.fillStyle = '#991B1B';
      ctx.fillRect(4, 0, 24, 7);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(25, -1, 4, 9);
    }

    // Вспышка выстрела у дула
    if (p.muzzleFlash > 0) {
      ctx.fillStyle = '#FEF08A';
      ctx.beginPath();
      ctx.arc(28, 3.5, 6 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Плечи и бронежилет выжившего
    ctx.fillStyle = p.hitFlash > 0 ? '#EF4444' : '#3B82F6';
    ctx.beginPath();
    ctx.roundRect(-10, -12, 20, 24, 7);
    ctx.fill();

    // Шлем / Голова
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Тактический визор
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(4, -5, 4.5, 10);

    ctx.restore();
  },

  /**
   * Отрисовка спрайтов 5 типов зомби (Ходок, Бегун, Громила, Взрывной, Босс)
   */
  drawZombieSprite(ctx: CanvasRenderingContext2D, z: RenderZombie) {
    ctx.save();
    ctx.translate(z.x, z.y);

    // Тень
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 3, z.radius * 0.95, z.radius * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(z.angle);

    const colors: Record<ZombieVariant, { body: string; head: string; eye: string }> = {
      walker: { body: '#3F6212', head: '#65A30D', eye: '#EF4444' },
      runner: { body: '#7C2D12', head: '#EA580C', eye: '#FEF08A' },
      brute: { body: '#312E81', head: '#4F46E5', eye: '#F43F5E' },
      boomer: { body: '#065F46', head: '#10B981', eye: '#A3E635' },
      boss: { body: '#7F1D1D', head: '#DC2626', eye: '#FDE047' },
    };

    const palette = colors[z.variant];
    const reach = Math.sin(z.walkCycle) * 4 + (z.attackWindup > 0 ? 5 : 0);

    // Вытянутые когтистые лапы зомби
    ctx.fillStyle = z.hitFlash > 0 ? '#FFFFFF' : palette.head;
    ctx.beginPath();
    ctx.roundRect(4 + reach, -z.radius * 0.85, z.radius * 0.95, 5, 2.5);
    ctx.roundRect(4 - reach * 0.6, z.radius * 0.85 - 5, z.radius * 0.95, 5, 2.5);
    ctx.fill();

    // Торс
    ctx.fillStyle = z.hitFlash > 0 ? '#FCA5A5' : palette.body;
    ctx.beginPath();
    ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
    ctx.fill();

    // Пульсирующие кислотные наросты для Boomer
    if (z.variant === 'boomer') {
      ctx.fillStyle = '#84CC16';
      ctx.beginPath();
      ctx.arc(-4, -5, 4.5, 0, Math.PI * 2);
      ctx.arc(-3, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Голова
    ctx.fillStyle = z.hitFlash > 0 ? '#FFFFFF' : palette.head;
    ctx.beginPath();
    ctx.arc(2, 0, z.radius * 0.62, 0, Math.PI * 2);
    ctx.fill();

    // Светящиеся глаза
    ctx.fillStyle = palette.eye;
    ctx.beginPath();
    ctx.arc(z.radius * 0.45, -3.2, 2, 0, Math.PI * 2);
    ctx.arc(z.radius * 0.45, 3.2, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Полоска HP над раненым зомби или боссом
    if (z.hp < z.maxHp || z.variant === 'boss' || z.variant === 'brute') {
      const barW = Math.max(24, z.radius * 2);
      const barH = z.variant === 'boss' ? 6 : 4;
      const bx = z.x - barW / 2;
      const by = z.y - z.radius - 10;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = z.variant === 'boss' ? '#F43F5E' : '#EF4444';
      ctx.fillRect(bx, by, barW * Math.max(0, z.hp / z.maxHp), barH);
    }
  },

  drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: RenderProjectile[]) {
    for (const proj of projectiles) {
      ctx.save();
      const angle = Math.atan2(proj.vy, proj.vx);
      ctx.translate(proj.x, proj.y);
      ctx.rotate(angle);

      if (proj.isRocket) {
        // Фугасная ракета / граната с огненным шлейфом
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(-8, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.roundRect(-6, -3.5, 13, 7, 3);
        ctx.fill();
      } else {
        // Трассирующая пуля
        ctx.fillStyle = proj.color;
        ctx.beginPath();
        ctx.roundRect(-7, -2, 12, 4, 2);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  drawParticles(ctx: CanvasRenderingContext2D, particles: RenderParticle[]) {
    for (const pt of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.alpha * (pt.life / pt.maxLife));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  /**
   * Мягкая световая атмосфера ночи с подсветкой вокруг Штаба, игрока, генераторов и турелей
   */
  drawNightLighting(ctx: CanvasRenderingContext2D, state: RenderWorldState) {
    const { cameraX, cameraY, viewportWidth, viewportHeight, nightFactor, player, buildings } = state;
    ctx.save();

    // Легкий ночной покров с радиальным просветом вокруг игрока и Штаба
    const darknessAlpha = nightFactor * 0.58;
    const hq = buildings.find((b) => b.type === 'hq');
    const focusX = player.x;
    const focusY = player.y;

    const grad = ctx.createRadialGradient(focusX, focusY, 90, focusX, focusY, 520);
    grad.addColorStop(0, 'rgba(8, 12, 20, 0.05)');
    grad.addColorStop(0.55, `rgba(8, 12, 20, ${darknessAlpha * 0.65})`);
    grad.addColorStop(1, `rgba(6, 10, 18, ${darknessAlpha})`);

    ctx.fillStyle = grad;
    ctx.fillRect(cameraX, cameraY, viewportWidth, viewportHeight);

    // Луч тактического фонаря на оружии игрока
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    const coneGrad = ctx.createLinearGradient(0, 0, 320, 0);
    coneGrad.addColorStop(0, `rgba(254, 240, 138, ${0.18 * nightFactor})`);
    coneGrad.addColorStop(1, 'rgba(254, 240, 138, 0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.arc(0, 0, 320, -0.36, 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Теплое свечение вокруг Штаба и генераторов ночью
    if (hq) {
      const hqGlow = ctx.createRadialGradient(hq.x, hq.y, 15, hq.x, hq.y, 240);
      hqGlow.addColorStop(0, `rgba(245, 158, 11, ${0.16 * nightFactor})`);
      hqGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
      ctx.fillStyle = hqGlow;
      ctx.beginPath();
      ctx.arc(hq.x, hq.y, 240, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },

  drawFloatingTexts(ctx: CanvasRenderingContext2D, texts: RenderFloatingText[]) {
    ctx.save();
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const ft of texts) {
      const progress = 1 - ft.life / ft.maxLife;
      ctx.globalAlpha = Math.max(0, 1 - progress * progress);
      ctx.fillStyle = '#0F172A';
      ctx.fillText(ft.text, ft.x + 1, ft.y - progress * 22 + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y - progress * 22);
    }
    ctx.restore();
  },
};
